# Fork Changes

Tracks every place Fenrix has touched LibreChat core (not just added new files
alongside it). Per `design-spec.md` §2, new features should live in new
files/directories (`client/src/fenrix/`, `api/fenrix/`) and only touch existing
files at single-line "seam" points. This file exists for the exceptions: places
where core logic itself had to change.

Each entry should include: the file(s) touched, why a seam/extension point
wasn't sufficient, and the narrow interface (if any) used to contain the
change so upstream merges stay localized.

## Pinned base

- Base: `danny-avila/LibreChat`
- Pinned tag: `v0.8.8-rc1`
- `main` and `upstream-sync` both start from this tag.

## Core changes

### Auth cookies scoped to the deployment's base path

- **Files:** `packages/api/src/utils/path.ts` (new `getAuthCookiePath()`, next to the
  existing `getBasePath()`), `api/server/services/AuthService.js` (all `res.cookie(...)`
  calls: `refreshToken`, `token_provider`, `openid_access_token`, `openid_id_token`,
  `openid_user_id`), `api/server/controllers/auth/LogoutController.js` and
  `api/cache/banViolation.js` (matching `res.clearCookie(...)` calls).
- **Why not a seam:** every auth cookie previously omitted the `path` option, which
  defaults browsers to `Path=/`. Under design-spec.md §8/§9's per-tenant-container model,
  every tenant's LibreChat instance sits behind one shared domain (Caddy, §9.1), each at
  its own `DOMAIN_CLIENT` subpath (e.g. `/root/<tenant_id>/app/`) — with `Path=/`, a
  tenant's session cookie is sent by the browser to every other tenant's subpath on the
  same domain. This is core auth code, not something addable via a new file.
- **Interface:** `getAuthCookiePath(): string` — returns `${getBasePath()}/` (e.g.
  `/root/acme/app/` or `/` when unset). Every `res.cookie` that sets an auth cookie, and
  every matching `res.clearCookie` on logout/ban, must use it as `path`, or the cookie
  won't be cleared (clearCookie requires the same path to match).
- **Verified:** locally, against a manually-run instance behind Caddy stripping a `/chat/`
  prefix (per `config/test-subdirectory-setup.sh`'s pattern, adapted to Caddy since that's
  the production reverse proxy per §9.1) — confirmed via curl that login sets
  `Set-Cookie: refreshToken=...; Path=/chat/` and logout clears it with the same path.
- **Expected upstream conflicts:** any upstream change to the cookie-setting blocks in
  `AuthService.js` (session/refresh-token issuance, OpenID token handling) or to
  `getBasePath()` itself in `packages/api/src/utils/path.ts`.
- **Test changes:** `AuthService.spec.js`, `LogoutController.spec.js`, and
  `banViolation.spec.js` mocks/assertions updated to expect the new `path` option —
  behavior change, not a regression.

### SSO token cookie for sibling apps (Langflow)

- **Files:** `packages/api/src/utils/path.ts` (new `getSsoTokenCookiePath()`),
  `api/server/services/AuthService.js` (`setOpenIDAuthTokens`, one new `res.cookie` call),
  `api/server/controllers/auth/LogoutController.js` and `api/cache/banViolation.js`
  (matching `res.clearCookie` calls).
- **Why not a seam:** design-spec.md §5/§9.2 embeds Langflow inside LibreChat's `/app` via
  `<iframe src="/root/<tenant_id>/workflows">`, authenticated "via the shared Keycloak SSO
  session (no second login)". Langflow's own external-auth support (see FenrixFlow's
  `services/auth/external.py`) validates a JWT it receives via a configured header or
  cookie against Keycloak's JWKS itself — it doesn't participate in LibreChat's OIDC
  handshake. The only token LibreChat holds that Langflow's JWKS validation can verify is
  the raw Keycloak-issued `id_token` from its own `tokenset` (`sub`/`aud`/`iss` claims
  intact) — LibreChat's own `token`/`refreshToken` cookies are separately-signed app
  session tokens, not IdP JWTs, so they can't be reused for this. Setting this cookie is
  therefore core auth code (the same seam `setOpenIDAuthTokens` already owns for every
  other OpenID cookie), not something addable via a new file.
- **Interface:** `getSsoTokenCookiePath(): string` — one path segment above
  `getAuthCookiePath()` (e.g. `/root/acme/` for an app at `/root/acme/app`), so the cookie
  is visible to `/root/<tenant_id>/workflows` without also being sent to unrelated tenants.
  `setOpenIDAuthTokens` sets it as `fenrix_sso_token` = the same `appAuthToken` (id_token,
  preferring it over access_token exactly as the existing internal auth-token selection
  already does) on both initial login and token refresh, since both funnel through this one
  function. Cleared alongside the other OpenID cookies on logout and on ban.
- **Expected upstream conflicts:** any upstream change to `setOpenIDAuthTokens`'s token
  selection (`appAuthToken`) or to `getBasePath()`.
- **Test changes:** `AuthService.spec.js`, `LogoutController.spec.js` mocks/assertions
  updated for the new cookie; new `getSsoTokenCookiePath` unit tests in `path.spec.ts`.
  `banViolation.spec.js` uses the real `@librechat/api` build (not mocked), so this
  required rebuilding `packages/api` (`npm run build`) before its tests would pass.
- **Verified:** end-to-end against a real docker-compose-rendered tenant stack (FenrixCloud's
  provisioner) - obtained a genuine Keycloak `id_token` via the token endpoint, sent it as
  `fenrix_sso_token` through the real Caddy front door at `/root/<tenant>/workflows/`, and
  confirmed Langflow validates it and JIT-provisions the user. See FenrixCloud's own
  `f1d272d` commit for the other half of this (Langflow's `LANGFLOW_EXTERNAL_AUTH_*` wiring).

### Workflows nav item and iframe

- **Files:** `client/src/components/Workflows/WorkflowsView.tsx` (new), `client/src/utils/fenrixWorkflows.ts`
  (new, `getWorkflowsUrl()`), `client/src/routes/index.tsx` (one new lazy route), `client/src/hooks/Nav/useSideNavLinks.ts`
  (one new persistent nav link, `useNavigate` import), `client/src/locales/en/translation.json`
  (`com_ui_workflows`).
- **Why not fully new-file:** the nav rail's link list (`useSideNavLinks`) is the single
  source every icon in the left rail renders from (`ExpandedPanel.tsx`'s `NavIconButton`) -
  there's no separate registration point outside that hook to add a persistent icon without
  editing it, matching the existing `hide-panel` link's `onClick`-only (no `Component`)
  pattern for a link that navigates away rather than opening an in-context panel.
- **Interface:** `getWorkflowsUrl()` mirrors `getSsoTokenCookiePath()` on the server - reads
  the same `<base href>` the router already uses for its own `basename`
  (`routes/index.tsx`), drops its last path segment, appends `/workflows/`. `WorkflowsView`
  is a bare full-panel `<iframe>` at that URL (mobile sidebar toggle only, no other chrome -
  design-spec.md §5 calls for Langflow branding to read as part of this app). The nav link
  is unconditional (no permission gating yet - see Expected upstream conflicts).
- **Expected upstream conflicts:** any upstream change to `useSideNavLinks`'s link-building
  logic or to `routes/index.tsx`'s children array. Follow-up, not yet done: gating the nav
  item behind a tenant policy/permission so deployments without Langflow don't show it.
- **Verified:** typechecks, lints, and builds clean (`npm run build` in `client/`). Live
  verification (click through in a browser against a real tenant) is the next step.

<!--
## Example entry format

### `api/server/middleware/resolveTenantConnection.js`
- **Why not a seam:** LibreChat's Mongo/Postgres connection is established once
  at boot; per-tenant DB routing has to intercept every request, not just add
  a new route.
- **Interface:** `resolveTenantConnection(req) -> { mongoUri, pgConnectionString }`,
  called from `api/server/index.js` at a single seam point.
- **Expected upstream conflicts:** any upstream change to connection
  bootstrapping in `api/server/index.js` or the Mongo/Postgres client setup.
-->
