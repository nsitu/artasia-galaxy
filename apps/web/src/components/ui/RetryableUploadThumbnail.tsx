import { useEffect, useState, type CSSProperties } from "react";

const THUMBNAIL_RETRY_DELAYS_MS = [1500, 3000, 6000, 10000, 15000];

interface RetryableUploadThumbnailProps {
  assetId: string;
  src?: string;
  imageStyle: CSSProperties;
  placeholderStyle: CSSProperties;
}

export default function RetryableUploadThumbnail({
  assetId,
  src,
  imageStyle,
  placeholderStyle,
}: RetryableUploadThumbnailProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setLoaded(false);
    setWaiting(false);
  }, [assetId]);

  useEffect(() => {
    if (!waiting) return;
    if (attempt >= THUMBNAIL_RETRY_DELAYS_MS.length) return;

    const timeoutId = window.setTimeout(() => {
      setWaiting(false);
      setAttempt((current) => current + 1);
    }, THUMBNAIL_RETRY_DELAYS_MS[attempt]);

    return () => window.clearTimeout(timeoutId);
  }, [attempt, waiting]);

  const baseSrc = src ?? `/api/v1/assets/${assetId}/thumbnail?v=${encodeURIComponent(assetId)}`;
  const retrySrc = `${baseSrc}${baseSrc.includes("?") ? "&" : "?"}thumbnailAttempt=${attempt}`;

  return (
    <>
      {!loaded && (
        <span style={placeholderStyle}>
          {attempt >= THUMBNAIL_RETRY_DELAYS_MS.length ? "pending" : "processing"}
        </span>
      )}
      {!waiting && (
        <img
          key={`${assetId}-${attempt}`}
          src={retrySrc}
          alt=""
          style={{
            ...imageStyle,
            display: loaded ? "block" : "none",
          }}
          onLoad={() => {
            setLoaded(true);
            setWaiting(false);
          }}
          onError={() => {
            setLoaded(false);
            setWaiting(attempt < THUMBNAIL_RETRY_DELAYS_MS.length);
          }}
        />
      )}
    </>
  );
}
