import { useEffect, useState, type CSSProperties } from "react";

const THUMBNAIL_RETRY_DELAYS_MS = [1500, 3000, 6000, 10000, 15000];

interface RetryableUploadThumbnailProps {
  assetId: string;
  src?: string;
  imageStyle: CSSProperties;
  placeholderStyle: CSSProperties;
  exhaustedLabel?: string;
}

export default function RetryableUploadThumbnail({
  assetId,
  src,
  imageStyle,
  placeholderStyle,
  exhaustedLabel = "pending",
}: RetryableUploadThumbnailProps) {
  const [attempt, setAttempt] = useState(0);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    setAttempt(0);
  }, [assetId, src]);

  const baseSrc = src ?? `/api/v1/assets/${assetId}/thumbnail?v=${encodeURIComponent(assetId)}`;
  const retrySrc = `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}thumbnailAttempt=${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    let retryTimeoutId: number | undefined;
    let fetchedObjectUrl: string | undefined;

    setObjectUrl(null);
    void fetch(retrySrc, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Thumbnail unavailable (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) return;
        fetchedObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(fetchedObjectUrl);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (attempt >= THUMBNAIL_RETRY_DELAYS_MS.length) return;
        retryTimeoutId = window.setTimeout(() => {
          setAttempt((current) => current + 1);
        }, THUMBNAIL_RETRY_DELAYS_MS[attempt]);
      });

    return () => {
      controller.abort();
      if (retryTimeoutId !== undefined) window.clearTimeout(retryTimeoutId);
      if (fetchedObjectUrl) URL.revokeObjectURL(fetchedObjectUrl);
    };
  }, [attempt, retrySrc]);

  return (
    <>
      {!objectUrl && (
        <span style={placeholderStyle}>
          {attempt >= THUMBNAIL_RETRY_DELAYS_MS.length ? exhaustedLabel : "processing"}
        </span>
      )}
      {objectUrl && (
        <img
          src={objectUrl}
          alt=""
          style={imageStyle}
        />
      )}
    </>
  );
}
