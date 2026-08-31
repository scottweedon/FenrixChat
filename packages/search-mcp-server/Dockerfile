# Build context is the repo root (needs the workspace's package.json/package-lock.json and
# sibling packages/* to resolve @librechat/api - same npm-workspace requirement the root
# Dockerfile has, just without the client/data-provider/data-schemas frontend build steps
# this service doesn't need).
FROM node:24.16.0-alpine AS node

RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/data-provider/package.json ./packages/data-provider/package.json
COPY --chown=node:node packages/data-schemas/package.json ./packages/data-schemas/package.json
COPY --chown=node:node packages/api/package.json ./packages/api/package.json
COPY --chown=node:node packages/search-mcp-server/package.json ./packages/search-mcp-server/package.json

RUN npm ci --no-audit --workspace=packages/data-provider --workspace=packages/data-schemas \
    --workspace=packages/api --workspace=packages/search-mcp-server --include-workspace-root

COPY --chown=node:node packages/data-provider ./packages/data-provider
COPY --chown=node:node packages/data-schemas ./packages/data-schemas
COPY --chown=node:node packages/api ./packages/api
COPY --chown=node:node packages/search-mcp-server ./packages/search-mcp-server

# @librechat/api imports from @librechat/data-schemas and librechat-data-provider at
# runtime (packages/api/src/web/web.ts) - both need their own dist build first, same
# dependency order as the root "build:packages" script.
RUN npm run build:data-provider && npm run build:data-schemas && npm run build:api

WORKDIR /app/packages/search-mcp-server
EXPOSE 3500
ENV PORT=3500
CMD ["node", "index.js"]
