import { useEffect, useState } from "react";
import ArtScene from "./components/scenes/ArtScene";
import PartnerUploadPanel from "./components/ui/PartnerUploadPanel";
import UploadPanel from "./components/ui/UploadPanel";

function getAdminAuthError() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") !== "error") return null;
  return params.get("message") ?? "Google sign-in failed.";
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(() =>
    getAdminAuthError(),
  );

  useEffect(() => {
    if (window.location.search.includes("auth=")) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.hash,
      );
    }

    const onPopState = () => {
      setPath(window.location.pathname);
      setAdminAuthError(getAdminAuthError());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const usesDocumentScroll =
      path === "/admin" ||
      path.startsWith("/admin/") ||
      path === "/partners" ||
      /^\/edit\/[0-9a-f-]{36}$/i.test(path);
    document.documentElement.classList.toggle(
      "document-scroll-page",
      usesDocumentScroll,
    );
    return () =>
      document.documentElement.classList.remove("document-scroll-page");
  }, [path]);

  const adminBase = "/admin";
  const adminRoutes = ["", "/browse", "/upload", "/import"];
  const isAdminPath = path === adminBase || path.startsWith(adminBase + "/");

  if (isAdminPath) {
    // Extract initialAssetId from /admin/edit/{immich-id}
    const adminEditMatch = path.match(/^\/admin\/edit\/([0-9a-f-]{36})$/i);
    return (
      <UploadPanel
        initialError={adminAuthError}
        initialAssetId={adminEditMatch?.[1]}
        adminPath={path}
      />
    );
  }

  // Legacy /edit/{id} route for backward compatibility
  const editMatch = path.match(/^\/edit\/([0-9a-f-]{36})$/i);
  if (editMatch) {
    return (
      <UploadPanel
        initialError={adminAuthError}
        initialAssetId={editMatch[1]}
      />
    );
  }

  if (path === "/partners") {
    return <PartnerUploadPanel />;
  }

  return <ArtScene />;
}
