import "dotenv/config";
import express from "express";
import http from "node:http";

const {
  CLIENT_ID,
  CLIENT_SECRET,
  SCOPES = "openid,AdobeID,ee.express_api",
  NODE_ENV = "development",
  IMS_HOST = "https://ims-na1.adobelogin.com",
  EXPRESS_API_HOST = "https://express-api.adobe.io",
  SHARED_PROJECT_ID = "",
} = process.env;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Missing CLIENT_ID or CLIENT_SECRET. Copy .env.example to .env and fill it in.",
  );
  process.exit(1);
}

const IMS_TOKEN = `${IMS_HOST}/ims/token/v3`;
const EXPRESS_API = EXPRESS_API_HOST;

console.log(`[config] IMS:         ${IMS_HOST}`);
console.log(`[config] Express API: ${EXPRESS_API_HOST}`);
console.log(`[config] Scopes:      ${SCOPES}`);
console.log(
  `[config] Shared project: ${SHARED_PROJECT_ID || "(unset — variations land in tech account's own folder)"}`,
);

let cachedToken = null;

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());

  // ---------- Express API proxy ----------

  app.get("/api/templates", withToken(async (req, res, token) => {
    const start = Number(req.query.start || 0);
    const limit = Number(req.query.limit || 25);
    const sortBy = req.query.sortBy || "-modifiedDate";
    const qs = new URLSearchParams({ start, limit, sortBy }).toString();
    const upstreamPath = `/beta/tagged-documents?${qs}`;
    console.log("[/api/templates] -> GET " + EXPRESS_API + upstreamPath);
    const t0 = Date.now();
    const r = await callExpressApi(token, upstreamPath);
    console.log(`[/api/templates] <- ${r.status} in ${Date.now() - t0}ms`);
    if (r.status >= 400) {
      console.error("[/api/templates] error body:", r.body);
    }
    res.status(r.status).json(r.body);
  }));

  app.get("/api/templates/:id", withToken(async (req, res, token) => {
    const id = encodeURIComponent(req.params.id);
    const start = req.query.start ? `?start=${Number(req.query.start)}` : "";
    const r = await callExpressApi(
      token,
      `/beta/tagged-documents/${id}${start}`,
    );
    res.status(r.status).json(r.body);
  }));

  app.post("/api/generate", withToken(async (req, res, token) => {
    // If SHARED_PROJECT_ID is configured and the client didn't pass its own
    // projectId, inject it so the variation lands in the shared project that
    // end users have access to (per the company-templates workflow).
    const body = { ...req.body };
    if (SHARED_PROJECT_ID && body.variationDetails && !body.variationDetails.projectId) {
      body.variationDetails = { ...body.variationDetails, projectId: SHARED_PROJECT_ID };
    }
    console.log(
      `[/api/generate] -> POST /beta/generate-variation (projectId=${
        body.variationDetails?.projectId || "none"
      })`,
    );
    const r = await callExpressApi(token, "/beta/generate-variation", {
      method: "POST",
      body: JSON.stringify(body),
    });
    res.status(r.status).json(r.body);
  }));

  app.get("/api/status/:jobId", withToken(async (req, res, token) => {
    const id = encodeURIComponent(req.params.jobId);
    const r = await callExpressApi(token, `/status/${id}`);
    res.status(r.status).json(r.body);
  }));

  // ---------- Dev helpers ----------

  if (NODE_ENV === "development") {
    app.get("/debug/token", async (_req, res) => {
      try {
        const token = await getAccessToken();
        res.json({
          access_token: token,
          expires_at: new Date(cachedToken.expires_at).toISOString(),
          hint: "Use this in cURL/Python for testing. Tokens last ~24h. Treat it as a secret.",
        });
      } catch (err) {
        res.status(500).json({ error: "token_fetch_failed", detail: String(err) });
      }
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

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPES,
  }).toString();
  const resp = await fetch(IMS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("[ims] token error", resp.status, text);
    throw new Error(`IMS token request failed: ${resp.status} ${text}`);
  }
  const tokens = await resp.json();
  cachedToken = {
    access_token: tokens.access_token,
    // Refresh ~60s before actual expiry to avoid edge-of-window failures.
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
  };
  console.log("[ims] obtained S2S token, expires at",
    new Date(cachedToken.expires_at).toISOString());
  return cachedToken.access_token;
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

function withToken(handler) {
  return async (req, res) => {
    let token;
    try {
      token = await getAccessToken();
    } catch (err) {
      return res.status(502).json({
        error: "token_fetch_failed",
        detail: String(err),
      });
    }
    return handler(req, res, token);
  };
}
