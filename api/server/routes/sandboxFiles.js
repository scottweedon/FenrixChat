/**
 * Read-only routes backing the sandbox file-tree side panel: list what an agent has
 * written into the current conversation/Project's Langflow sandbox, and mint a
 * browser-loadable preview URL for a specific file on click.
 *
 * Never trusts a client-supplied `projectId` - resolves it fresh from the conversation
 * record (`db.getConvo`) the same way `attachConversationCreatedAt` does for
 * `chatProjectId`, since a conversation's actual Project membership is what determines
 * which sandbox folder it shares.
 */
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { Constants } = require('librechat-data-provider');
const { getUserPluginAuthValue } = require('~/server/services/PluginService');
const {
  getSandboxTree,
  buildSandboxPreviewUrl,
} = require('~/server/services/sandboxFiles');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const db = require('~/models');

const PLUGIN_KEY = `${Constants.mcp_prefix}fenrix-workflows`;
const AUTH_FIELD = 'MCP_API_KEY';

const router = express.Router();
router.use(requireJwtAuth);

router.get('/tree', async (req, res) => {
  const { conversationId } = req.query;
  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }

  try {
    const convo = await db.getConvo(req.user.id, conversationId);
    if (!convo) {
      return res.status(404).end();
    }
    const result = await getSandboxTree(req.user.id, {
      conversationId,
      projectId: convo.chatProjectId ?? null,
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('[sandboxFiles] Error fetching sandbox tree', error);
    res.status(500).json({ error: 'Error fetching sandbox tree' });
  }
});

router.get('/preview-url', async (req, res) => {
  const { conversationId, path } = req.query;
  if (!conversationId || !path) {
    return res.status(400).json({ error: 'conversationId and path are required' });
  }

  try {
    const convo = await db.getConvo(req.user.id, conversationId);
    if (!convo) {
      return res.status(404).end();
    }
    const apiKey = await getUserPluginAuthValue(req.user.id, AUTH_FIELD, false, PLUGIN_KEY);
    if (!apiKey) {
      return res.status(404).json({ error: 'No sandbox credential provisioned yet' });
    }
    const url = buildSandboxPreviewUrl(
      { conversationId, projectId: convo.chatProjectId ?? null },
      path,
      apiKey,
    );
    if (!url) {
      return res.status(503).json({ error: 'Sandbox preview is not configured' });
    }
    res.status(200).json({ url });
  } catch (error) {
    logger.error('[sandboxFiles] Error building sandbox preview URL', error);
    res.status(500).json({ error: 'Error building sandbox preview URL' });
  }
});

module.exports = router;
