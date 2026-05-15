# Express API – OAuth Web App Sample

A runnable, end-to-end implementation of the **self-service variation workflow** with **OAuth Web App** authentication: each end user signs in with their own Adobe ID, picks one of their tagged Express templates, fills in tag values, and the generated variation is opened back in your page via the Adobe Express Embed SDK.

![OAuth Web App sample](../assets/images/oauth-web-app-hero.png)

Companion to the guide **[Generate and Edit a Variant (OAuth Web App)](https://developer.adobe.com/firefly-services/docs/express-api/guides/how-to/e2e-generate-edit-variant-oauth-web-app)** — read the guide for the conceptual walk-through; use this repo to run it locally against a real Developer Console project.

For the company-curated-catalog variant, see the `[oauth-server-to-server/](../oauth-server-to-server)` sample.

## Stack

- **Vite** dev server with `vite-plugin-mkcert` (HTTPS on `localhost:4000`).
- **Express** middleware (`middleware.js`) handling the OAuth `/login` + `/callback` exchange and proxying the Express API calls so the access token and `client_secret` never reach the browser.
- Vanilla HTML/JS UI (`src/index.html`) for sign-in, template picker, tag form, job polling, and the Embed SDK hand-off.

## Prerequisites

- Node.js 18+.
- An Adobe Developer Console project with the **Adobe Express API** added and an **OAuth Web App** credential:
  - Scopes: `openid`, `AdobeID`, `ee.express_api`.
  - **Default Redirect URI**: `https://localhost:4000/callback`.
  - **Redirect URI pattern**: `https://localhost:4000/callback$`.
- At least one Express document in your account tagged with the **Tag Elements add-on**.

## Run

```sh
cp .env.example .env
# Fill in CLIENT_ID, CLIENT_SECRET, SESSION_SECRET, VITE_EMBED_SDK_CLIENT_ID
npm install
npm start
```

Open [https://localhost:4000](https://localhost:4000) and click **Sign in with Adobe**.

> On first start, `vite-plugin-mkcert` installs a local CA (one-time keychain prompt) so the dev cert is trusted by Chrome/Safari/Firefox.

## Proxy endpoints

| Method | Path                 | Forwards to                                     |
| ------ | -------------------- | ----------------------------------------------- |
| GET    | `/login`             | Adobe IMS `/authorize/v2`                       |
| GET    | `/callback`          | Adobe IMS `/token/v3` (code → token exchange)   |
| POST   | `/logout`            | —                                               |
| GET    | `/api/me`            | —                                               |
| GET    | `/api/templates`     | `GET /beta/tagged-documents`                    |
| GET    | `/api/templates/:id` | `GET /beta/tagged-documents/{id}`               |
| POST   | `/api/generate`      | `POST /beta/generate-variation`                 |
| GET    | `/api/status/:jobId` | `GET /status/{jobId}`                           |
| GET    | `/debug/token`       | **Dev only.** Returns the current access token. |

Use `/debug/token` to grab a bearer token after signing in once, then try the API in cURL/Python:

```sh
curl -s 'https://express-api.adobe.io/beta/tagged-documents?limit=5' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-API-KEY: $CLIENT_ID"
```
