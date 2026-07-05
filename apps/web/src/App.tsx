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
  const [adminAuthError, setAdminAuthError] = useState<string | null>(() => getAdminAuthError());

  useEffect(() => {
    if (window.location.search.includes("auth=")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }

    const onPopState = () => {
      setPath(window.location.pathname);
      setAdminAuthError(getAdminAuthError());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("admin-page", path === "/admin");
    return () => document.documentElement.classList.remove("admin-page");
  }, [path]);

  if (path === "/admin") {
    return <UploadPanel initialError={adminAuthError} />;
  }

  if (path === "/partners") {
    return <PartnerUploadPanel />;
  }

  return <ArtScene />;
}
