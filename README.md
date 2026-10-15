# Integrations

Microsoft products stay hidden until `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_TENANT`, and `MICROSOFT_CONFIRMED_PRODUCTS` are set. The production callback is exactly `https://em.multiplierclub.in/api/integrations/microsoft/callback`. Confirmable Graph products are `outlook-mail,outlook-calendar,contacts,teams,onedrive,sharepoint,word,excel,powerpoint,onenote,todo,planner`. Teams (`Team.ReadBasic.All`) and SharePoint (`Sites.Read.All`) need admin consent. Teams meetings, Bookings, Forms, Power BI, Dynamics 365, Azure Resource Manager, Azure DevOps, and Power Platform stay hidden. Disconnecting one Microsoft product removes only that product. The stored grant is deleted only when no other product still uses it. Microsoft does not provide a simple refresh-token revoke for this flow, so the Entra permission remains in the Microsoft account.

Google products stay hidden until `GOOGLE_CONFIRMED_PRODUCTS` lists ids whose Cloud APIs an administrator has enabled. The confirmed ids are `gmail,calendar,drive,docs,sheets,slides,forms,tasks,people,meet,analytics,search-console,apps-script`. The OAuth client variables alone do not make a product visible. Chat, Admin SDK, and Workspace Events stay hidden because their prerequisites are not configured. Disconnecting one Google product removes it locally. The Google refresh token is revoked only when no other product still uses that grant.

# Zoho integrations

Zoho CRM, Books, Inventory, People, Desk, Projects, Calendar, and Sign can connect separately. Each product keeps its own tokens. The other Zoho products stay in the registry and are omitted from the catalog. Zoho Creator needs an app owner and link name before a connector can read records, and that step is not built. Demo cards, including Google Ads, are not shown.

Before multiple founders share one deployment, Effort Multiplier needs real accounts. Until then, tokens stay encrypted and bound to the browser session that created them. A later account system can set the nullable `user_id`. The browser cannot set it. New Zoho scopes also have to be enabled on the existing Zoho API Console client or Zoho will refuse consent.

There are no Effort Multiplier accounts yet. A signed browser session keeps one founder's tokens separate from another browser. That session is not production multi-tenant identity. The token store keeps a nullable `user_id` for a later authenticated account. The browser cannot set that id.

The Zoho flow is a server-side OAuth 2.0 authorization-code grant for a multi-user Zoho web application. Each founder authorizes their own Zoho organization. This build does not have Effort Multiplier accounts. A signed browser session keeps one founder's tokens separate from another browser on the same machine. That session is not production multi-tenant identity. The token store keeps a nullable `user_id` so a later authenticated Effort Multiplier user can own the connection. The browser cannot set that id.

## Configure Zoho

In the [Zoho API Console](https://api-console.zoho.com/), use a **Server-based** client, not a Self Client.

Register the callback that matches the environment exactly.

Local:

`http://localhost:5173/api/integrations/zoho/callback`

Production:

`https://em.multiplierclub.in/api/integrations/zoho/callback`

Zoho allows one redirect URI on a Server-based client. Use the localhost URI while testing locally, and switch the console entry to the production URI before using the live domain. Do not put the production URI in the local `.env` unless that exact URI is registered.

If the console has a different URI, change the console entry or `ZOHO_REDIRECT_URI` so they match. The server does not rewrite the callback URL. Local development refuses to start when `ZOHO_REDIRECT_URI` is anything else.

Enable Multi-DC on the client if founders sign in outside the data center where the client was created. The app accepts the `accounts-server` and `api_domain` Zoho returns only when they are official Zoho hosts, then calls that region. It does not assume the US data center.

Each available product requests only its own read scopes, with `access_type=offline`. Connecting CRM does not connect Books or any other product.

On Vercel, set `DATABASE_URL` to a Postgres database. The serverless filesystem is not used for tokens. Local development uses `data/zoho.sqlite` when `DATABASE_URL` is empty.

Check local configuration without printing secret values:

```bash
npm run check:env
```

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
2. Open **Zoho products**. Connect on a card marked **Signs in with Zoho**. Planned cards do not leave the app. The sign-in opens in a new tab.
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
