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
import type { ImmichAsset } from "../infra/ImmichClient.js";
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

test("additive upload never tags a checksum duplicate and checkpoints before tagging a new asset", async (t) => {
  const { directory } = await fixture(t);
  const file = media("new"); const events: string[] = [];
  let duplicate = true;
  const deps = {
    uploadAsset: async () => ({ id: "asset", status: duplicate ? "duplicate" : "created" }),
    getAsset: async () => asset("asset", "new", { tags: [{ id: "s", name: "source:drive:new", value: "source:drive:new" }] }),
    tagAsset: async () => { events.push("tags"); },
    prepareAudioAsVideo: async () => { throw new Error("Unexpected audio conversion"); },
  };
  const params = { client: { getFile: async () => file, downloadFile: async () => Readable.from([Buffer.from("test")]) }, file, tags: [],
    tempDirectory: directory, signal: signal(), checkpoint: async () => { events.push("checkpoint"); } };
  assert.equal((await importNewDriveFile(params, deps)).status, "needs_review");
  assert.deepEqual(events, []);
  duplicate = false;
  assert.equal((await importNewDriveFile(params, deps)).status, "imported");
  assert.deepEqual(events, ["checkpoint", "tags"]);
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

test("Immich source inventory explicitly includes trash, stacked children, all visibilities, and every page", async (t) => {
  const queries: Array<{ visibility: string; page: number }> = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.withDeleted, true);
    assert.equal(body.withStacked, true);
    queries.push(body);
    return new Response(JSON.stringify({ assets: { items: [asset(`${body.visibility}-${body.page}`, `${body.visibility}-${body.page}`)],
      nextPage: body.page === 1 ? "2" : null } }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal((await sourceAssets()).length, 8);
  assert.deepEqual([...new Set(queries.map((query) => query.visibility))], ["timeline", "archive", "hidden", "locked"]);
  assert.ok(queries.every((query) => query.page === 1 || query.page === 2));
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
