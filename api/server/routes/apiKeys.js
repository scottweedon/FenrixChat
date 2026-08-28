const express = require('express');
const { generateCheckAccess, createApiKeyHandlers, createOidcOrFallbackAuth } = require('@librechat/api');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  getAgentApiKeyById,
  createAgentApiKey,
  deleteAgentApiKey,
  listAgentApiKeys,
  findUser,
  findRolesByNames,
  updateUser,
  getRoleByName,
} = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const handlers = createApiKeyHandlers({
  createAgentApiKey,
  listAgentApiKeys,
  deleteAgentApiKey,
  getAgentApiKeyById,
});

const checkRemoteAgentsUse = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName,
});

// Accepts a Keycloak/OIDC bearer token (the same identity Langflow already holds for
// this user via SSO - see remoteAgentAuth.ts) as an alternative to LibreChat's own
// native session, so Langflow can mint an Agent API key for the real logged-in user
// without needing a LibreChat-native token it has no way to obtain. Falls through to
// requireJwtAuth unchanged for every existing (native session/cookie) caller, e.g.
// LibreChat's own "API Keys" settings UI.
const requireJwtOrOidcAuth = createOidcOrFallbackAuth(
  { findUser, getRolesByNames: findRolesByNames, updateUser, getAppConfig },
  requireJwtAuth,
);

router.post('/', requireJwtOrOidcAuth, checkRemoteAgentsUse, handlers.createApiKey);

router.get('/', requireJwtOrOidcAuth, checkRemoteAgentsUse, handlers.listApiKeys);

router.get('/:id', requireJwtOrOidcAuth, checkRemoteAgentsUse, handlers.getApiKey);

router.delete('/:id', requireJwtOrOidcAuth, checkRemoteAgentsUse, handlers.deleteApiKey);

module.exports = router;
