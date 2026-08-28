import assert from "node:assert/strict";
import test from "node:test";
import { DriveProcessBackfillManager, DriveProcessBusyError } from "./driveProcessBackfill.service.js";
import { acquireDriveWriter } from "./driveSource.service.js";
import type { ImmichAsset } from "../infra/ImmichClient.js";
import type { DriveFile, DriveFolder } from "./googleDrive.service.js";

const tags = (...names: string[]) => names.map((name) => ({ id: name, name, value: name }));
const asset = (id: string, names = [`source:drive:${id}`], extra: Partial<ImmichAsset> = {}) =>
  ({ id, originalFileName: `${id}.jpg`, tags: tags(...names), isArchived: false, ...extra }) as ImmichAsset;
const folder = (id: string, name = "Process photos"): DriveFolder => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
function fixture(assets = [asset("AbC")]) {
  const stored = new Map(assets.map((item) => [item.id, structuredClone(item)]));
  const writes: Array<{ id: string; names: string[] }> = [];
  const fileReads: string[] = []; const folderReads: string[] = [];
  const deps = {
    inventory: async () => structuredClone([...stored.values()]),
    getAsset: async (id: string) => structuredClone(stored.get(id)!),
    tagAsset: async (id: string, names: string[]) => { writes.push({ id, names }); stored.get(id)!.tags!.push(...tags(...names)); },
    pause: async () => {},
  };
  const client = {
    getFile: async (id: string): Promise<DriveFile> => { fileReads.push(id); return { id, name: `${id}.jpg`, mimeType: "image/jpeg", parents: [`parent-${id}`] }; },
    getFolder: async (id: string): Promise<DriveFolder> => { folderReads.push(id); return folder(id); },
  };
  const manager = new DriveProcessBackfillManager(deps);
  return { manager, deps, client, stored, writes, fileReads, folderReads };
}
async function run(f: ReturnType<typeof fixture>) {
  const started = f.manager.start(f.client, "tester@example.test");
  await f.manager.waitForIdle();
  return f.manager.get(started.jobId)!;
}

test("backfill matches Process and Final parent names case-insensitively, adds only Process, and is idempotent", async () => {
  for (const name of ["Process", "process", "PROCESS", "Work in PrOcEsS", "Postprocessing", "Final", "final", "FINAL", "FiNaL photos", "Finalized artwork"]) {
    const original = asset("AbC", ["SOURCE:DRIVE:AbC", "placement:1", "activity:10", "published", "asset_type:artwork", "custom"],
      { exifInfo: { description: "Keep caption" } as ImmichAsset["exifInfo"] });
    const f = fixture([original]); f.client.getFolder = async (id) => folder(id, name);
    const job = await run(f);
    assert.equal(job.status, "completed", name); assert.equal(job.counts.tagged, 1);
    assert.deepEqual(f.writes, [{ id: "AbC", names: ["asset_type:process"] }]);
    assert.deepEqual(f.stored.get("AbC"), { ...original, tags: [...original.tags!, ...tags("asset_type:process")] });
    assert.deepEqual(f.fileReads, ["AbC"], "opaque Drive ID case is preserved");
    const rerun = await run(f);
    assert.equal(rerun.counts.tagged, 0); assert.equal(rerun.counts.alreadyProcess, 1);
    assert.equal(f.writes.length, 1); assert.equal(f.fileReads.length, 1, "already Process assets need no Drive call");
  }
});

test("backfill only checks the immediate parent, not ancestors or media names", async () => {
  for (const name of ["PROCESS", "FINAL"]) {
    const f = fixture();
    f.client.getFile = async (id) => ({ id, name: `${name} photo.jpg`, mimeType: "image/jpeg", parents: ["details"] });
    f.client.getFolder = async (id) => { assert.equal(id, "details"); return { ...folder(id, "Details"), parents: [name] }; };
    const job = await run(f);
    assert.equal(job.counts.notProcess, 1); assert.equal(f.writes.length, 0);
    assert.equal(job.results[0].folderName, "Details");
    assert.match(job.results[0].detail!, /does not contain process or final/);
  }
});

test("backfill preserves archive, trash, and hidden status and handles shared source derivatives", async () => {
  const originals = [asset("archive", ["source:drive:Shared"], { isArchived: true }),
    asset("trash", ["source:drive:Shared"], { isTrashed: true }), asset("hidden", ["source:drive:Shared"], { visibility: "hidden" })];
  const f = fixture(originals);
  const job = await run(f);
  assert.equal(job.counts.tagged, 3); assert.equal(f.folderReads.length, 1, "one parent lookup per folder per run");
  for (const original of originals) assert.deepEqual(f.stored.get(original.id), { ...original, tags: [...original.tags!, ...tags("asset_type:process")] });
});

test("backfill skips unlinked/already-Process assets and reports ambiguous IDs and unreadable tags", async () => {
  const f = fixture([asset("unlinked", []), asset("done", ["source:drive:done", " ASSET_TYPE:PROCESS "]),
    asset("multiple", ["source:drive:AbC", "source:drive:abc"]), asset("unreadable", [], { tags: undefined })]);
  const job = await run(f);
  assert.equal(job.status, "completed_with_issues");
  assert.equal(job.counts.noSource, 1); assert.equal(job.counts.alreadyProcess, 1); assert.equal(job.counts.needsReview, 2);
  assert.equal(job.counts.checked, 4); assert.equal(job.results.length, 2);
  assert.equal(f.fileReads.length, 0); assert.equal(f.writes.length, 0);
});

test("missing/ambiguous parents, shortcuts, folders and mismatched metadata are never tagged", async () => {
  for (const extra of [{ parents: [] }, { parents: ["one", "two"] }, { id: "different" },
    { mimeType: "application/vnd.google-apps.shortcut" }, { mimeType: "application/vnd.google-apps.folder" }]) {
    const f = fixture();
    f.client.getFile = async (id) => ({ id, name: "file", mimeType: "image/jpeg", parents: ["parent"], ...extra });
    const job = await run(f);
    assert.equal(job.counts.needsReview, 1); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.client.getFolder = async () => folder("wrong-id");
  assert.equal((await run(f)).counts.needsReview, 1); assert.equal(f.writes.length, 0);
});

test("failed Drive lookups stay visible while other assets continue", async () => {
  const f = fixture([asset("missing"), asset("denied"), asset("valid")]);
  const getFile = f.client.getFile;
  f.client.getFile = async (id) => { if (id === "missing") throw new Error("Drive 404"); return getFile(id); };
  f.client.getFolder = async (id) => { if (id === "parent-denied") throw new Error("Drive 403"); return folder(id); };
  const job = await run(f);
  assert.equal(job.status, "completed_with_issues"); assert.equal(job.counts.failed, 2); assert.equal(job.counts.tagged, 1);
  assert.match(job.results[0].detail!, /404/); assert.match(job.results[1].detail!, /403/);
});

test("changed Drive links and newly locked assets fail closed before writing", async () => {
  for (const current of [asset("AbC", ["source:drive:abc"]), asset("AbC", []), asset("AbC", [], { tags: undefined }), asset("AbC", undefined, { visibility: "locked" })]) {
    const f = fixture(); f.deps.getAsset = async () => current;
    assert.equal((await run(f)).counts.needsReview, 1); assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.deps.getAsset = async () => asset("AbC", ["source:drive:AbC", "asset_type:process"]);
  assert.equal((await run(f)).counts.alreadyProcess, 1); assert.equal(f.writes.length, 0);
});

test("Process writes require readback verification and tolerate delayed tags", async () => {
  const f = fixture(); let reads = 0;
  const getAsset = f.deps.getAsset;
  f.deps.getAsset = async (id) => { reads++; return reads < 3 ? asset(id) : getAsset(id); };
  assert.equal((await run(f)).counts.tagged, 1); assert.equal(reads, 3); assert.equal(f.writes.length, 1);
  const unverified = fixture(); unverified.deps.tagAsset = async () => {};
  const job = await run(unverified);
  assert.equal(job.counts.tagged, 0); assert.equal(job.counts.needsReview, 1); assert.match(job.results[0].detail!, /could not be verified/);
});

test("write failures, lost responses and changed sources during verification never report verified success", async () => {
  for (const persist of [false, true]) {
    const f = fixture(); const write = f.deps.tagAsset;
    f.deps.tagAsset = async (id, names) => { if (persist) await write(id, names); throw new Error("Connection dropped"); };
    const job = await run(f);
    assert.equal(job.counts.failed, 1); assert.equal(job.counts.tagged, 0);
    if (persist) assert.equal((await run(f)).counts.alreadyProcess, 1);
  }
  const f = fixture(); const write = f.deps.tagAsset;
  f.deps.tagAsset = async (id, names) => { await write(id, names); f.stored.get(id)!.tags!.push(...tags("source:drive:other")); };
  const job = await run(f);
  assert.equal(job.counts.needsReview, 1); assert.equal(job.counts.tagged, 0); assert.match(job.results[0].detail!, /changed during verification/);
});

test("inventory failures cannot trigger writes or a successful run", async () => {
  const f = fixture(); f.deps.inventory = async () => { throw new Error("Immich authentication failed (401)"); };
  const job = await run(f);
  assert.equal(job.status, "failed"); assert.match(job.error!, /401/); assert.equal(f.writes.length, 0);
  const release = acquireDriveWriter("test"); assert.ok(release); release();
});

test("backfill shares the Drive writer lock and duplicate starts reconnect; cancellation releases it", async () => {
  const f = fixture(); const release = acquireDriveWriter("manual"); assert.ok(release);
  try { assert.throws(() => f.manager.start(f.client, "test"), DriveProcessBusyError); } finally { release(); }
  let unblock!: () => void;
  const pending = new Promise<void>((resolve) => { unblock = resolve; });
  f.deps.inventory = async () => { await pending; return [asset("AbC")]; };
  const first = f.manager.start(f.client, "test");
  try {
    assert.equal(f.manager.start(f.client, "test").jobId, first.jobId);
    assert.equal(acquireDriveWriter("other"), null);
    assert.equal(f.manager.cancel(first.jobId)?.cancelRequested, true);
  } finally { unblock(); await f.manager.waitForIdle(); }
  assert.equal(f.manager.latest()?.status, "cancelled"); assert.equal(f.writes.length, 0);
  const again = acquireDriveWriter("test"); assert.ok(again); again();
});

test("cancellation during a Drive read or tag write stops further work and reruns are safe", async () => {
  for (const duringWrite of [false, true]) {
    const f = fixture([asset("first"), asset("second")]);
    const cancel = () => f.manager.cancel(f.manager.latest()!.jobId);
    if (duringWrite) {
      const write = f.deps.tagAsset; f.deps.tagAsset = async (id, names) => { await write(id, names); cancel(); };
    } else {
      const getFile = f.client.getFile; f.client.getFile = async (id) => { const file = await getFile(id); cancel(); return file; };
    }
    const job = await run(f);
    assert.equal(job.status, "cancelled"); assert.equal(job.counts.tagged, 0);
    assert.equal(f.writes.length, duringWrite ? 1 : 0);
    assert.equal(f.fileReads.length, 1);
  }
});
