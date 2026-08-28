import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DriveAutoImportManager, DriveJobStore, driveConfigurationHash, matchDriveActivity, scanDrivePlacement,
  type DriveImportJob } from "./driveAutoImport.service.js";
import { GoogleDriveClient, type DriveFile } from "./googleDrive.service.js";
import { acquireDriveWriter, driveSourceIds } from "./driveSource.service.js";
import { addSourceAsset, importNewDriveFile, sourceAssets, sourceConflict, spoolDriveFile, type SourceIndex } from "./driveImport.service.js";
import { searchAssets, type ImmichAsset } from "../infra/ImmichClient.js";
import type { UploadConfig } from "./uploadConfig.service.js";

const folder = (id: string, name = id): DriveFile => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const media = (id: string, parent = "week", mimeType = "image/jpeg"): DriveFile => ({ id, name: `${id}.jpg`, mimeType, parents: [parent], modifiedTime: "2026-08-01T00:00:00Z" });
const config: UploadConfig = { placements: [{ placement_id: 1, placement_name: "Test site", partner_name: "Partner", is_earlyon: false, google_drive_folder_id: "root" }],
  activities: [{ id: 10, label: "Collage", week: 1 }, { id: 20, label: "Printmaking", week: 2 }], uploaders: [] };
function makeJob(): DriveImportJob { return { version: 1, jobId: "11111111-1111-4111-8111-111111111111", placementId: 1, placementName: "Test site", rootFolderId: "root",
  configurationHash: driveConfigurationHash(config, 1), initiatedBy: "test@example.test", startedAt: new Date().toISOString(), status: "running", phase: "scanning", cancelRequested: false,
  foldersScanned: 0, matchedFolders: 0, eligible: 0, results: [] }; }
function makeClient(tree: Record<string, DriveFile[]>, overrides = {}) {
  return { getFolder: async (id: string) => ({ ...folder(id), driveId: "shared" }),
    listChildren: async (id: string) => ({ files: tree[id] ?? [] }), ...overrides } as unknown as GoogleDriveClient;
}
function asset(id: string, driveId: string, extra: Partial<ImmichAsset> = {}): ImmichAsset {
  return { id, isArchived: false, duration: null, tags: [{ id: "source", name: `source:drive:${driveId}`, value: `source:drive:${driveId}` }], ...extra } as ImmichAsset;
}
const signal = () => new AbortController().signal;

test("source IDs preserve exact case, every source tag, and ignore empty IDs", () => {
  const value = asset("asset", "AbC", { tags: [{ id: "a", name: "SOURCE:DRIVE:AbC", value: "source:drive:AbC" },
    { id: "b", name: "source:drive:aBc", value: "source:drive:" }] });
  assert.deepEqual(driveSourceIds(value), ["AbC", "aBc"]);
  const index: SourceIndex = new Map();
  addSourceAsset(index, value);
  assert.equal(index.size, 2);
});

test("activity matching preserves explicit-week preference and conservative ties", () => {
  assert.equal(matchDriveActivity("Week 01 - 2026", config.activities).activity?.id, 10);
  assert.equal(matchDriveActivity("Week 2 - photo 1", config.activities).activity?.id, 20);
  assert.equal(matchDriveActivity("Week 1 and Week 2", config.activities).ambiguous, true);
  assert.equal(matchDriveActivity("No numbers", config.activities).activity, undefined);
  assert.equal(matchDriveActivity("3", [{ id: 3, label: "Activity 3" }]).activity?.id, 3);
});

test("scanner finds deep activities, inherits tags, excludes root media and conflicting descendants", async () => {
  const job = makeJob();
  const client = makeClient({ root: [media("loose", "root"), folder("org", "Documentation")], org: [folder("week", "Week 1")],
    week: [media("direct"), folder("photos", "Photos"), folder("conflict", "Week 2"), media("document", "week", "application/pdf")],
    photos: [media("nested", "photos"), folder("deep", "More photos")], deep: [media("deep-file", "deep")], conflict: [media("wrong", "conflict")] });
  await scanDrivePlacement({ client, config, job, signal: signal(), progress: async () => {} });
  assert.equal(job.eligible, 3);
  assert.deepEqual(job.results.filter((item) => item.status === "pending").map((item) => item.activityId), [10, 10, 10]);
  assert.equal(job.results.find((item) => item.fileId === "loose")?.status, "excluded");
  assert.equal(job.results.find((item) => item.fileId === "wrong")?.status, "excluded");
  assert.equal(job.results.find((item) => item.fileId === "conflict")?.status, "needs_review");
  assert.equal(job.results.find((item) => item.fileId === "document")?.status, "excluded");
});

test("scanner inherits case-insensitive Process folder types without affecting siblings or activity exclusions", async () => {
  for (const name of ["Process", "process", "PROCESS", "Work in PrOcEsS photos", "Postprocessing"]) {
    const job = makeJob();
    const client = makeClient({
      root: [folder("org", "PROCESS documentation")],
      org: [folder("week", "Week 1"), media("unmatched", "org")],
      week: [media("direct"), media("process-filename"), folder("photos", "Photos"), folder("sibling", "Final artwork")],
      photos: [folder("process", name)], sibling: [media("normal", "sibling")],
      process: [media("in-process", "process"), folder("deep", "Details"), folder("conflict", "Week 2"),
        media("document", "process", "application/pdf")],
      deep: [media("nested-video", "deep", "video/mp4")], conflict: [media("wrong", "conflict")],
    }, { getFolder: async () => ({ ...folder("root", "Process placement"), driveId: "shared" }) });
    await scanDrivePlacement({ client, config, job, signal: signal(), progress: async () => {} });
    assert.equal(job.eligible, 5, name);
    const pending = job.results.filter((item) => item.status === "pending");
    assert.deepEqual(pending.filter((item) => item.assetType === "process").map((item) => item.fileId), ["in-process", "nested-video"], name);
    assert.ok(pending.every((item) => item.activityId === 10), name);
    for (const id of ["direct", "process-filename", "normal"]) {
      assert.equal(pending.find((item) => item.fileId === id)?.assetType, undefined, `${name}: ${id}`);
    }
    for (const id of ["unmatched", "wrong", "document"]) {
      assert.equal(job.results.find((item) => item.fileId === id)?.status, "excluded", `${name}: ${id}`);
    }
    assert.equal(job.results.find((item) => item.fileId === "conflict")?.status, "needs_review");
  }
});

test("scanner follows short/empty pages, preserves Shared Drive scope, and deduplicates IDs", async () => {
  const job = makeJob();
  const calls: string[] = [];
  const client = makeClient({}, { listChildren: async (id: string, token?: string, driveId?: string) => {
    assert.equal(driveId, "shared"); calls.push(`${id}:${token ?? "first"}`);
    if (id === "root") return { files: [folder("week", "Week 1")] };
    if (!token) return { files: [], nextPageToken: "second" };
    if (token === "second") return { files: [media("first")], nextPageToken: "third" };
    return { files: [media("first"), media("last")] };
  } });
  await scanDrivePlacement({ client, config, job, signal: signal(), progress: async () => {} });
  assert.equal(job.eligible, 2);
  assert.ok(calls.includes("week:third"));
});

test("a rejected page token restarts once without losing or duplicating files", async () => {
  const job = makeJob(); let restarted = false;
  const client = makeClient({}, { listChildren: async (id: string, token?: string) => {
    if (id === "root") return { files: [folder("week", "Week 1")] };
    if (token === "invalid") { restarted = true; throw new Error("Invalid pageToken"); }
    return { files: restarted ? [media("first"), media("last")] : [media("first")], nextPageToken: restarted ? undefined : "invalid" };
  } });
  await scanDrivePlacement({ client, config, job, signal: signal(), progress: async () => {} });
  assert.equal(job.eligible, 2);
});

test("foreign placement roots are not traversed and read failures remain visible", async () => {
  const job = makeJob();
  const extended = { ...config, placements: [...config.placements, { ...config.placements[0], placement_id: 2, google_drive_folder_id: "foreign" }] };
  const client = makeClient({}, { listChildren: async (id: string) => {
    if (id === "root") return { files: [folder("foreign", "Week 1"), folder("denied", "Week 2")] };
    assert.notEqual(id, "foreign"); throw new Error("Permission denied");
  } });
  await scanDrivePlacement({ client, config: extended, job, signal: signal(), progress: async () => {} });
  assert.equal(job.results.find((item) => item.fileId === "foreign")?.status, "needs_review");
  assert.equal(job.results.find((item) => item.fileId === "denied")?.status, "failed");
});

test("scanner folder limit is an explicit incomplete-scan failure", async () => {
  await assert.rejects(scanDrivePlacement({ client: makeClient({ root: [folder("week", "Week 1")] }), config, job: makeJob(),
    signal: signal(), progress: async () => {}, maxFolders: 1 }), /safety limit/);
});

test("Drive folder browsing consumes more than 100 folders and requests pagination fields", async () => {
  const client = new GoogleDriveClient("test", "test", "test");
  let calls = 0;
  (client as unknown as { drive: unknown }).drive = { files: { list: async (params: { fields: string; pageToken?: string }) => {
    assert.match(params.fields, /nextPageToken/); calls++;
    return { data: params.pageToken ? { files: [folder("last")] } : { files: Array.from({ length: 100 }, (_, i) => folder(`f${i}`)), nextPageToken: "next" } };
  } } };
  assert.equal((await client.getFoldersInFolder("root")).length, 101);
  assert.equal(calls, 2);
});

test("Drive file listing exposes nextPageToken and rejects incompleteSearch", async () => {
  const client = new GoogleDriveClient("test", "test", "test");
  let incomplete = false;
  (client as unknown as { drive: unknown }).drive = { files: { list: async (params: { fields: string }) => {
    assert.match(params.fields, /nextPageToken/);
    return { data: { files: [media("a")], nextPageToken: "next", incompleteSearch: incomplete } };
  } } };
  assert.equal((await client.listFiles("root")).nextPageToken, "next");
  incomplete = true;
  await assert.rejects(client.listChildren("root"), /incomplete/);
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }, overrides: Partial<ConstructorParameters<typeof DriveAutoImportManager>[1]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "atlas-drive-test-"));
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const index: SourceIndex = new Map();
  const imported: string[] = [];
  const manager = new DriveAutoImportManager(new DriveJobStore(directory), {
    loadDriveSourceIndex: async () => index, findDriveSourceAssets: async (id) => index.get(id) ?? [],
    importNewDriveFile: async (params) => {
      imported.push(params.file.id);
      const id = `asset-${params.file.id}`;
      await params.checkpoint(id);
      addSourceAsset(index, asset(id, params.file.id));
      return { status: "imported", assetId: id };
    }, ...overrides,
  });
  return { manager, directory, index, imported };
}

test("manager imports once, skips archived and trashed IDs, and succeeds on an unchanged rerun", async (t) => {
  const { manager, index, imported, directory } = await fixture(t);
  addSourceAsset(index, asset("archive", "archived", { isArchived: true }));
  addSourceAsset(index, asset("trash", "trashed", { isTrashed: true }));
  const client = makeClient({ root: [folder("week", "Week 1")], week: [media("new"), media("archived"), media("trashed")] });
  const first = await manager.start(1, config, "test@example.test", client); await manager.waitForIdle();
  assert.deepEqual(imported, ["new"]);
  const firstStatus = await manager.status(1, config);
  assert.equal(firstStatus.latest?.status, "completed");
  assert.equal(firstStatus.latest?.counts.existing, 2);
  const saved = JSON.parse(await readFile(join(directory, `${first.jobId}.json`), "utf8"));
  assert.equal(saved.status, "completed"); assert.equal(JSON.stringify(saved).includes("refreshToken"), false);
  await manager.start(1, config, "test@example.test", client); await manager.waitForIdle();
  assert.equal((await manager.status(1, config)).latest?.counts.imported, 0);
  assert.equal(imported.length, 1);
});

test("manager writes and verifies Process tags on new imports, persists their type, and skips existing sources", async (t) => {
  const remoteAssets = new Map<string, ImmichAsset>([
    ["archive", asset("archive", "archived", { isArchived: true })],
    ["trash", asset("trash", "trashed", { isTrashed: true })],
  ]);
  const writtenTags = new Map<string, string[]>();
  let processReadsAfterWrite = 0;
  const mediaDeps = {
    uploadAsset: async ({ deviceAssetId }: { deviceAssetId?: string }) => {
      const id = deviceAssetId!.split(":").at(-1)!;
      remoteAssets.set(id, asset(id, "", { tags: [] }));
      return { id, status: "created" };
    },
    getAsset: async (id: string) => {
      const value = structuredClone(remoteAssets.get(id)!);
      // A successful import must wait until Immich actually exposes the Process tag.
      if (id === "new" && writtenTags.has(id) && ++processReadsAfterWrite === 1) {
        value.tags = value.tags!.filter((tag) => tag.name !== "asset_type:process");
      }
      return value;
    },
    tagAsset: async (id: string, names: string[]) => {
      writtenTags.set(id, names);
      remoteAssets.get(id)!.tags = names.map((name) => ({ id: name, name, value: name }));
    },
    prepareAudioAsVideo: async () => { throw new Error("Unexpected audio conversion"); },
  };
  const { manager, directory } = await fixture(t, {
    loadDriveSourceIndex: async () => {
      const index: SourceIndex = new Map();
      for (const value of remoteAssets.values()) addSourceAsset(index, value);
      return index;
    },
    importNewDriveFile: (params) => importNewDriveFile(params, mediaDeps),
  });
  const files = [media("regular"), media("new", "process"), media("deep", "details", "video/mp4")];
  const client = makeClient({ root: [folder("week", "Week 1")], week: [files[0], folder("process", "PrOcEsS photos")],
    process: [files[1], media("archived", "process"), media("trashed", "process"), folder("details", "Details")], details: [files[2]] }, {
    getFile: async (id: string) => files.find((file) => file.id === id)!,
    downloadFile: async () => Readable.from([Buffer.from("test")]),
  });
  const first = await manager.start(1, config, "test", client); await manager.waitForIdle();
  const status = await manager.status(1, config);
  assert.equal(status.latest?.status, "completed");
  assert.equal(status.latest?.counts.imported, 3);
  assert.equal(status.latest?.counts.existing, 2);
  assert.equal(processReadsAfterWrite, 2, "Process must be verified, not just submitted");
  for (const id of ["regular", "new", "deep"]) {
    const tags = writtenTags.get(id)!;
    assert.ok(tags.includes("placement:1")); assert.ok(tags.includes("activity:10"));
    assert.ok(tags.includes(`source:drive:${id}`));
    assert.equal(tags.includes("asset_type:process"), id !== "regular");
    assert.ok(!tags.includes("asset_type:artwork"));
  }
  assert.equal(writtenTags.size, 3, "archived and trashed sources must remain untouched");
  const saved = JSON.parse(await readFile(join(directory, `${first.jobId}.json`), "utf8")) as DriveImportJob;
  assert.equal(saved.results.find((item) => item.fileId === "new")?.assetType, "process");
  assert.equal(saved.results.find((item) => item.fileId === "deep")?.assetType, "process");
  await manager.start(1, config, "test", client); await manager.waitForIdle();
  assert.equal((await manager.status(1, config)).latest?.counts.existing, 5);
  assert.equal(writtenTags.size, 3);
});

test("failures preserve the prior success timestamp; changed configuration is marked stale", async (t) => {
  const { manager } = await fixture(t);
  await manager.start(1, config, "test", makeClient({ root: [folder("week", "Week 1")], week: [] })); await manager.waitForIdle();
  const successful = (await manager.status(1, config)).lastSuccessful?.jobId;
  await manager.start(1, config, "test", makeClient({}, { listChildren: async () => { throw new Error("denied"); } })); await manager.waitForIdle();
  const status = await manager.status(1, config);
  assert.equal(status.latest?.status, "completed_with_issues");
  assert.equal(status.lastSuccessful?.jobId, successful);
  const changed = { ...config, activities: [{ id: 10, label: "Changed", week: 1 }] };
  assert.equal((await manager.status(1, changed)).configurationChanged, true);
});

test("no matched folders does not establish a successful sync", async (t) => {
  const { manager } = await fixture(t);
  await manager.start(1, config, "test", makeClient({ root: [media("loose", "root")] })); await manager.waitForIdle();
  const status = await manager.status(1, config);
  assert.equal(status.latest?.status, "no_matches"); assert.equal(status.lastSuccessful, null);
});

test("duplicate starts reconnect to one job; manual writes are excluded; cancellation is durable", async (t) => {
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  const { manager } = await fixture(t, { loadDriveSourceIndex: async () => { await blocked; return new Map(); } });
  const client = makeClient({ root: [folder("week", "Week 1")], week: [media("new")] });
  const first = await manager.start(1, config, "test", client);
  const second = await manager.start(1, config, "test", client);
  assert.equal(second.jobId, first.jobId);
  assert.equal(acquireDriveWriter("manual"), null);
  await manager.cancel(first.jobId); unblock(); await manager.waitForIdle();
  assert.equal((await manager.status(1, config)).latest?.status, "cancelled");
  const release = acquireDriveWriter("manual"); assert.ok(release); release();
});

test("restart marks a persisted running job interrupted and retains recovery evidence", async (t) => {
  const { directory } = await fixture(t);
  const store = new DriveJobStore(directory); await store.initialize();
  const job = makeJob(); job.results = [{ kind: "file", fileId: "new", name: "new", path: "Week 1/new", status: "pending", createdAssetId: "owned" }];
  await store.save(job);
  job.status = "completed";
  assert.equal(store.jobs.get(job.jobId)?.status, "running", "unsaved mutations cannot publish success");
  const reloaded = new DriveJobStore(directory); await reloaded.initialize();
  assert.equal(reloaded.jobs.get(job.jobId)?.status, "interrupted");
  assert.equal(reloaded.jobs.get(job.jobId)?.results[0].createdAssetId, "owned");
});

test("partial tagging is resumed with the owned asset ID rather than skipped as existing", async (t) => {
  let calls = 0; let recovery: string | undefined;
  const { manager, index } = await fixture(t, { importNewDriveFile: async (params) => {
    calls++; recovery = params.recoveryAssetId;
    if (calls === 1) { await params.checkpoint("owned"); throw new Error("tag write failed"); }
    return { status: "imported", assetId: "owned" };
  } });
  const client = makeClient({ root: [folder("week", "Week 1")], week: [media("new")] });
  await manager.start(1, config, "test", client); await manager.waitForIdle();
  assert.equal((await manager.status(1, config)).latest?.status, "completed_with_issues");
  addSourceAsset(index, asset("owned", "new"));
  await manager.start(1, config, "test", client); await manager.waitForIdle();
  assert.equal(recovery, "owned"); assert.equal((await manager.status(1, config)).latest?.status, "completed");
});

test("incomplete Process imports retain their type through restart and tagging recovery", async (t) => {
  const { manager, directory } = await fixture(t, { importNewDriveFile: async (params) => {
    assert.ok(params.tags.includes("asset_type:process"));
    await params.checkpoint("owned");
    throw new Error("tag write failed");
  } });
  const client = makeClient({ root: [folder("week", "Week 1")], week: [folder("process", "PROCESS")], process: [media("new", "process")] });
  await manager.start(1, config, "test", client); await manager.waitForIdle();
  let recoveries = 0;
  const reloaded = new DriveAutoImportManager(new DriveJobStore(directory), {
    loadDriveSourceIndex: async () => new Map(), findDriveSourceAssets: async () => [],
    importNewDriveFile: async (params) => {
      assert.equal(params.recoveryAssetId, "owned");
      assert.ok(params.tags.includes("asset_type:process"));
      recoveries++;
      return { status: "imported", assetId: "owned" };
    },
  });
  const rerun = await reloaded.start(1, config, "test", client); await reloaded.waitForIdle();
  assert.equal(recoveries, 1);
  assert.equal((await reloaded.get(rerun.jobId))?.status, "completed");
  assert.equal((await reloaded.get(rerun.jobId))?.results[0].assetType, "process");
});

test("changed Process classification of an incomplete upload requires review instead of retagging", async (t) => {
  for (const initialFolder of ["Process", "Photos"]) {
    let calls = 0;
    const { manager } = await fixture(t, { importNewDriveFile: async (params) => {
      calls++;
      await params.checkpoint("owned");
      throw new Error("tag write failed");
    } });
    const client = (name: string) => makeClient({ root: [folder("week", "Week 1")],
      week: [folder("nested", name)], nested: [media("new", "nested")] });
    await manager.start(1, config, "test", client(initialFolder)); await manager.waitForIdle();
    const rerun = await manager.start(1, config, "test", client(initialFolder === "Process" ? "Photos" : "Process"));
    await manager.waitForIdle();
    const result = (await manager.get(rerun.jobId))?.results[0];
    assert.equal(calls, 1, "changed type must not cause a second upload or tag write");
    assert.equal(result?.status, "needs_review");
    assert.match(result?.detail ?? "", /asset type changed/);
  }
});

test("different placement source ownership is flagged and never reassigned", () => {
  assert.match(sourceConflict([asset("a", "id", { tags: [{ id: "p", name: "placement:2", value: "placement:2" }] })], 1)!, /another placement/);
  assert.match(sourceConflict([asset("a", "id"), asset("b", "id")], 1)!, /Multiple/);
  assert.equal(sourceConflict([asset("original", "id", { isArchived: true }), asset("edited", "id")], 1), undefined);
  assert.equal(sourceConflict([asset("archived", "id", { isArchived: true }), asset("trashed", "id", { isTrashed: true })], 1), undefined);
});

test("bounded spool removes partial files when the actual byte limit is exceeded", async (t) => {
  const { directory } = await fixture(t);
  await assert.rejects(spoolDriveFile(Readable.from([Buffer.alloc(100)]), directory, 50, signal()), /exceeds/);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(directory), []);
});

test("duplicate uploads never claim ownership; only newly created assets receive full tagging", async (t) => {
  const { directory } = await fixture(t);
  const file = media("new"); const events: string[] = [];
  let uploadStatus = "duplicate";
  const deps = {
    uploadAsset: async () => ({ id: "asset", status: uploadStatus }),
    getAsset: async () => asset("asset", "new", { tags: [{ id: "s", name: "source:drive:new", value: "source:drive:new" }] }),
    findDriveSourceAssets: async () => [],
    tagAsset: async () => { events.push("tags"); },
    prepareAudioAsVideo: async () => { throw new Error("Unexpected audio conversion"); },
  };
  const params = { client: { getFile: async () => file, downloadFile: async () => Readable.from([Buffer.from("test")]) }, file, tags: [],
    sourceLinkContext: { config, placementId: 1, activityId: 10 },
    tempDirectory: directory, signal: signal(), checkpoint: async () => { events.push("checkpoint"); } };
  assert.equal((await importNewDriveFile(params, deps)).status, "existing");
  assert.deepEqual(events, []);
  uploadStatus = "unknown-status";
  assert.equal((await importNewDriveFile(params, deps)).status, "needs_review");
  assert.deepEqual(events, []);
  uploadStatus = "created";
  assert.equal((await importNewDriveFile(params, deps)).status, "imported");
  assert.deepEqual(events, ["checkpoint", "tags"]);
});

test("manager persists linked-existing success without upload ownership or Process type changes and skips it on rerun", async (t) => {
  const existing = asset("existing", "", { isTrashed: true, tags: [
    { id: "p", name: "placement:1", value: "placement:1" }, { id: "a", name: "activity:10", value: "activity:10" },
  ] });
  let uploads = 0;
  const writtenTags: string[][] = [];
  const mediaDeps = {
    getAsset: async () => structuredClone(existing),
    findDriveSourceAssets: async (id: string) => driveSourceIds(existing).includes(id) ? [existing] : [],
    tagAsset: async (_id: string, names: string[]) => {
      writtenTags.push(names);
      existing.tags!.push(...names.map((name) => ({ id: "source", name, value: name })));
    },
    uploadAsset: async () => { uploads++; return { id: existing.id, status: "duplicate" }; },
    prepareAudioAsVideo: async () => { throw new Error("must not convert"); },
  };
  const { manager, directory } = await fixture(t, {
    loadDriveSourceIndex: async () => { const index: SourceIndex = new Map(); addSourceAsset(index, existing); return index; },
    findDriveSourceAssets: mediaDeps.findDriveSourceAssets,
    importNewDriveFile: (params) => importNewDriveFile(params, mediaDeps),
  });
  const client = makeClient({ root: [folder("week", "Week 1")], week: [folder("process", "Process photos")], process: [media("AbC", "process")] }, {
    getFile: async () => media("AbC", "process"), downloadFile: async () => Readable.from([Buffer.from("test")]),
  });
  const first = await manager.start(1, config, "test", client); await manager.waitForIdle();
  const status = await manager.status(1, config);
  assert.equal(status.latest?.status, "completed");
  assert.equal(status.latest?.counts.linked, 1);
  assert.equal(status.latest?.counts.imported, 0);
  assert.equal(status.latest?.counts.existing, 0);
  assert.equal(status.lastSuccessful?.jobId, first.jobId);
  assert.deepEqual(writtenTags, [["source:drive:AbC"]]);
  assert.equal(existing.isTrashed, true);
  const stored = JSON.parse(await readFile(join(directory, `${first.jobId}.json`), "utf8")) as DriveImportJob;
  assert.equal(stored.results[0].status, "linked");
  assert.equal(stored.results[0].assetId, "existing");
  assert.equal(stored.results[0].createdAssetId, undefined, "never run new-upload recovery against a checksum duplicate");
  const reloaded = new DriveJobStore(directory); await reloaded.initialize();
  assert.equal(reloaded.jobs.get(first.jobId)?.results[0].status, "linked");
  await manager.start(1, config, "test", client); await manager.waitForIdle();
  assert.equal((await manager.status(1, config)).latest?.counts.existing, 1);
  assert.equal((await manager.status(1, config)).latest?.counts.linked, 0);
  assert.equal(uploads, 1); assert.equal(writtenTags.length, 1);
});

test("an interrupted source-link verification never creates an owned-upload recovery record", async (t) => {
  let owned = false;
  const { directory } = await fixture(t);
  const file = media("new");
  const result = await importNewDriveFile({ client: { getFile: async () => file, downloadFile: async () => Readable.from([Buffer.from("test")]) },
    file, tags: ["placement:1", "activity:10"], sourceLinkContext: { config, placementId: 1, activityId: 10 },
    tempDirectory: directory, signal: signal(), checkpoint: async () => { owned = true; } }, {
    uploadAsset: async () => ({ id: "existing", status: "duplicate" }),
    getAsset: async () => asset("existing", "", { tags: [] }),
    findDriveSourceAssets: async () => [],
    tagAsset: async () => { throw new Error("Connection dropped"); },
    prepareAudioAsVideo: async () => { throw new Error("must not convert"); },
  });
  assert.equal(result.status, "needs_review"); assert.equal(result.assetId, "existing"); assert.equal(owned, false);
});

test("additive recovery never changes an archived or trashed asset", async () => {
  for (const extra of [{ isArchived: true }, { isTrashed: true }]) {
    const result = await importNewDriveFile({ client: {} as GoogleDriveClient, file: media("id"), recoveryAssetId: "owned", tags: [],
      tempDirectory: "unused", signal: signal(), checkpoint: async () => assert.fail("unexpected checkpoint") }, {
      getAsset: async () => asset("owned", "id", extra), tagAsset: async () => assert.fail("must not tag"),
      uploadAsset: async () => { throw new Error("must not upload"); }, prepareAudioAsVideo: async () => { throw new Error("must not convert"); },
    });
    assert.equal(result.status, "needs_review");
  }
});

test("Immich source inventory includes trash, stacked children, API-key-accessible visibilities, and every page", async (t) => {
  const queries: Array<{ visibility: string; page: number }> = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.withDeleted, true);
    assert.equal(body.withStacked, true);
    queries.push(body);
    // Immich v3 requires an elevated user session for locked assets, even with a valid API key.
    if (body.visibility === "locked") {
      return Response.json({ message: "Elevated permission is required" }, { status: 401 });
    }
    return new Response(JSON.stringify({ assets: { items: [asset(`${body.visibility}-${body.page}`, `${body.visibility}-${body.page}`)],
      nextPage: body.page === 1 ? "2" : null } }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal((await sourceAssets()).length, 6);
  assert.deepEqual([...new Set(queries.map((query) => query.visibility))], ["timeline", "archive", "hidden"]);
  assert.ok(queries.every((query) => query.page === 1 || query.page === 2));
});

test("source-specific rechecks include archive and trash without requesting locked assets", async (t) => {
  const visibilities: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.tagIds, ["source-tag"]);
    assert.equal(body.withDeleted, true);
    assert.equal(body.withStacked, true);
    assert.notEqual(body.visibility, "locked");
    visibilities.push(body.visibility);
    return Response.json({ assets: { items: body.visibility === "archive"
      ? [asset("archived", "existing", { isArchived: true }), asset("trashed", "existing", { isTrashed: true })]
      : [], nextPage: null } });
  });
  assert.deepEqual((await sourceAssets(["source-tag"])).map((item) => item.id), ["archived", "trashed"]);
  assert.deepEqual(visibilities, ["timeline", "archive", "hidden"]);
});

test("Immich elevated-session rejection is not misreported as a stale API key", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Elevated permission is required" }, { status: 401 }));
  await assert.rejects(searchAssets({ visibility: "locked" }), (error: Error) => {
    assert.match(error.message, /elevated user session/i);
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /invalid|expired|stale/);
    return true;
  });
});

test("source inventory fails closed on ordinary authentication errors, including during archive lookup", async (t) => {
  for (const responseBody of [JSON.stringify({ message: "Invalid API key" }), "Unauthorized"]) {
    const requests: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push(body.visibility);
      return body.visibility === "timeline" ? Response.json({ assets: { items: [], nextPage: null } })
        : new Response(responseBody, { status: 401 });
    });
    await assert.rejects(sourceAssets(), /Immich authentication failed \(401\)/);
    assert.deepEqual(requests, ["timeline", "archive"]);
  }
});

test("failed final history write cannot establish a successful sync", async (t) => {
  const { manager } = await fixture(t);
  const originalSave = manager.store.save.bind(manager.store);
  manager.store.save = (job) => job.status === "completed" ? Promise.reject(new Error("disk full")) : originalSave(job);
  await manager.start(1, config, "test", makeClient({ root: [folder("week", "Week 1")] })); await manager.waitForIdle();
  const status = await manager.status(1, config);
  assert.equal(status.lastSuccessful, null);
  assert.equal(status.latest?.status, "failed");
});

test("tag verification preserves existing label casing but requires the exact source ID", async () => {
  const result = await importNewDriveFile({ client: {} as GoogleDriveClient, file: media("AbC"), recoveryAssetId: "owned",
    tags: ["Collage"], tempDirectory: "unused", signal: signal(), checkpoint: async () => {} }, {
    getAsset: async () => asset("owned", "AbC", { tags: [{ id: "s", name: "SOURCE:DRIVE:AbC", value: "SOURCE:DRIVE:AbC" }, { id: "a", name: "COLLAGE", value: "COLLAGE" }] }),
    tagAsset: async () => {}, uploadAsset: async () => { throw new Error("must not upload"); }, prepareAudioAsVideo: async () => { throw new Error("must not convert"); },
  });
  assert.equal(result.status, "imported");
});

test("pending uploads reassigned by an administrator are not retagged", async () => {
  const result = await importNewDriveFile({ client: {} as GoogleDriveClient, file: media("AbC"), recoveryAssetId: "owned",
    tags: ["placement:1", "activity:10"], tempDirectory: "unused", signal: signal(), checkpoint: async () => {} }, {
    getAsset: async () => asset("owned", "AbC", { tags: [{ id: "p", name: "placement:2", value: "placement:2" }] }),
    tagAsset: async () => assert.fail("must not retag"), uploadAsset: async () => { throw new Error("must not upload"); }, prepareAudioAsVideo: async () => { throw new Error("must not convert"); },
  });
  assert.equal(result.status, "needs_review");
});
