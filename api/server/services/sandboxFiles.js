/**
 * Moves a user's sandbox files between conversation/Project scopes on their own Langflow
 * instance, mirroring the shape agreed for the shared-Project-sandbox feature: every
 * conversation in a Project shares one `projects/<id>/` folder; a standalone chat gets its
 * own `conversations/<id>/`. Called from the Projects assign-conversation handler after its
 * own DB update succeeds, so the on-disk layout stays in sync with `chatProjectId`.
 *
 * Reuses the same per-user Langflow API key `langflowWorkflows.js` already mints and stores
 * (MCP_API_KEY under the fenrix-workflows plugin key) - no new credential to manage. Never
 * throws: a failed move leaves files where they were (an operator-visible log line, not a
 * user-facing error) rather than blocking the Project reassignment itself, since the DB
 * update - the source of truth for which Project a chat belongs to - already succeeded.
 */
const { logger } = require('@librechat/data-schemas');
const { Constants } = require('librechat-data-provider');
const { getUserPluginAuthValue } = require('~/server/services/PluginService');

const SERVER_NAME = 'fenrix-workflows';
const PLUGIN_KEY = `${Constants.mcp_prefix}${SERVER_NAME}`;
const AUTH_FIELD = 'MCP_API_KEY';

function sandboxSubpathFor({ conversationId, projectId }) {
  return projectId ? `projects/${projectId}` : `conversations/${conversationId}`;
}

/**
 * @param {string} userId
 * @param {{ conversationId: string, previousProjectId: string | null, projectId: string | null }} scope
 */
/**
 * Fetches the flat file listing for a conversation/Project sandbox, for the file-tree
 * side panel. Never throws - degrades to an empty list (same "quiet degrade" style as
 * `moveSandboxFiles`) so a Langflow hiccup or a not-yet-provisioned API key just shows an
 * empty panel rather than an error toast.
 *
 * @param {string} userId
 * @param {{ conversationId: string, projectId: string | null }} scope
 * @returns {Promise<{ files: Array<{ path: string, size: number }>, truncated?: boolean }>}
 */
async function getSandboxTree(userId, { conversationId, projectId }) {
  const subpath = sandboxSubpathFor({ conversationId, projectId });
  try {
    const langflowInternalUrl = process.env.LANGFLOW_INTERNAL_URL;
    if (!langflowInternalUrl) {
      return { files: [] };
    }
    const apiKey = await getUserPluginAuthValue(userId, AUTH_FIELD, false, PLUGIN_KEY);
    if (!apiKey) {
      return { files: [] };
    }
    const response = await fetch(
      `${langflowInternalUrl}/api/v1/agentic/sandbox-files/tree?sandbox=${encodeURIComponent(subpath)}`,
      { headers: { 'x-api-key': apiKey } },
    );
    if (!response.ok) {
      throw new Error(`Langflow sandbox tree fetch failed: ${response.status} ${await response.text()}`);
    }
    return await response.json();
  } catch (err) {
    logger.warn(`[sandboxFiles] Could not fetch sandbox tree for user ${userId} at ${subpath}`, err);
    return { files: [] };
  }
}

/**
 * Builds the same kind of browser-loadable sandbox-file preview URL
 * `FenrixArtifactFileComponent` mints for `show_document`, but for a user-initiated click
 * in the file-tree panel rather than an agent tool call. Pure/no fetch - the caller
 * already has the API key (from `getUserPluginAuthValue`) and `LANGFLOW_PUBLIC_BASE_URL`
 * is just an env var, so there's no need to round-trip through Langflow to mint this.
 *
 * @param {{ conversationId: string, projectId: string | null }} scope
 * @param {string} filePath
 * @param {string} apiKey
 * @returns {string | null} null if `LANGFLOW_PUBLIC_BASE_URL` isn't configured
 */
function buildSandboxPreviewUrl({ conversationId, projectId }, filePath, apiKey) {
  const publicBaseUrl = (process.env.LANGFLOW_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!publicBaseUrl) {
    return null;
  }
  const subpath = sandboxSubpathFor({ conversationId, projectId });
  // base64url with no padding (Node's native encoding) - files_router.py's
  // _decode_sandbox_subpath pads it back out before decoding, so this is compatible with
  // the padded base64 FenrixArtifactFileComponent's Python encoder produces too.
  const encodedSandbox = Buffer.from(subpath, 'utf8').toString('base64url');
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${publicBaseUrl}/api/v1/agentic/sandbox-files/${encodeURIComponent(apiKey)}/${encodedSandbox}/${encodedPath}`;
}

async function moveSandboxFiles(userId, { conversationId, previousProjectId, projectId }) {
  const fromSubpath = sandboxSubpathFor({ conversationId, projectId: previousProjectId });
  const toSubpath = sandboxSubpathFor({ conversationId, projectId });
  if (fromSubpath === toSubpath) {
    return;
  }

  try {
    const langflowInternalUrl = process.env.LANGFLOW_INTERNAL_URL;
    if (!langflowInternalUrl) {
      return;
    }
    const apiKey = await getUserPluginAuthValue(userId, AUTH_FIELD, false, PLUGIN_KEY);
    if (!apiKey) {
      logger.debug(
        `[sandboxFiles] No Langflow API key for user ${userId} yet - sandbox move from ${fromSubpath} to ${toSubpath} skipped (will reflect next time either scope is written to).`,
      );
      return;
    }

    const response = await fetch(`${langflowInternalUrl}/api/v1/agentic/sandbox/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ from_subpath: fromSubpath, to_subpath: toSubpath }),
    });
    if (!response.ok) {
      throw new Error(`Langflow sandbox move failed: ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    logger.warn(
      `[sandboxFiles] Could not move sandbox files for user ${userId} from ${fromSubpath} to ${toSubpath}`,
      err,
    );
  }
}

module.exports = { moveSandboxFiles, sandboxSubpathFor, getSandboxTree, buildSandboxPreviewUrl };
