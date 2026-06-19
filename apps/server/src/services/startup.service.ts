import { ensureConfiguredAlbums, getPublishedAlbum } from "../infra/ImmichClient.js";
import { getUploadConfig } from "./uploadConfig.service.js";

export async function initializeImmichStructure() {
  const config = getUploadConfig();
  await getPublishedAlbum();
  await ensureConfiguredAlbums(config.uploaders);
}
