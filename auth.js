import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { dataPath, storage } from "./storage.js";

export function authConfig() {
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "";
  const appUrl = process.env.APP_URL || productionUrl || vercelUrl || "http://localhost:5173";
  const apiUrl = process.env.API_URL || appUrl || "http://localhost:3001";
  return {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    secret: process.env.AUTH_SECRET || "open-ide-dev-secret",
    appUrl,
    apiUrl,
    secureCookies: Boolean(process.env.VERCEL) || appUrl.startsWith("https://"),
  };
}

export function githubConfigured() {
  const { clientId, clientSecret } = authConfig();
  return Boolean(clientId && clientSecret);
}

function sign(data) {
  return createHmac("sha256", authConfig().secret).update(data).digest("base64url");
}

export function createAuthCookie(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function createGitHubTokenCookie(token) {
  const data = Buffer.from(String(token || ""), "utf8").toString("base64url");
  return `${data}.${sign(data)}`;
}

export function parseGitHubTokenCookie(raw) {
  if (!raw) return null;
  const [data, sig] = String(raw).split(".");
  if (!data || !sig) return null;
  const expected = sign(data);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    return Buffer.from(data, "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

export function parseAuthCookie(raw) {
  if (!raw) return null;
  const [data, sig] = String(raw).split(".");
  if (!data || !sig) return null;
  const expected = sign(data);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function signState(state) {
  return createHmac("sha256", authConfig().secret).update(state).digest("base64url");
}

export function createOAuthState() {
  return randomBytes(16).toString("hex");
}

export function oauthStateCookie(state) {
  return `${state}.${signState(state)}`;
}

export function verifyOAuthStateCookie(raw, expectedState) {
  if (!raw || !expectedState) return false;
  const [state, sig] = String(raw).split(".");
  if (state !== expectedState || !sig) return false;
  const expected = signState(state);
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyOAuthState(state, cookieValue) {
  return verifyOAuthStateCookie(cookieValue, state);
}

export function githubAuthorizeUrl(state) {
  const { clientId, apiUrl } = authConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${apiUrl}/api/auth/github/callback`,
    scope: "read:user repo",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGitHubCode(code) {
  const { clientId, clientSecret, apiUrl } = authConfig();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${apiUrl}/api/auth/github/callback`,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || "GitHub OAuth failed");
  }
  return data.access_token;
}

export async function fetchGitHubUser(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "OpenIDE",
    },
  });
  if (!res.ok) throw new Error("Failed to load GitHub profile");
  return res.json();
}

async function tokenPath(githubId) {
  return dataPath("auth", `${githubId}.json`);
}

export async function storeGitHubToken(githubId, token) {
  await storage.writeText(
    await tokenPath(githubId),
    JSON.stringify({ githubId, token, updatedAt: new Date().toISOString() }, null, 2)
  );
}

export async function loadGitHubToken(githubId) {
  try {
    const raw = await storage.readText(await tokenPath(githubId));
    return JSON.parse(raw).token;
  } catch {
    return null;
  }
}

export async function resolveAuthUser(req) {
  const cookie = parseAuthCookie(req.cookies?.open_ide_user);
  if (!cookie?.githubId) return null;
  const tokenFromCookie = parseGitHubTokenCookie(req.cookies?.open_ide_gh_token);
  const token = tokenFromCookie || (await loadGitHubToken(cookie.githubId));
  if (!token) return null;
  return { ...cookie, token };
}
