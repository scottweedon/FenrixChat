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

_None yet — fork is currently unmodified `v0.8.8-rc1`._

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
