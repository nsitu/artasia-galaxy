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

function safeReturnTo(value: unknown) {
  if (typeof value !== "string") return "/admin";
  return /^\/edit\/[0-9a-f-]{36}$/i.test(value) ? value : "/admin";
}

function redirectWithError(res: Response, message: string, returnTo = "/admin") {
  const params = new URLSearchParams({ auth: "error", message });
  res.redirect(`${safeReturnTo(returnTo)}?${params.toString()}`);
}

router.get("/google/start", (req, res) => {
  try {
    const auth = createGoogleAuthUrl();
    setOAuthStateCookie(res, {
      state: auth.state,
      nonce: auth.nonce,
      returnTo: safeReturnTo(req.query.returnTo),
      exp: Date.now() + 10 * 60 * 1000,
    });
    res.redirect(auth.url);
  } catch (err) {
    redirectWithError(res, (err as Error).message);
  }
});

router.get("/google/callback", async (req, res) => {
  let returnTo = "/admin";
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const oauthState = readOAuthState(req);
    returnTo = safeReturnTo(oauthState?.returnTo);

    clearAuthCookies(res);

    if (!code) throw new Error("Google login callback was missing a code.");
    if (!oauthState || !state || oauthState.state !== state) {
      throw new Error("Google login state did not match.");
    }

    const profile = await exchangeGoogleCode(code, oauthState.nonce);
    const sessionPayload = {
      ...profile,
      refreshToken: profile.refreshToken || undefined,
    };
    setAuthSession(res, sessionPayload);
    res.redirect(`${returnTo}?auth=success`);
  } catch (err) {
    redirectWithError(res, (err as Error).message, returnTo);
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
