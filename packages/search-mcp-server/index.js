const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { webSearch } = require('./lib/webSearch');
const { readPage } = require('./lib/readPage');

const PORT = process.env.PORT || 3500;

function createServer() {
  const server = new McpServer({ name: 'fenrix-search', version: '0.1.0' });

  server.registerTool(
    'web_search',
    {
      title: 'Web Search',
      description:
        'Search the web using a self-hosted SearXNG instance. Returns titles, URLs, and snippets for the top results.',
      inputSchema: {
        query: z.string().describe('The search query'),
      },
    },
    async ({ query }) => {
      try {
        const result = await webSearch(query);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Search failed: ${err.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    'read_page',
    {
      title: 'Read Page',
      description:
        'Fetch a URL and extract its main readable content as text, stripping navigation/ads/boilerplate. Use this to read a specific page, e.g. one found via web_search. ' +
        'Reads static HTML only - JavaScript is not executed, so pages whose content (e.g. a "live" clock or a value that updates client-side) is rendered by client-side JS may show stale or placeholder text instead of the real current value. When accuracy matters, prefer a source that states the fact directly in server-rendered text, and cross-check against multiple pages rather than trusting a single one.',
      inputSchema: {
        url: z.string().describe('The URL to fetch and read'),
      },
    },
    async ({ url }) => {
      try {
        const result = await readPage(url);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed to read page: ${err.message}` }], isError: true };
      }
    },
  );

  return server;
}

const app = express();
app.use(express.json());

// Stateless MCP: no per-user credential, no session to maintain (see librechat.yaml.template's
// fenrix-search entry - the whole point of this server is a single shared, no-auth tool every
// tenant reaches identically). A fresh server+transport per request avoids any state leaking
// between concurrent callers, matching the SDK's own documented stateless-mode pattern.
app.post('/mcp', async (req, res) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[fenrix-search-mcp] request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// GET/DELETE aren't meaningful in stateless mode (no session to resume/close against) - the
// SDK's own stateless-mode docs note these should be rejected rather than silently accepted.
app.get('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed - stateless server' },
    id: null,
  });
});

app.get('/health', (_req, res) => res.status(200).send('ok'));

app.listen(PORT, () => {
  console.log(`[fenrix-search-mcp] listening on :${PORT}`);
});
