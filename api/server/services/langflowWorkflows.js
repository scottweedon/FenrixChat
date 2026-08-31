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
const { randomUUID } = require('node:crypto');
const { logger } = require('@librechat/data-schemas');
const { Constants } = require('librechat-data-provider');
const { generateToken } = require('~/models');
const { getUserPluginAuthValue, updateUserPluginAuth } = require('~/server/services/PluginService');
const buildDocumentFlow = require('./defaultLangflowFlows/BuildDocument.json');
const showDocumentFlow = require('./defaultLangflowFlows/ShowDocument.json');

const SERVER_NAME = 'fenrix-workflows';
const PLUGIN_KEY = `${Constants.mcp_prefix}${SERVER_NAME}`;
const AUTH_FIELD = 'MCP_API_KEY';
const LANGFLOW_API_KEY_NAME = 'Fenrix Chat access';
// Every real user's own copy of Fenrix's built-in Build Document / Show Document flows -
// seeded once per user (see ensureDefaultFlows below), never re-synced afterward so a
// user's own edits (e.g. a hand-tuned system prompt) survive future logins untouched.
const DEFAULT_FLOWS = [buildDocumentFlow, showDocumentFlow];
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
  return langflowApiKey;
}

/**
 * Seeds this user's own copy of each bundled default flow (Build Document, Show
 * Document, ...) into their Langflow account, authenticated with their own personal API
 * key - so Langflow's per-user MCP tool listing (`Flow.user_id == current_user.id`)
 * actually surfaces them. Idempotent by design, not just in effect: checks for an
 * existing flow by `action_name` first and only creates one if missing - a returning
 * user's own edits (title, instructions, anything) are never touched by a later login.
 *
 * Each user's copy gets a freshly-generated id, never the template's own id - confirmed
 * live that Flow ids are unique across the WHOLE Langflow instance, not per user, so
 * reusing the same id for every user's copy only ever works for the first user to claim
 * it (every other user's create/upsert 404s, since that id already belongs to someone
 * else). `action_name` has no such collision: it's what Langflow's per-user MCP tool
 * listing keys tool names on, and is exactly as unique as it needs to be - one match per
 * calling user.
 *
 * Deliberately NOT a per-tenant provisioning step: at tenant-creation time no real user
 * exists yet, and creating these under the Langflow superuser would leave them invisible
 * to every real user's own per-user-scoped MCP tool list.
 */
async function ensureDefaultFlows(langflowInternalUrl, apiKey) {
  let existingActionNames;
  try {
    // header_flows=true: a cheap listing (no flow `data`) - enough to check action_name.
    const listResponse = await fetch(`${langflowInternalUrl}/api/v1/flows/?header_flows=true`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!listResponse.ok) {
      throw new Error(`Failed to list existing flows: ${listResponse.status} ${await listResponse.text()}`);
    }
    const existingFlows = await listResponse.json();
    existingActionNames = new Set(existingFlows.map((f) => f.action_name).filter(Boolean));
  } catch (err) {
    logger.debug('[langflowWorkflows] Could not list existing flows, skipping default-flow seeding', err);
    return;
  }

  for (const flow of DEFAULT_FLOWS) {
    if (existingActionNames.has(flow.action_name)) {
      continue; // Already provisioned for this user - never overwrite.
    }
    try {
      const newId = randomUUID();
      const createResponse = await fetch(`${langflowInternalUrl}/api/v1/flows/${newId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ ...flow, id: newId }),
      });
      if (!createResponse.ok) {
        throw new Error(`Flow creation failed: ${createResponse.status} ${await createResponse.text()}`);
      }
    } catch (err) {
      logger.debug(`[langflowWorkflows] Could not create default flow "${flow.name}"`, err);
    }
  }
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

    let apiKey = await getUserPluginAuthValue(userId, AUTH_FIELD, false, PLUGIN_KEY);
    if (!apiKey) {
      apiKey = await mintAndStoreKey(langflowInternalUrl, externalToken, userId);
    }
    await ensureDefaultFlows(langflowInternalUrl, apiKey);

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
      apiKey = await mintAndStoreKey(langflowInternalUrl, externalToken, userId);
      await ensureDefaultFlows(langflowInternalUrl, apiKey);
      await reinitializeMcpServer(selfBaseUrl, librechatToken, SERVER_NAME);
    }
  } catch (err) {
    logger.debug('[langflowWorkflows] Could not provision Fenrix Workflows MCP server', err);
  }
}

module.exports = { ensureLangflowWorkflowsMcpServer };
