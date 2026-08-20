import { ensureConfiguredAlbums, getPublishedAlbum } from "../infra/ImmichClient.js";
import { getUploadConfig } from "./uploadConfig.service.js";
import { collectDrift } from "./reconcile.service.js";

export async function initializeImmichStructure() {
  const config = await getUploadConfig();
  await getPublishedAlbum();
  await ensureConfiguredAlbums(config.uploaders.map((uploader) => uploader.name));
}

export async function logReconcileDriftAtBoot() {
  if (process.env.RECONCILE_SKIP_BOOT_DRIFT === "1") return;
  try {
    const drift = await collectDrift();
    const orphaned = drift.orphaned.length;
    const restored = drift.restored.length;
    if (orphaned || restored) {
      console.warn(
        `[startup] reconcile drift: ${orphaned} orphaned, ${restored} to restore (in-sync: ${drift.inSync}/${drift.scanned})`
      );
    } else {
      console.log(`[startup] reconcile drift: clean (${drift.scanned} anchors in-sync)`);
    }
  } catch (err) {
    console.warn(`[startup] reconcile drift check failed: ${(err as Error).message}`);
  }
}
