# Express API – OAuth Server-to-Server Sample

A runnable, end-to-end implementation of the **self-service variation workflow** with **OAuth Server-to-Server** authentication: the organization curates a small catalog of tagged Express templates shared with the technical account, users browse that catalog inside the app with no per-user sign-in, the backend generates a variation server-side (landing it in a shared Storage project), and the variation is opened back in your page via the Adobe Express Embed SDK.

Companion to the guide **[Generate and Edit a Variant (Server-to-Server)](https://developer.adobe.com/firefly-services/docs/express-api/guides/how-to/e2e-generate-edit-variant-s2s)** — read the guide for the conceptual walk-through; use this repo to run it locally against a real Developer Console project.

For the per-user variant where each user signs in with their own Adobe ID, see the `[oauth-web-app/](../oauth-web-app)` sample.

## Stack

- **Vite** dev server with `vite-plugin-mkcert` (HTTPS on `localhost:4000`).
- **Express** middleware (`middleware.js`) caches a `client_credentials` access token in memory (refreshed ~60s before expiry) and proxies the Express API calls so the token and `client_secret` never reach the browser.
- Vanilla HTML/JS UI (`src/index.html`) for the template picker, tag form, job polling, and the Embed SDK hand-off.

## What works without admin rights, and what doesn't

Steps 1–5 of the workflow (token, list templates, inspect tags, generate, poll) work today for any developer who has the technical account email and shares one of their own tagged Express templates with it — leave `SHARED_PROJECT_ID` blank and variations land in the technical account's own `Express API Documents` folder, which is fine for validating the API plumbing.

Step 6 (the end user opening the variation in the Adobe Express Embed SDK) additionally requires:

- A **Storage project URN** (`SHARED_PROJECT_ID`) for a project shared with the technical account _and_ the end users. Project setup requires an Adobe org admin. See the guide's [Admin Console setup](https://developer.adobe.com/firefly-services/docs/express-api/guides/how-to/e2e-generate-edit-variant-s2s) section.
- A separate **OAuth Web App** (or **SPA**) credential in the same Developer Console project, whose `client_id` is used by the Embed SDK (`VITE_EMBED_SDK_CLIENT_ID`). The Embed SDK does **not** use the S2S credential.

## Prerequisites

- Node.js 18+.
- An Adobe Developer Console project with the **Adobe Express API** added and an **OAuth Server-to-Server** credential — copy the `client_id`, `client_secret`, and **technical account email** from the credential overview.
- At least one Express document tagged with the **Tag Elements add-on** and shared with the technical account email (**Share** → paste the email → **Can edit**).

## Run

```sh
cp .env.example .env
# Required:  CLIENT_ID, CLIENT_SECRET
# For step 6: SHARED_PROJECT_ID, VITE_EMBED_SDK_CLIENT_ID
# Optional:  SCOPES (defaults to openid,AdobeID,ee.express_api)
npm install
npm start
```

Open [https://localhost:4000](https://localhost:4000).

> On first start, `vite-plugin-mkcert` installs a local CA (one-time keychain prompt) so the dev cert is trusted by Chrome/Safari/Firefox.

## Proxy endpoints

| Method | Path                 | Forwards to                                                                     |
| ------ | -------------------- | ------------------------------------------------------------------------------- |
| GET    | `/api/templates`     | `GET /beta/tagged-documents`                                                    |
| GET    | `/api/templates/:id` | `GET /beta/tagged-documents/{id}`                                               |
| POST   | `/api/generate`      | `POST /beta/generate-variation` (`projectId` injected from `SHARED_PROJECT_ID`) |
| GET    | `/api/status/:jobId` | `GET /status/{jobId}`                                                           |
| GET    | `/debug/token`       | **Dev only.** Returns the current S2S access token.                             |

There are no per-user sessions — the token is org-scoped. Use `/debug/token` to grab a bearer token and try the API in cURL/Python:

```sh
curl -s 'https://express-api.adobe.io/beta/tagged-documents?limit=5' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-API-KEY: $CLIENT_ID"
```

Treat the token as a secret — anyone with it can call the API as your organization's technical account.
