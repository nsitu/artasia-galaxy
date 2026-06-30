import { Router, type Response } from "express";
import {
  clearAuthCookies,
  createGoogleAuthUrl,
  exchangeGoogleCode,
  getAuthContext,
  readOAuthState,
  setAuthSession,
  setOAuthStateCookie,
} from "../services/auth.service.js";

const router = Router();

function redirectWithError(res: Response, message: string) {
  const params = new URLSearchParams({ auth: "error", message });
  res.redirect(`/?${params.toString()}`);
}

router.get("/google/start", (_req, res) => {
  try {
    const auth = createGoogleAuthUrl();
    setOAuthStateCookie(res, {
      state: auth.state,
      nonce: auth.nonce,
      exp: Date.now() + 10 * 60 * 1000,
    });
    res.redirect(auth.url);
  } catch (err) {
    redirectWithError(res, (err as Error).message);
  }
});

router.get("/google/callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const oauthState = readOAuthState(req);

    clearAuthCookies(res);

    if (!code) throw new Error("Google login callback was missing a code.");
    if (!oauthState || !state || oauthState.state !== state) {
      throw new Error("Google login state did not match.");
    }

    const profile = await exchangeGoogleCode(code, oauthState.nonce);
    setAuthSession(res, profile);
    res.redirect("/?auth=success");
  } catch (err) {
    redirectWithError(res, (err as Error).message);
  }
});

router.get("/me", async (req, res) => {
  try {
    res.json(await getAuthContext(req));
  } catch (err) {
    res.status(500).json({ authenticated: false, error: (err as Error).message });
  }
});

router.post("/logout", (_req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

export default router;
