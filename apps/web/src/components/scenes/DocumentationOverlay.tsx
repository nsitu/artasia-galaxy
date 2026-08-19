import { useEffect, useRef } from "react";
import type { MapPlacement } from "../../api/client";
import "./DocumentationOverlay.css";

interface DocumentationOverlayProps {
  placement: MapPlacement;
  onClose: () => void;
}

export default function DocumentationOverlay({
  placement,
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
      previousActiveElement?.focus();
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
        <div
          className="atlas-documentation-overlay__content"
          dangerouslySetInnerHTML={{
            __html: placement.documentation_content_html ?? "",
          }}
        />
      </article>
    </div>
  );
}
