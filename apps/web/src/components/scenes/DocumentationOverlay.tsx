import { useEffect, useRef } from "react";
import type { MapPlacement, ProcessGalleryAsset } from "../../api/client";
import "./DocumentationOverlay.css";

interface DocumentationOverlayProps {
  placement: MapPlacement;
  processAssets: ProcessGalleryAsset[];
  processAssetsLoading?: boolean;
  processAssetsError?: string | null;
  onProcessAssetClick?: (asset: ProcessGalleryAsset) => void;
  onClose: () => void;
}

export default function DocumentationOverlay({
  placement,
  processAssets,
  processAssetsLoading = false,
  processAssetsError,
  onProcessAssetClick,
  onClose,
}: DocumentationOverlayProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = `atlas-documentation-overlay-title-${placement.placement_id}`;

  useEffect(() => {
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  return (
    <div
      className="atlas-documentation-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <article
        className="atlas-documentation-overlay__card"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="atlas-documentation-overlay__header">
          <div>
            <div className="atlas-documentation-overlay__eyebrow">
              Pedagogical documentation
            </div>
            <h2 id={titleId}>
              {placement.documentation_title || placement.placement_name}
            </h2>
            {placement.documentation_title && (
              <p className="atlas-documentation-overlay__placement">
                {placement.placement_name}
              </p>
            )}
            {placement.documentation_attribution && (
              <p className="atlas-documentation-overlay__attribution">
                {placement.documentation_attribution}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="atlas-documentation-overlay__close atlas-control-surface"
            onClick={onClose}
            aria-label="Close documentation"
            title="Close documentation"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="atlas-documentation-overlay__body">
          <div
            className="atlas-documentation-overlay__content"
            dangerouslySetInnerHTML={{
              __html: placement.documentation_content_html ?? "",
            }}
          />
            <aside
              className="atlas-documentation-overlay__assets"
              aria-label="Process assets"
            >
              {processAssetsLoading && (
                <div className="atlas-documentation-overlay__assets-status atlas-documentation-overlay__assets-status--loading">
                  <span className="atlas-documentation-overlay__loading-spinner" aria-hidden="true" />
                  <span>Loading</span>
                </div>
              )}
              {!processAssetsLoading && processAssetsError && (
                <div className="atlas-documentation-overlay__assets-status">
                  Process assets could not be loaded.
                </div>
              )}
              {!processAssetsLoading && !processAssetsError && processAssets.length === 0 && (
                <div className="atlas-documentation-overlay__assets-status">
                  No process assets are available for this placement.
                </div>
              )}
              {processAssets.length > 0 && (
                <div className="atlas-documentation-overlay__assets-grid">
                  {processAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className="atlas-documentation-overlay__asset"
                      onClick={() => onProcessAssetClick?.(asset)}
                      aria-label={asset.caption ? `View process asset: ${asset.caption}` : "View process asset"}
                    >
                      <span className="atlas-documentation-overlay__asset-media">
                        {asset.thumbnailUrl ? (
                          <img src={asset.thumbnailUrl} alt={asset.alt} loading="lazy" />
                        ) : (
                          <span aria-hidden="true" className="atlas-documentation-overlay__asset-placeholder">
                            {asset.mediaKind === "audio" ? "♪" : "▶"}
                          </span>
                        )}
                        {asset.mediaKind !== "image" && (
                          <span className="atlas-documentation-overlay__asset-kind">
                            {asset.mediaKind === "audio" ? "Sound" : "Video"}
                          </span>
                        )}
                      </span>
                      {asset.caption && (
                        <span className="atlas-documentation-overlay__asset-caption">
                          {asset.caption}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </aside>
        </div>
      </article>
    </div>
  );
}
