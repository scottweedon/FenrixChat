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
