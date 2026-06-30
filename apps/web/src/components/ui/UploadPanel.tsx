import { useEffect, useMemo, useRef, useState } from "react";
import {
  assignAssetPlacement,
  assignAssetUploader,
  fetchAuthUser,
  fetchPlacementAssetSet,
  fetchPlacementAssets,
  fetchUploadOptions,
  fetchUntaggedPlacementAssets,
  logoutAuthUser,
  uploadFiles,
  type AuthUser,
  type UploadOptions,
  type PlacementAsset,
} from "../../api/client";

interface UploadItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "processing" | "completed" | "failed" | "retrying";
  progress: number;
  error?: string;
  assetId?: string;
}

interface UploadPanelProps {
  initialError?: string | null;
}

export default function UploadPanel({ initialError }: UploadPanelProps) {
  const [options, setOptions] = useState<UploadOptions | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [uploaderKey, setUploaderKey] = useState("");
  const [placementKey, setPlacementKey] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [activityTagFilter, setActivityTagFilter] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [placementAssets, setPlacementAssets] = useState<PlacementAsset[]>([]);
  const [assetMode, setAssetMode] = useState<"placements" | "untagged">("placements");
  const [selectedAsset, setSelectedAsset] = useState<PlacementAsset | null>(null);
  const [managePlacementKey, setManagePlacementKey] = useState("");
  const [manageUploaderKey, setManageUploaderKey] = useState("");
  const [savingAsset, setSavingAsset] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadInProgressRef = useRef(false);

  function placementLabel(location: UploadOptions["placements"][number]) {
    return location.partner_name
      ? `${location.partner_name} - ${location.placement_name}`
      : location.placement_name;
  }

  useEffect(() => {
    if (options) return;
    const authFallback: AuthUser = { authenticated: false };
    Promise.all([
      fetchUploadOptions(),
      fetchAuthUser().catch(() => authFallback),
    ])
      .then(([data, auth]) => {
        setOptions(data);
        const currentUser = data.currentUser ?? auth;
        setAuthUser(currentUser);
        const matchedUploaderId = data.currentUser?.uploader_id ?? auth.uploader?.id ?? null;
        if (matchedUploaderId) {
          setUploaderKey(String(matchedUploaderId));
        }
        setSelectedTag(data.tags[0] ?? "");
      })
      .catch((err) => setError((err as Error).message));
  }, [options]);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  const selectedUploader = useMemo(() => {
    if (!options) return null;
    return options.uploaders.find((uploader) => String(uploader.id) === uploaderKey) ?? null;
  }, [options, uploaderKey]);

  function placementIncludesUploader(placement: UploadOptions["placements"][number], uploaderId: number) {
    return placement.team_member_id === uploaderId || placement.secondary_team_member_id === uploaderId;
  }

  const filteredPlacements = useMemo(() => {
    if (!options) return [];
    if (!selectedUploader) return options.placements;
    return options.placements.filter((placement) => placementIncludesUploader(placement, selectedUploader.id));
  }, [options, selectedUploader]);

  const selectedPlacement = useMemo(() => {
    return filteredPlacements.find((placement) => String(placement.placement_id) === placementKey) ?? null;
  }, [filteredPlacements, placementKey]);

  const visiblePlacementIds = useMemo(() => {
    return selectedPlacement
      ? [selectedPlacement.placement_id]
      : filteredPlacements.map((placement) => placement.placement_id);
  }, [filteredPlacements, selectedPlacement]);

  useEffect(() => {
    setPlacementKey((current) =>
      filteredPlacements.some((placement) => String(placement.placement_id) === current) ? current : ""
    );
  }, [filteredPlacements]);

  useEffect(() => {
    if (assetMode === "untagged") {
      let cancelled = false;
      setAssetsLoading(true);
      fetchUntaggedPlacementAssets()
        .then((assets) => {
          if (!cancelled) setPlacementAssets(assets);
        })
        .catch((err) => {
          if (!cancelled) setError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setAssetsLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    if (visiblePlacementIds.length === 0) {
      setPlacementAssets([]);
      return;
    }

    let cancelled = false;
    setAssetsLoading(true);
    fetchPlacementAssetSet(visiblePlacementIds, activityTagFilter || undefined)
      .then((assets) => {
        if (!cancelled) setPlacementAssets(assets);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assetMode, visiblePlacementIds, activityTagFilter]);

  function addFiles(fileList: FileList | File[]) {
    if (!selectedUploader) {
      setError("Select an Artasia Team Member before adding files.");
      return;
    }
    if (!selectedPlacement) {
      setError("Select a placement before adding files.");
      return;
    }

    const files = Array.from(fileList);
    setError(null);
    setItems((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        status: "queued" as const,
        progress: 0,
      })),
    ]);
  }

  useEffect(() => {
    const hasQueued = items.some((item) => item.status === "queued");
    if (!hasQueued || uploadInProgressRef.current) return;
    void uploadQueued();
  }, [items, selectedUploader, selectedPlacement, selectedTag]);

  async function uploadQueued() {
    if (uploadInProgressRef.current) return;
    if (!selectedUploader) {
      setError("Select an Artasia Team Member.");
      return;
    }
    if (!selectedPlacement) {
      setError("Select a placement.");
      return;
    }

    uploadInProgressRef.current = true;
    const queued = items.filter((item) => item.status === "queued" || item.status === "failed");
    try {
      for (const item of queued) {
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: entry.status === "failed" ? "retrying" : "uploading",
                  progress: 0,
                  error: undefined,
                }
              : entry
          )
        );

        try {
          const results = await uploadFiles({
            files: [item.file],
            uploader: selectedUploader,
            location: selectedPlacement,
            tags: selectedTag ? [selectedTag] : [],
            onProgress: (progress) => {
              setItems((current) =>
                current.map((entry) =>
                  entry.id === item.id
                    ? {
                        ...entry,
                        status: progress >= 100 ? "processing" : "uploading",
                        progress,
                      }
                    : entry
                )
              );
            },
          });

          const result = results[0];
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? result?.status === "completed"
                  ? { ...entry, status: "completed", progress: 100, assetId: result.assetId }
                  : {
                      ...entry,
                      status: "failed",
                      progress: 100,
                      error: result?.error ?? "Upload failed",
                    }
                : entry
            )
          );
        } catch (err) {
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: "failed", error: (err as Error).message }
                : entry
            )
          );
        }
      }
    } finally {
      uploadInProgressRef.current = false;
      if (selectedPlacement) {
        fetchPlacementAssets(selectedPlacement.placement_id)
          .then(setPlacementAssets)
          .catch((err) => setError((err as Error).message));
      }
    }
  }

  function selectPlacement(placement: UploadOptions["placements"][number]) {
    setPlacementKey(String(placement.placement_id));
    setAssetMode("placements");
    setSelectedAsset(null);
    setItems([]);
    setError(null);
    if (selectedUploader && placementIncludesUploader(placement, selectedUploader.id)) return;
    if (placement.team_member_id) setUploaderKey(String(placement.team_member_id));
  }

  function refreshVisibleAssets() {
    setAssetsLoading(true);
    const request = assetMode === "untagged"
      ? fetchUntaggedPlacementAssets()
      : fetchPlacementAssetSet(visiblePlacementIds, activityTagFilter || undefined);

    request
      .then(setPlacementAssets)
      .catch((err) => setError((err as Error).message))
      .finally(() => setAssetsLoading(false));
  }

  function assetGalleryTitle() {
    if (assetMode === "untagged") return "Uploads Needing Placement";
    return selectedPlacement ? "Existing Uploads" : "Existing Uploads for Visible Placements";
  }

  function openAssetManager(asset: PlacementAsset) {
    setSelectedAsset(asset);
    setManagePlacementKey(selectedPlacement ? String(selectedPlacement.placement_id) : "");
    setManageUploaderKey(asset.uploader_id ? String(asset.uploader_id) : "");
    setError(null);
  }

  function closeAssetManager() {
    setSelectedAsset(null);
    setManagePlacementKey("");
    setManageUploaderKey("");
  }

  async function saveSelectedAssetChanges() {
    if (!selectedAsset) return;
    const placementId = managePlacementKey ? parseInt(managePlacementKey, 10) : null;
    const uploaderId = manageUploaderKey ? parseInt(manageUploaderKey, 10) : null;
    const placementChanged = Boolean(managePlacementKey)
      && managePlacementKey !== (selectedPlacement ? String(selectedPlacement.placement_id) : "");
    const uploaderChanged = Boolean(manageUploaderKey)
      && manageUploaderKey !== (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");

    if (!placementChanged && !uploaderChanged) {
      setError("Choose a placement or team member album to save.");
      return;
    }
    if (placementChanged && (!placementId || !Number.isFinite(placementId))) {
      setError("Select a placement to assign this upload.");
      return;
    }
    if (uploaderChanged && (!uploaderId || !Number.isFinite(uploaderId))) {
      setError("Select a team member album for this upload.");
      return;
    }

    setSavingAsset(true);
    try {
      if (placementChanged && placementId) {
        await assignAssetPlacement({
          assetId: selectedAsset.id,
          placementId,
        });
      }
      if (uploaderChanged && uploaderId) {
        await assignAssetUploader({
          assetId: selectedAsset.id,
          uploaderId,
        });
      }
      closeAssetManager();
      refreshVisibleAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingAsset(false);
    }
  }

  async function signOut() {
    try {
      await logoutAuthUser();
      setAuthUser({ authenticated: false });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function renderAssetCard(asset: PlacementAsset) {
    return (
      <button key={asset.id} type="button" onClick={() => openAssetManager(asset)} style={assetCardStyle}>
        <img src={asset.thumbnailUrl} alt="" style={assetImageStyle} />
        <span style={assetNameStyle}>{asset.fileName}</span>
        <span style={assetDateStyle}>{asset.uploader_name ?? "No team member album"}</span>
        <span style={assetDateStyle}>{new Date(asset.createdAt).toLocaleDateString()}</span>
      </button>
    );
  }

  function renderAssetGrid(emptyMessage: string) {
    if (assetsLoading) return <div style={emptyStateStyle}>Loading uploads...</div>;
    if (placementAssets.length === 0) return <div style={emptyStateStyle}>{emptyMessage}</div>;
    return <div style={assetGridStyle}>{placementAssets.map(renderAssetCard)}</div>;
  }

  function renderAssetManager() {
    if (!selectedAsset) return null;
    const placementChanged = Boolean(managePlacementKey)
      && managePlacementKey !== (selectedPlacement ? String(selectedPlacement.placement_id) : "");
    const uploaderChanged = Boolean(manageUploaderKey)
      && manageUploaderKey !== (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const canSaveAsset = placementChanged || uploaderChanged;

    return (
      <div style={managePanelStyle}>
        <div style={managePreviewStyle}>
          {selectedAsset.type === "VIDEO" ? (
            <video src={selectedAsset.previewUrl} controls style={manageMediaStyle} />
          ) : (
            <img src={selectedAsset.previewUrl} alt="" style={manageMediaStyle} />
          )}
        </div>
        <div style={manageDetailsStyle}>
          <div style={manageHeaderStyle}>
            <div>
              <h3 style={sectionTitleStyle}>Manage Upload</h3>
              <div style={assetNameStyle}>{selectedAsset.fileName}</div>
              <div style={assetDateStyle}>{new Date(selectedAsset.createdAt).toLocaleString()}</div>
              <div style={assetDateStyle}>
                Album: {selectedAsset.uploader_name ?? "No team member album"}
              </div>
            </div>
            <button type="button" onClick={closeAssetManager} style={secondaryButtonStyle}>
              Close
            </button>
          </div>

          <label style={labelStyle}>
            Artasia Site
            <select
              value={managePlacementKey}
              onChange={(e) => setManagePlacementKey(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select a placement</option>
              {(options?.placements ?? []).map((placement) => (
                <option key={placement.placement_id} value={String(placement.placement_id)}>
                  {placementLabel(placement)}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Asset Owner
            <select
              value={manageUploaderKey}
              onChange={(e) => setManageUploaderKey(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select a team member</option>
              {(options?.uploaders ?? []).map((uploader) => (
                <option key={uploader.id} value={String(uploader.id)}>
                  {uploader.name}
                </option>
              ))}
            </select>
          </label>
          <div style={manageActionsStyle}>
            <button
              type="button"
              onClick={saveSelectedAssetChanges}
              disabled={savingAsset || !canSaveAsset}
              style={primaryActionButtonStyle}
            >
              {savingAsset ? "Saving..." : "Save"}
            </button>
            <a href={selectedAsset.previewUrl} target="_blank" rel="noreferrer" style={secondaryLinkButtonStyle}>
              Open Preview
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <div style={headerStyle}>
          <div>
            <h1 style={titleStyle}>Admin</h1>
            <p style={introStyle}>
              Review placement uploads and add new documentation.
            </p>
          </div>
          <a href="/" style={secondaryLinkButtonStyle}>
            Viewer
          </a>
        </div>

        <div style={authBarStyle}>
          {authUser?.authenticated ? (
            <>
              <span>
                Signed in as {authUser.email}
                {authUser.uploader_name || authUser.uploader?.name
                  ? ` - matched to ${authUser.uploader_name ?? authUser.uploader?.name}`
                  : " - no matching Artasia Team Member email"}
              </span>
              <button type="button" onClick={signOut} style={secondaryButtonStyle}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <span>Sign in with Google to preselect your Artasia Team Member.</span>
              <a href="/api/v1/auth/google/start" style={primaryLinkButtonStyle}>
                Sign in with Google
              </a>
            </>
          )}
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={adminLayoutStyle}>
          <aside style={placementMenuStyle}>
            <label style={labelStyle}>
              Team Member
              <select
                value={uploaderKey}
                onChange={(e) => {
                  setUploaderKey(e.target.value);
                  setPlacementKey("");
                  setSelectedAsset(null);
                  setItems([]);
                  setError(null);
                }}
                style={inputStyle}
              >
                <option value="">All Team Members</option>
                {(options?.uploaders ?? []).map((uploader) => (
                  <option key={uploader.id} value={String(uploader.id)}>
                    {uploader.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={labelStyle}>
              Program Week / Activity
              <select
                value={activityTagFilter}
                onChange={(e) => {
                  setActivityTagFilter(e.target.value);
                  setSelectedAsset(null);
                }}
                style={inputStyle}
              >
                <option value="">All Activities</option>
                {(options?.tags ?? []).map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>

            <div style={menuHeaderStyle}>
              <span>Placements</span>
              <span>{filteredPlacements.length}</span>
            </div>

            <div style={placementListStyle}>
              <button
                type="button"
                onClick={() => {
                  setPlacementKey("");
                  setAssetMode("placements");
                  setSelectedAsset(null);
                  setItems([]);
                }}
                style={{
                  ...placementButtonStyle,
                  ...(!selectedPlacement && assetMode === "placements" ? selectedPlacementButtonStyle : {}),
                }}
              >
                <span style={placementNameStyle}>All Visible Placements</span>
                <span style={placementMetaStyle}>Browse uploads across this menu</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlacementKey("");
                  setAssetMode("untagged");
                  setSelectedAsset(null);
                  setItems([]);
                }}
                style={{
                  ...placementButtonStyle,
                  ...(assetMode === "untagged" ? selectedPlacementButtonStyle : {}),
                }}
              >
                <span style={placementNameStyle}>Needs Placement</span>
                <span style={placementMetaStyle}>Uploads without a placement tag</span>
              </button>
            </div>

            <div style={placementListStyle}>
              {filteredPlacements.map((placement) => (
                <button
                  key={placement.placement_id}
                  type="button"
                  onClick={() => selectPlacement(placement)}
                  style={{
                    ...placementButtonStyle,
                    ...(selectedPlacement?.placement_id === placement.placement_id ? selectedPlacementButtonStyle : {}),
                  }}
                >
                  <span style={placementNameStyle}>{placementLabel(placement)}</span>
                  <span style={placementMetaStyle}>
                    {placement.team_member_name ?? "Unassigned"}
                    {placement.secondary_team_member_name ? ` + ${placement.secondary_team_member_name}` : ""}
                  </span>
                  {placement.delivery_schedule && (
                    <span style={placementMetaStyle}>{placement.delivery_schedule}</span>
                  )}
                </button>
              ))}
            </div>
          </aside>

          <section style={detailStyle}>
            {selectedPlacement ? (
              <>
                <div style={detailHeaderStyle}>
                  <div>
                    <h2 style={detailTitleStyle}>{placementLabel(selectedPlacement)}</h2>
                    <div style={detailMetaStyle}>
                      Lead: {selectedPlacement.team_member_name ?? "Unassigned"}
                      {selectedPlacement.secondary_team_member_name
                        ? ` | Secondary: ${selectedPlacement.secondary_team_member_name}`
                        : ""}
                    </div>
                    {selectedPlacement.delivery_schedule && (
                      <div style={detailMetaStyle}>{selectedPlacement.delivery_schedule}</div>
                    )}
                  </div>
                  <div style={countBadgeStyle}>
                    {assetsLoading ? "..." : placementAssets.length} upload{placementAssets.length === 1 ? "" : "s"}
                  </div>
                </div>

                <div style={uploadControlsStyle}>
                  <label style={compactLabelStyle}>
                    Program Week / Activity
                    <select
                      value={selectedTag}
                      onChange={(e) => setSelectedTag(e.target.value)}
                      style={inputStyle}
                    >
                      {(options?.tags ?? []).map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    style={dropzoneStyle}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      addFiles(e.dataTransfer.files);
                    }}
                    onClick={() => {
                      if (!selectedUploader) {
                        setError("Select an Artasia Team Member before adding files.");
                        return;
                      }
                      inputRef.current?.click();
                    }}
                  >
                    Drop images or videos here
                    <span style={{ color: "#777", marginTop: 6 }}>or click to choose files</span>
                    <input
                      ref={inputRef}
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      style={{ display: "none" }}
                      disabled={!selectedUploader}
                      onChange={(e) => e.target.files && addFiles(e.target.files)}
                    />
                  </div>
                </div>

                {items.length > 0 && (
                  <div style={listStyle}>
                    {items.map((item) => (
                      <div key={item.id} style={itemStyle}>
                        <div style={thumbStyle}>
                          {item.assetId ? (
                            <img
                              src={`/api/v1/assets/${item.assetId}/thumbnail`}
                              alt=""
                              style={thumbImageStyle}
                            />
                          ) : (
                            <span style={{ color: "#666", fontSize: 11 }}>
                              {item.status === "failed" ? "failed" : "uploading"}
                            </span>
                          )}
                        </div>
                        <div>
                          <div style={{ color: "#eee" }}>{item.file.name}</div>
                          <div style={{ color: item.status === "failed" ? "#f88" : "#888", fontSize: 12 }}>
                            {item.status}
                            {item.error ? ` - ${item.error}` : ""}
                          </div>
                        </div>
                        {item.status === "failed" ? (
                          <button
                            onClick={() => {
                              setItems((current) =>
                                current.map((entry) =>
                                  entry.id === item.id
                                    ? { ...entry, status: "queued", progress: 0, error: undefined }
                                    : entry
                                )
                              );
                            }}
                            style={retryButtonStyle}
                          >
                            Retry
                          </button>
                        ) : (
                          <div style={progressTrackStyle}>
                            <div style={{ ...progressBarStyle, width: `${item.progress}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div style={assetGridHeaderStyle}>
                  <h3 style={sectionTitleStyle}>{assetGalleryTitle()}</h3>
                  <button
                    type="button"
                    onClick={refreshVisibleAssets}
                    style={secondaryButtonStyle}
                  >
                    Refresh
                  </button>
                </div>

                {renderAssetManager()}
                {renderAssetGrid("No uploads tagged to this placement yet.")}
              </>
            ) : (
              <>
                <div style={detailHeaderStyle}>
                  <div>
                    <h2 style={detailTitleStyle}>All Visible Placement Uploads</h2>
                    <div style={detailMetaStyle}>Select a placement to upload or narrow this gallery.</div>
                  </div>
                  <div style={countBadgeStyle}>
                    {assetsLoading ? "..." : placementAssets.length} upload{placementAssets.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div style={assetGridHeaderStyle}>
                  <h3 style={sectionTitleStyle}>{assetGalleryTitle()}</h3>
                  <button
                    type="button"
                    onClick={refreshVisibleAssets}
                    style={secondaryButtonStyle}
                  >
                    Refresh
                  </button>
                </div>
                {renderAssetManager()}
                {renderAssetGrid(
                  assetMode === "untagged"
                    ? "No uploads need placement right now."
                    : "No uploads tagged to the visible placements yet."
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0b0d12",
  color: "#ddd",
  padding: 18,
  boxSizing: "border-box",
  fontFamily: "system-ui, sans-serif",
  overflowY: "auto",
};

const panelStyle: React.CSSProperties = {
  width: "min(1680px, 100%)",
  margin: "0 auto",
  background: "#11131a",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  padding: 18,
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
};

const introStyle: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#b9bfcc",
  fontSize: 14,
  lineHeight: 1.45,
};

const authBarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  color: "#b9bfcc",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  padding: "9px 10px",
  marginBottom: 12,
  fontSize: 13,
  flexWrap: "wrap",
};

const primaryLinkButtonStyle: React.CSSProperties = {
  color: "#0b0d12",
  background: "#e8edf8",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 4,
  padding: "7px 10px",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryLinkButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
  color: "#ddd",
};

const primaryActionButtonStyle: React.CSSProperties = {
  color: "#0b0d12",
  background: "#e8edf8",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const adminLayoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(260px, 340px) 1fr",
  gap: 16,
  alignItems: "start",
  minHeight: 0,
};

const placementMenuStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  minWidth: 0,
  position: "sticky",
  top: 18,
  maxHeight: "calc(100vh - 36px)",
  overflow: "hidden",
};

const menuHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  color: "#b9bfcc",
  fontSize: 13,
};

const placementListStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  maxHeight: "calc(100vh - 128px)",
  overflowY: "auto",
  paddingRight: 4,
};

const placementButtonStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  textAlign: "left",
  background: "#171a22",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 10,
  cursor: "pointer",
};

const selectedPlacementButtonStyle: React.CSSProperties = {
  borderColor: "rgba(232,237,248,0.65)",
  background: "#202431",
};

const placementNameStyle: React.CSSProperties = {
  color: "#f2f2f2",
  fontSize: 13,
  lineHeight: 1.35,
};

const placementMetaStyle: React.CSSProperties = {
  color: "#8f98a8",
  fontSize: 12,
  lineHeight: 1.3,
};

const detailStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: "calc(100vh - 154px)",
  background: "#0f1118",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  padding: 14,
  overflow: "visible",
};

const detailHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  alignItems: "flex-start",
  marginBottom: 14,
};

const detailTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f2f2f2",
  fontSize: 18,
  lineHeight: 1.3,
};

const detailMetaStyle: React.CSSProperties = {
  color: "#9aa3b3",
  fontSize: 12,
  marginTop: 5,
};

const countBadgeStyle: React.CSSProperties = {
  color: "#0b0d12",
  background: "#e8edf8",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const uploadControlsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 260px) 1fr",
  gap: 12,
  alignItems: "end",
};

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 0.85fr) minmax(260px, 1.4fr) minmax(150px, 0.85fr)",
  gap: 12,
  alignItems: "end",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#aaa",
  minWidth: 0,
};

const compactLabelStyle: React.CSSProperties = {
  ...labelStyle,
};

const siteLabelStyle: React.CSSProperties = {
  ...labelStyle,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background: "#191c25",
  color: "#f2f2f2",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  padding: "9px 10px",
};

const dropzoneStyle: React.CSSProperties = {
  minHeight: 94,
  border: "1px dashed rgba(255,255,255,0.35)",
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#ccc",
  cursor: "pointer",
};

const listStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 14,
};

const assetGridHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 18,
  marginBottom: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f2f2f2",
  fontSize: 15,
};

const managePanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 280px) 1fr",
  gap: 14,
  background: "#171a22",
  border: "1px solid rgba(232,237,248,0.28)",
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
};

const managePreviewStyle: React.CSSProperties = {
  minWidth: 0,
};

const manageMediaStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: 280,
  objectFit: "contain",
  borderRadius: 4,
  background: "#0c0e13",
};

const manageDetailsStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  alignContent: "start",
  minWidth: 0,
};

const manageHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const manageActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const assetGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
  gap: 10,
};

const assetCardStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  color: "#ddd",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 8,
  minWidth: 0,
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

const assetImageStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  objectFit: "cover",
  borderRadius: 4,
  background: "#0c0e13",
};

const assetNameStyle: React.CSSProperties = {
  color: "#eee",
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const assetDateStyle: React.CSSProperties = {
  color: "#8f98a8",
  fontSize: 11,
};

const emptyStateStyle: React.CSSProperties = {
  color: "#8f98a8",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 16,
};

const itemStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "54px 1fr 140px",
  gap: 12,
  alignItems: "center",
  background: "#171a22",
  borderRadius: 4,
  padding: 10,
};

const progressTrackStyle: React.CSSProperties = {
  height: 6,
  background: "#2a2e3a",
  borderRadius: 999,
  overflow: "hidden",
};

const progressBarStyle: React.CSSProperties = {
  height: "100%",
  background: "#d8e7ff",
};

const retryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
};

const thumbStyle: React.CSSProperties = {
  width: 54,
  height: 44,
  background: "#0c0e13",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const thumbImageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const errorStyle: React.CSSProperties = {
  color: "#ffb0b0",
  background: "rgba(255,0,0,0.12)",
  border: "1px solid rgba(255,0,0,0.22)",
  padding: 10,
  borderRadius: 4,
  marginBottom: 12,
};
