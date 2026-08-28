import assert from "node:assert/strict";
import test from "node:test";
import type { ImmichAsset } from "../infra/ImmichClient.js";
import { linkDriveChecksumDuplicate, type DriveDuplicateLinkContext } from "./driveDuplicateLink.service.js";

const context: DriveDuplicateLinkContext = {
  placementId: 1, activityId: 10,
  config: {
    placements: [
      { placement_id: 1, placement_name: "Test site", partner_name: "Partner", is_earlyon: false },
      { placement_id: 2, placement_name: "Other site", partner_name: "Partner", is_earlyon: false },
    ],
    activities: [{ id: 10, label: "Collage" }, { id: 20, label: "Printmaking" }],
  },
};
const tags = (...names: string[]) => names.map((name, i) => ({ id: `tag-${i}`, name, value: name }));
function fixture(names: string[] = []) {
  const controller = new AbortController();
  const state = {
    asset: { id: "existing", tags: tags(...names), isArchived: false, isTrashed: false,
      visibility: "timeline", isFavorite: true, exifInfo: { description: "Original caption" } } as ImmichAsset,
    sources: [] as ImmichAsset[], reads: 0,
  };
  const writes: Array<{ assetId: string; names: string[] }> = [];
  const params = { assetId: "existing", fileId: "AbC123", context, signal: controller.signal };
  const deps = {
    getAsset: async (id: string) => { assert.equal(id, "existing"); state.reads++; return structuredClone(state.asset); },
    tagAsset: async (assetId: string, names: string[]) => { writes.push({ assetId, names }); state.asset.tags!.push(...tags(...names)); },
    findSources: async (id: string) => { assert.equal(id, "AbC123"); return state.sources; },
  };
  return { state, writes, params, deps, controller };
}

test("checksum repair adds only the exact source ID and preserves every existing field/tag", async () => {
  const f = fixture(["placement:1", "activity:10", "Test site", "Collage", "artwork"]);
  const before = structuredClone(f.state.asset);
  const result = await linkDriveChecksumDuplicate(f.params, f.deps);
  assert.equal(result.status, "linked");
  assert.deepEqual(f.writes, [{ assetId: "existing", names: ["source:drive:AbC123"] }]);
  assert.deepEqual(f.state.asset, { ...before, tags: [...before.tags!, ...tags("source:drive:AbC123")] });
  assert.equal(f.state.reads, 3, "inspect, recheck, and verify the existing asset");
});

test("unassigned checksum duplicates get a source link, not placement/activity assignments", async () => {
  const f = fixture();
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "linked");
  assert.deepEqual(f.state.asset.tags, tags("source:drive:AbC123"));
});

test("source-only linking preserves archived, trashed, and hidden states", async () => {
  for (const extra of [{ isArchived: true, visibility: "archive" as const }, { isTrashed: true }, { visibility: "hidden" as const }]) {
    const f = fixture(["placement:1", "activity:10"]);
    Object.assign(f.state.asset, extra);
    assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "linked");
    for (const [key, value] of Object.entries(extra)) assert.equal(f.state.asset[key as keyof ImmichAsset], value);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.writes[0].names, ["source:drive:AbC123"]);
  }
});

test("a matching source ID is already present, not linked or imported again", async () => {
  const f = fixture(["SOURCE:DRIVE:AbC123", "PLACEMENT:1", "ACTIVITY:10"]);
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "existing");
  assert.deepEqual(f.writes, []);
});

test("different, case-different, and multiple source IDs are never overwritten or supplemented", async () => {
  for (const names of [["source:drive:other"], ["source:drive:abc123"], ["source:drive:AbC123", "source:drive:other"]]) {
    const f = fixture(names);
    const result = await linkDriveChecksumDuplicate(f.params, f.deps);
    assert.equal(result.status, "needs_review"); assert.match(result.detail, /different Drive file ID/);
    assert.deepEqual(f.writes, []);
  }
});

test("conflicting anchors, orphan placement anchors, legacy labels, and custom activities block linking", async () => {
  for (const name of ["placement:2", "placement:999", "archived:placement:999", "activity:20", "activity:999",
    "Other site", "Printmaking", "custom_activity:Collage", "placement:invalid"]) {
    const f = fixture([name]);
    const result = await linkDriveChecksumDuplicate(f.params, f.deps);
    assert.equal(result.status, "needs_review", name);
    assert.match(result.detail, /assignment|label/);
    assert.deepEqual(f.writes, [], name);
  }
});

test("a matching source tag does not hide conflicting placement/activity metadata", async () => {
  const f = fixture(["source:drive:AbC123", "activity:20"]);
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "needs_review");
  assert.deepEqual(f.writes, []);
});

test("ambiguous legacy labels require matching ID anchors", async () => {
  const ambiguous = structuredClone(context);
  ambiguous.config.placements[1].placement_name = "Test site";
  ambiguous.config.activities[1].label = "Collage";
  for (const anchors of [[], ["placement:1", "activity:10"]]) {
    const f = fixture(["Test site", "Collage", ...anchors]);
    const result = await linkDriveChecksumDuplicate({ ...f.params, context: ambiguous }, f.deps);
    assert.equal(result.status, anchors.length ? "linked" : "needs_review");
    assert.equal(f.writes.length, anchors.length ? 1 : 0);
  }
});

test("missing assignment context, unreadable tags, and locked assets fail closed", async () => {
  const f = fixture();
  for (const invalidContext of [undefined, { ...context, placementId: 999 }, { ...context, activityId: 999 }]) {
    assert.equal((await linkDriveChecksumDuplicate({ ...f.params, context: invalidContext }, f.deps)).status, "needs_review");
  }
  assert.equal(f.state.reads, 0);
  delete f.state.asset.tags;
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "needs_review");
  f.state.asset.tags = []; f.state.asset.visibility = "locked";
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "needs_review");
  assert.deepEqual(f.writes, []);
});

test("source ownership is rechecked before linking an existing asset", async () => {
  const f = fixture(); f.state.sources = [{ id: "another-asset" } as ImmichAsset];
  const result = await linkDriveChecksumDuplicate(f.params, f.deps);
  assert.equal(result.status, "needs_review"); assert.match(result.detail, /another Immich asset/);
  assert.deepEqual(f.writes, []);
});

test("new source or assignment conflicts appearing during the ownership check prevent writes", async () => {
  for (const name of ["source:drive:other", "placement:2", "activity:20"]) {
    const f = fixture();
    f.deps.findSources = async () => { f.state.asset.tags = tags(name); return []; };
    assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "needs_review");
    assert.deepEqual(f.writes, []);
  }
});

test("concurrent linking of the same source is recognized without another write", async () => {
  const f = fixture();
  f.deps.findSources = async () => { f.state.asset.tags = tags("source:drive:AbC123"); return []; };
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "existing");
  assert.deepEqual(f.writes, []);
});

test("inspection and source-query failures stay visible without changing tags", async () => {
  for (const operation of ["getAsset", "findSources"] as const) {
    const f = fixture();
    f.deps[operation] = async () => { throw new Error("Permission denied"); };
    const result = await linkDriveChecksumDuplicate(f.params, f.deps);
    assert.equal(result.status, "needs_review"); assert.match(result.detail, /could not be inspected/);
    assert.deepEqual(f.writes, []);
  }
});

test("write failures do not claim that a source link was saved", async () => {
  const f = fixture();
  f.deps.tagAsset = async () => { throw new Error("Permission denied"); };
  const result = await linkDriveChecksumDuplicate(f.params, f.deps);
  assert.equal(result.status, "needs_review"); assert.match(result.detail, /write or verification failed/);
});

test("a saved link with a lost response is safely recognized on retry", async () => {
  const f = fixture();
  const write = f.deps.tagAsset;
  f.deps.tagAsset = async (id, names) => { await write(id, names); throw new Error("Response lost"); };
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "needs_review");
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "existing");
  assert.equal(f.writes.length, 1);
});

test("verification tolerates a delayed source tag without issuing another write", async () => {
  const f = fixture();
  const read = f.deps.getAsset;
  f.deps.getAsset = async (id) => {
    const value = await read(id);
    if (f.state.reads === 3) value.tags = [];
    return value;
  };
  assert.equal((await linkDriveChecksumDuplicate(f.params, f.deps)).status, "linked");
  assert.equal(f.state.reads, 4); assert.equal(f.writes.length, 1);
});

test("an acknowledged write without a visible source tag does not count as linked", async () => {
  const f = fixture(); f.deps.tagAsset = async () => {};
  const result = await linkDriveChecksumDuplicate(f.params, f.deps);
  assert.equal(result.status, "needs_review"); assert.match(result.detail, /could not be verified/);
});

test("verification rejects source and assignment conflicts introduced during the write", async () => {
  for (const name of ["source:drive:abc123", "placement:2", "activity:20"]) {
    const f = fixture();
    f.deps.tagAsset = async () => { f.state.asset.tags = tags("source:drive:AbC123", name); };
    const result = await linkDriveChecksumDuplicate(f.params, f.deps);
    assert.equal(result.status, "needs_review"); assert.match(result.detail, /verification needs review/);
  }
});

test("source linking respects cancellation before inspection and after an in-flight read", async () => {
  for (const beforeRead of [true, false]) {
    const f = fixture();
    if (beforeRead) f.controller.abort();
    else f.deps.findSources = async () => { f.controller.abort(); return []; };
    await assert.rejects(linkDriveChecksumDuplicate(f.params, f.deps), { name: "AbortError" });
    assert.deepEqual(f.writes, []);
  }
});
