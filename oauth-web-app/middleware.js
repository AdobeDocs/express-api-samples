import "dotenv/config";
import express from "express";
import session from "express-session";
import crypto from "node:crypto";
import http from "node:http";

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI = "https://localhost:4000/callback",
  SESSION_SECRET = "dev-only-change-me",
  NODE_ENV = "development",
  // To use staging environment, uncomment the relevant lines in .env.
  IMS_HOST = "https://ims-na1.adobelogin.com",
  EXPRESS_API_HOST = "https://express-api.adobe.io",
} = process.env;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing CLIENT_ID or CLIENT_SECRET. Copy .env.example to .env and fill it in.",
  );
  process.exit(1);
}

const IMS_AUTHORIZE = `${IMS_HOST}/ims/authorize/v2`;
const IMS_TOKEN = `${IMS_HOST}/ims/token/v3`;
const EXPRESS_API = EXPRESS_API_HOST;
const SCOPES = ["openid", "ee.express_api", "AdobeID"];

console.log(`[config] IMS:         ${IMS_HOST}`);
console.log(`[config] Express API: ${EXPRESS_API_HOST}`);

export function createApp() {
  const app = express();
  // Vite proxies us with X-Forwarded-Proto: https — trust it so secure session cookies work.
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  // ---------- OAuth ----------

  app.get("/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    const url = new URL(IMS_AUTHORIZE);
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    console.log("[oauth] redirecting to authorize URL:");
    console.log("  " + url.toString());
    console.log("[oauth] params:");
    console.log("  client_id:    " + CLIENT_ID);
    console.log("  redirect_uri: " + REDIRECT_URI);
    console.log("  scope:        " + SCOPES.join(" "));
    res.redirect(url.toString());
  });

  app.get("/callback", async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) {
      return res
        .status(400)
        .send(`OAuth error: ${error} - ${error_description || ""}`);
    }
    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send("Invalid OAuth state");
    }
    delete req.session.oauthState;

    const tokens = await fetchTokens({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    if (!tokens) return res.status(500).send("Token exchange failed");

    storeTokens(req, tokens);
    res.redirect("/");
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // ---------- Express API proxy ----------

  app.get("/api/me", (req, res) => {
    res.json({ authenticated: !!req.session.tokens });
  });

  app.get(
    "/api/templates",
    requireAuth(async (req, res, token) => {
      const start = Number(req.query.start || 0);
      const limit = Number(req.query.limit || 25);
      const sortBy = req.query.sortBy || "-modifiedDate";
      const qs = new URLSearchParams({ start, limit, sortBy }).toString();
      const upstreamPath = `/beta/tagged-documents?${qs}`;
      console.log("[/api/templates] incoming query:", req.query);
      console.log("[/api/templates] parsed:", { start, limit, sortBy });
      console.log(
        "[/api/templates] token present:",
        !!token,
        "len:",
        token?.length,
      );
      console.log("[/api/templates] -> GET " + EXPRESS_API + upstreamPath);
      const t0 = Date.now();
      const r = await callExpressApi(token, upstreamPath);
      console.log(`[/api/templates] <- ${r.status} in ${Date.now() - t0}ms`);
      if (r.status >= 400) {
        console.error("[/api/templates] error body:", r.body);
      }
      res.status(r.status).json(r.body);
    }),
  );

  app.get(
    "/api/templates/:id",
    requireAuth(async (req, res, token) => {
      const id = encodeURIComponent(req.params.id);
      const start = req.query.start ? `?start=${Number(req.query.start)}` : "";
      const r = await callExpressApi(
        token,
        `/beta/tagged-documents/${id}${start}`,
      );
      res.status(r.status).json(r.body);
    }),
  );

  app.post(
    "/api/generate",
    requireAuth(async (req, res, token) => {
      const r = await callExpressApi(token, "/beta/generate-variation", {
        method: "POST",
        body: JSON.stringify(req.body),
      });
      res.status(r.status).json(r.body);
    }),
  );

  app.get(
    "/api/status/:jobId",
    requireAuth(async (req, res, token) => {
      const id = encodeURIComponent(req.params.jobId);
      const r = await callExpressApi(token, `/status/${id}`);
      res.status(r.status).json(r.body);
    }),
  );

  // ---------- Dev helpers ----------

  if (NODE_ENV === "development") {
    app.get("/debug/token", async (req, res) => {
      const token = await ensureFreshToken(req);
      if (!token) return res.status(401).json({ error: "not_authenticated" });
      res.json({
        access_token: token,
        expires_at: new Date(req.session.tokens.expires_at).toISOString(),
        hint: "Use this in cURL/Python for testing. Tokens last ~24h.",
      });
    });
  }

  return app;
}

export function startBackend(port) {
  const server = http.createServer(createApp());
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `[backend] listening on http://127.0.0.1:${port} (proxied by Vite)`,
    );
  });
  return server;
}

// ---------- helpers ----------

async function fetchTokens(params) {
  const body = new URLSearchParams(params).toString();
  const resp = await fetch(IMS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    console.error("IMS token error", resp.status, await resp.text());
    return null;
  }
  return resp.json();
}

function storeTokens(req, tokens) {
  req.session.tokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
  };
  console.warn("LOGS for Debugging purposes only!");
  // DELETE IN PRODUCTION
  console.log("tokens:", tokens);
  console.log("  access_token: " + tokens.access_token);
  console.log("  refresh_token: " + tokens.refresh_token);
  console.log(
    "  expires_at: " + new Date(req.session.tokens.expires_at).toISOString(),
  );
}

async function ensureFreshToken(req) {
  const t = req.session.tokens;
  if (!t) return null;
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) {
    delete req.session.tokens;
    return null;
  }
  const refreshed = await fetchTokens({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  if (!refreshed) {
    delete req.session.tokens;
    return null;
  }
  storeTokens(req, refreshed);
  console.log("[oauth] refreshed access token");
  return req.session.tokens.access_token;
}

async function callExpressApi(token, pathAndQuery, init = {}) {
  const resp = await fetch(`${EXPRESS_API}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-API-KEY": CLIENT_ID,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: resp.status, body: json };
}

function requireAuth(handler) {
  return async (req, res) => {
    const token = await ensureFreshToken(req);
    if (!token) return res.status(401).json({ error: "not_authenticated" });
    return handler(req, res, token);
  };
}
