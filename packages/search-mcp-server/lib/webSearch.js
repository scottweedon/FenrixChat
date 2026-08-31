const SEARXNG_BASE_URL = process.env.SEARXNG_BASE_URL || 'http://fenrix-searxng:8080';

/**
 * Thin wrapper over the shared SearXNG instance's JSON search API. SearXNG's own address
 * is a fixed, operator-controlled value (not caller-supplied), so this doesn't need the
 * SSRF checks readPage.js applies to arbitrary URLs.
 */
async function webSearch(query, { maxResults = 8 } = {}) {
  const url = new URL('/search', SEARXNG_BASE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status} ${await response.text()}`);
  }
  const body = await response.json();

  const results = (body.results || []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
    engine: r.engine,
  }));

  return {
    query,
    results,
    unresponsiveEngines: body.unresponsive_engines || [],
  };
}

module.exports = { webSearch };
