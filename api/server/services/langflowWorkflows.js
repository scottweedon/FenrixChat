/**
 * Mints this user's own durable Langflow API key on login and stores it as their own
 * `MCP_API_KEY` value for the admin-defined "Fenrix Workflows" MCP server (declared in
 * librechat.yaml, not created by this hook), then connects it - so their own published
 * Langflow flows show up as their own tools with zero manual setup.
 *
 * The server itself is intentionally NOT created here. It used to be (via a per-user
 * POST /api/mcp/servers call), but a self-service, user-owned MCP server always renders
 * with the full editable-connection UI and the "I trust this application"/custom-connector
 * warning - correct for a server a user actually configured themselves, wrong for one that
 * is fully managed by the platform. An admin-defined server (see librechat.yaml's
 * mcpServers.fenrix-workflows) has no edit UI at all, so neither concern applies - the only
 * thing that still needs to be per-user is the credential, which is exactly what
 * `customUserVars` exists for: one shared server definition, one MCP_API_KEY value per user.
 *
 * Mirrors Langflow's own per-login bootstrap hook
 * (services/auth/service.py's _ensure_librechat_agent_api_key in the FenrixFlow repo),
 * reversed: there, Langflow mints a LibreChat Agent API key using the user's external SSO
 * token and stores it as a Langflow global variable; here, LibreChat mints a Langflow API
 * key using that same external token and stores it as this user's own MCP credential, so
 * their `mcp_enabled` flows show up as their own tools (Langflow's MCP tool listing is
 * already scoped to `Flow.user_id == current_user.id`).
 *
 * `POST /api/v1/api_key/` on Langflow needs no code changes on that side - verified live
 * that it already accepts the raw external token directly (its `CurrentActiveUser`
 * dependency chain extracts and forwards it, same as Langflow's own SSO cookie path).
 * Langflow's MCP transport itself does NOT accept that external token though - only a real
 * Langflow-native API key - which is exactly why this mint step exists rather than storing
 * the raw token as the MCP credential directly.
 */
const { logger } = require('@librechat/data-schemas');
const { Constants } = require('librechat-data-provider');
const { generateToken } = require('~/models');
const { getUserPluginAuthValue, updateUserPluginAuth } = require('~/server/services/PluginService');

const SERVER_NAME = 'fenrix-workflows';
const PLUGIN_KEY = `${Constants.mcp_prefix}${SERVER_NAME}`;
const AUTH_FIELD = 'MCP_API_KEY';
const LANGFLOW_API_KEY_NAME = 'Fenrix Chat access';
// Leftover per-user servers from before this became an admin-defined server (self-service
// registrations via POST /api/mcp/servers - see git history of this file). Cleaned up once,
// opportunistically, on login so migrating users don't end up with both the old duplicate(s)
// and the new admin-defined entry side by side.
const LEGACY_SERVER_NAME_PREFIX = 'fenrix-workflows';

async function mintLangflowApiKey(langflowInternalUrl, externalToken) {
  const response = await fetch(`${langflowInternalUrl}/api/v1/api_key/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${externalToken}`,
    },
    body: JSON.stringify({ name: LANGFLOW_API_KEY_NAME }),
  });
  if (!response.ok) {
    throw new Error(`Langflow API key creation failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();
  if (!body.api_key) {
    throw new Error('Langflow API key response did not include api_key');
  }
  return body.api_key;
}

async function reinitializeMcpServer(selfBaseUrl, librechatToken, serverName) {
  const response = await fetch(`${selfBaseUrl}/api/mcp/${encodeURIComponent(serverName)}/reinitialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${librechatToken}` },
  });
  if (!response.ok) {
    throw new Error(`MCP server reinitialize failed: ${response.status} ${await response.text()}`);
  }
  // A connection failure (e.g. a stale credential) still comes back as HTTP 200 with
  // `success: false` - the route only 4xx/5xxs on things like an unknown server name or an
  // unhandled exception. Treat `success: false` as a failure too, or a stale-key retry can
  // never detect that the retry itself needs to happen.
  const body = await response.json();
  if (!body.success) {
    throw new Error(`MCP server reinitialize did not succeed: ${body.failureReason || body.message || 'unknown reason'}`);
  }
}

/**
 * Deletes any leftover self-service "fenrix-workflows*" DB servers this user created before
 * the switch to an admin-defined server. Never throws - a failure here just leaves a stray
 * duplicate visible, which isn't worth blocking the real (admin-server) provisioning over.
 */
async function cleanupLegacySelfServiceServers(selfBaseUrl, librechatToken) {
  try {
    const response = await fetch(`${selfBaseUrl}/api/mcp/servers`, {
      headers: { Authorization: `Bearer ${librechatToken}` },
    });
    if (!response.ok) {
      return;
    }
    const servers = await response.json();
    const legacyNames = Object.keys(servers).filter(
      (name) => name.toLowerCase().startsWith(LEGACY_SERVER_NAME_PREFIX) && name !== SERVER_NAME,
    );
    for (const name of legacyNames) {
      try {
        const deleteResponse = await fetch(
          `${selfBaseUrl}/api/mcp/servers/${encodeURIComponent(name)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${librechatToken}` },
          },
        );
        if (!deleteResponse.ok) {
          logger.debug(
            `[langflowWorkflows] Could not delete legacy MCP server "${name}": ${deleteResponse.status} ${await deleteResponse.text()}`,
          );
        }
      } catch (err) {
        logger.debug(`[langflowWorkflows] Could not delete legacy MCP server "${name}"`, err);
      }
    }
  } catch (err) {
    logger.debug('[langflowWorkflows] Could not list MCP servers for legacy cleanup', err);
  }
}

async function mintAndStoreKey(langflowInternalUrl, externalToken, userId) {
  const langflowApiKey = await mintLangflowApiKey(langflowInternalUrl, externalToken);
  await updateUserPluginAuth(userId, AUTH_FIELD, PLUGIN_KEY, langflowApiKey);
}

/**
 * Best-effort, idempotent, never throws - the caller (the OAuth callback) must not let a
 * slow or unavailable Langflow container delay a user's login, so this is invoked
 * fire-and-forget rather than awaited before the post-login redirect.
 *
 * @param {import('@librechat/data-schemas').IUser} user
 * @param {string | undefined} externalToken - the same id_token (preferred) or
 *   access_token value already carried in the fenrix_sso_token cookie
 *   (setOpenIDAuthTokens's return value) - not re-derived here to avoid drifting from that
 *   logic's id_token/access_token fallback order.
 */
async function ensureLangflowWorkflowsMcpServer(user, externalToken) {
  try {
    const langflowInternalUrl = process.env.LANGFLOW_INTERNAL_URL;
    if (!langflowInternalUrl || !externalToken) {
      return;
    }
    const userId = user._id.toString();

    // Not DOMAIN_SERVER - that's the public, Caddy-fronted, tenant-prefixed URL meant for
    // browsers. From inside this same container "localhost" is this container's own
    // loopback, not Caddy, so a self-call needs the app's own internal listening port
    // directly instead (same container-to-container principle as LANGFLOW_INTERNAL_URL).
    const selfBaseUrl = `http://localhost:${process.env.PORT || 3080}`;
    const librechatToken = await generateToken(user);

    await cleanupLegacySelfServiceServers(selfBaseUrl, librechatToken);

    const hasKey = await getUserPluginAuthValue(userId, AUTH_FIELD, false, PLUGIN_KEY);
    if (!hasKey) {
      await mintAndStoreKey(langflowInternalUrl, externalToken, userId);
    }

    try {
      await reinitializeMcpServer(selfBaseUrl, librechatToken, SERVER_NAME);
    } catch (err) {
      // A stored key can go stale independently of LibreChat (e.g. Langflow's own store
      // was reset/rebuilt) - "a value exists" isn't proof it still works. Self-heal by
      // minting a fresh key once and retrying, rather than leaving a dead connection until
      // someone manually clears the stored credential.
      logger.debug(
        '[langflowWorkflows] Reinitialize failed, re-minting Langflow API key and retrying once',
        err,
      );
      await mintAndStoreKey(langflowInternalUrl, externalToken, userId);
      await reinitializeMcpServer(selfBaseUrl, librechatToken, SERVER_NAME);
    }
  } catch (err) {
    logger.debug('[langflowWorkflows] Could not provision Fenrix Workflows MCP server', err);
  }
}

module.exports = { ensureLangflowWorkflowsMcpServer };
