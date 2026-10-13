# Zoho CRM local setup

Zoho CRM is the only live integration. Every other card still uses the existing demo connection, which is stored only as a boolean in this browser.

The Zoho flow is a server-side OAuth 2.0 authorization-code grant for a multi-user Zoho web application. Each founder authorizes their own Zoho organization. This build does not have Effort Multiplier accounts. A signed browser session keeps one founder's tokens separate from another browser on the same machine. That session is not production multi-tenant identity. The token store keeps a nullable `user_id` so a later authenticated Effort Multiplier user can own the connection. The browser cannot set that id.

## Configure Zoho

In the [Zoho API Console](https://api-console.zoho.com/), use a **Server-based** client, not a Self Client.

Register this redirect URI exactly:

`http://localhost:5173/api/integrations/zoho/callback`

If the console has a different URI, change the console entry or `ZOHO_REDIRECT_URI` so they match. The server does not rewrite the callback URL. Local development refuses to start when `ZOHO_REDIRECT_URI` is anything else.

Enable Multi-DC on the client if founders sign in outside the data center where the client was created. The app accepts the `accounts-server` and `api_domain` Zoho returns only when they are official Zoho hosts, then calls that region. It does not assume the US data center.

The requested scope is `ZohoCRM.modules.leads.READ` with `access_type=offline`.

## Local environment

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the two generated values in `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`. Put the Zoho client id and client secret in the matching variables. Do not commit `.env`. The token database is created at `data/zoho.sqlite` with owner-only permissions and is gitignored.

```bash
npm run dev
```

The app is served at `http://localhost:5173`. Vite proxies `/api` to the Node API on `127.0.0.1:3001`. If Zoho credentials or keys are missing or malformed, the API exits. Zoho does not fall back to the demo connection.

## What to click

1. Open `http://localhost:5173`.
2. Connect on **Zoho CRM**. The browser should leave the app for Zoho's login and consent screen.
3. After consent, the card shows **Connected** only when `/api/integrations/zoho/status` reports a stored connection.
4. **Preview data** loads up to five leads from `{api_domain}/crm/v8/Leads`. An empty list means Zoho returned no leads.
5. Disconnect deletes the stored tokens and asks Zoho to revoke the refresh token.
6. Connect on any other card still opens the demo modal. That simulated state is not a Zoho connection.

A denial, mismatched `state`, or token error returns to the app with an error and does not mark Zoho connected.

## Checks

```bash
npm test
npm run typecheck
npm run build
```

Live sign-in still requires the real client id and secret in `.env`. Automated tests use a fake Zoho token endpoint. They do not prove that a real Zoho organization accepted this client.
