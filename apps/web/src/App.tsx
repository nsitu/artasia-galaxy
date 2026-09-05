import { useEffect, useState } from "react";
import ArtScene from "./components/scenes/ArtScene";
import SlideshowViewer from "./components/slideshow/SlideshowViewer";
import PartnerUploadPanel from "./components/ui/PartnerUploadPanel";
import ToolsPanel from "./components/ui/ToolsPanel";
import UploadPanel from "./components/ui/UploadPanel";
import UpdateAvailableBanner from "./components/system/UpdateAvailableBanner";

function getAdminAuthError() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") !== "error") return null;
  return params.get("message") ?? "Google sign-in failed.";
}

export default function App() {
  return (
    <>
      <UpdateAvailableBanner />
      <AppContent />
    </>
  );
}

function AppContent() {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  const [adminAuthError, setAdminAuthError] = useState<string | null>(() =>
    getAdminAuthError(),
  );
  const { path, search } = location;

  useEffect(() => {
    if (window.location.search.includes("auth=")) {
      const params = new URLSearchParams(window.location.search);
      params.delete("auth");
      params.delete("message");
      const nextSearch = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
      );
      setLocation({
        path: window.location.pathname,
        search: window.location.search,
      });
    }

    const onPopState = () => {
      setLocation({
        path: window.location.pathname,
        search: window.location.search,
      });
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
    if (path === "/admin/tools") {
      return <ToolsPanel initialError={adminAuthError} />;
    }

    // Extract initialAssetId from /admin/edit/{immich-id}
    const adminEditMatch = path.match(/^\/admin\/edit\/([0-9a-f-]{36})$/i);
    return (
      <UploadPanel
        initialError={adminAuthError}
        initialAssetId={adminEditMatch?.[1]}
        adminPath={path}
        adminSearch={search}
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

  if (path === "/slideshow") {
    const placementValue = new URLSearchParams(search).get("placement")?.trim();
    const placementId = placementValue && /^\d+$/.test(placementValue)
      ? Number(placementValue)
      : undefined;
    return <SlideshowViewer placementId={placementId} />;
  }

  return <ArtScene />;
}
