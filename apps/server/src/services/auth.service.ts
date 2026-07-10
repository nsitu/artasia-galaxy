import crypto from "node:crypto";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { getUploadConfig, type UploadUploader } from "./uploadConfig.service.js";

const AUTH_COOKIE = "artasia_auth";
const OAUTH_COOKIE = "artasia_oauth";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const OAUTH_MAX_AGE_SECONDS = 60 * 10;

interface AuthSessionPayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  hd?: string;
  refreshToken?: string;
  exp: number;
}

export interface AuthContext {
  authenticated: boolean;
  email?: string;
  name?: string;
  picture?: string;
  hostedDomain?: string;
  uploader?: UploadUploader | null;
}

interface OAuthStatePayload {
  state: string;
  nonce: string;
  returnTo?: string;
  exp: number;
}

export function getAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
    allowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN ?? "artsforall.co",
    sessionSecret: process.env.SESSION_SECRET ?? "",
  };
}

function requireAuthConfig() {
  const config = getAuthConfig();
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Google auth is not configured: missing ${missing.join(", ")}`);
  }

  return config;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function encodeSignedPayload(payload: unknown, secret: string) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

function decodeSignedPayload<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

function cookieOptions(maxAgeSeconds: number) {
  const secure = process.env.NODE_ENV === "production";
  return [
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearCookie(res: Response, name: string) {
  res.append("Set-Cookie", `${name}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function clearAuthCookies(res: Response) {
  clearCookie(res, AUTH_COOKIE);
  clearCookie(res, OAUTH_COOKIE);
}

export function setOAuthStateCookie(res: Response, payload: OAuthStatePayload) {
  const { sessionSecret } = requireAuthConfig();
  res.cookie(OAUTH_COOKIE, encodeSignedPayload(payload, sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OAUTH_MAX_AGE_SECONDS * 1000,
  });
}

export function readOAuthState(req: Request) {
  const { sessionSecret } = requireAuthConfig();
  const value = parseCookies(req.headers.cookie).get(OAUTH_COOKIE);
  const payload = decodeSignedPayload<OAuthStatePayload>(value, sessionSecret);
  if (!payload || payload.exp < Date.now()) return null;
  return payload;
}

export function setAuthSession(res: Response, session: Omit<AuthSessionPayload, "exp">) {
  const { sessionSecret } = requireAuthConfig();
  const payload: AuthSessionPayload = {
    ...session,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const value = encodeSignedPayload(payload, sessionSecret);
  res.append("Set-Cookie", `${AUTH_COOKIE}=${encodeURIComponent(value)}; ${cookieOptions(SESSION_MAX_AGE_SECONDS)}`);
}

export function readAuthSession(req: Request) {
  const { sessionSecret } = getAuthConfig();
  if (!sessionSecret) return null;
  const value = parseCookies(req.headers.cookie).get(AUTH_COOKIE);
  const payload = decodeSignedPayload<AuthSessionPayload>(value, sessionSecret);
  if (!payload || payload.exp < Date.now()) return null;
  return payload;
}

async function findUploaderByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const config = await getUploadConfig();
  return config.uploaders.find((uploader) => uploader.email?.trim().toLowerCase() === normalized) ?? null;
}

export async function getAuthContext(req: Request): Promise<AuthContext> {
  const session = readAuthSession(req);
  if (!session) return { authenticated: false };

  return {
    authenticated: true,
    email: session.email,
    name: session.name,
    picture: session.picture,
    hostedDomain: session.hd,
    uploader: await findUploaderByEmail(session.email),
  };
}

export function createGoogleAuthUrl() {
  const config = requireAuthConfig();
  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);

  return {
    state,
    nonce,
    url: client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
      state,
      nonce,
      hd: config.allowedDomain,
    }),
  };
}

export async function exchangeGoogleCode(code: string, nonce: string) {
  const config = requireAuthConfig();
  const client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) {
    throw new Error("Google did not return an ID token.");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.clientId,
  });
  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Google ID token payload was empty.");
  }
  if (payload.nonce !== nonce) {
    throw new Error("Google login nonce did not match.");
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error("Google account email is not verified.");
  }
  if (payload.hd !== config.allowedDomain) {
    throw new Error(`Use your @${config.allowedDomain} Google Workspace account.`);
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name,
    picture: payload.picture,
    hd: payload.hd,
    refreshToken: tokens.refresh_token,
  };
}
