const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { isSSRFTarget, resolveHostnameSSRF, getEffectivePort } = require('@librechat/api');

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Unlike webSearch.js's fixed SearXNG address, this takes a caller-supplied URL - the
 * same class of risk LibreChat's own domain.ts / Langflow's ssrf_protection.py guard
 * against. Reuses @librechat/api's already-audited SSRF logic (isSSRFTarget/
 * resolveHostnameSSRF/getEffectivePort - same functions packages/api/src/web/web.ts uses
 * for its own user-supplied URL fields) rather than reimplementing private-IP/DNS-
 * rebinding checks from scratch. No allowedAddresses exemption list - unlike LibreChat's
 * own MCP-connection SSRF gate, this tool has no legitimate reason to ever reach a
 * private-network target.
 */
async function assertUrlSafe(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`);
  }
  const port = getEffectivePort(parsed.protocol, parsed.port);
  if (isSSRFTarget(parsed.hostname, null, port)) {
    throw new Error(`Blocked target: ${parsed.hostname}`);
  }
  if (await resolveHostnameSSRF(parsed.hostname, null, port)) {
    throw new Error(`Blocked target (resolves to a private address): ${parsed.hostname}`);
  }
  return parsed;
}

/**
 * Redirects are followed manually, re-validating each hop against the SSRF check above -
 * fetch's built-in automatic redirect-following would let a first, safe-looking URL
 * redirect straight into a private target without ever being checked (the same
 * OWASP-documented gap URLComponent's own ssrf_protection.py guards against on the
 * Langflow side).
 */
async function fetchWithRevalidatedRedirects(urlString) {
  let currentUrl = urlString;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertUrlSafe(currentUrl);
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FenrixSearchBot/1.0)' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect with no Location header from ${currentUrl}`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects fetching ${urlString}`);
}

async function readPage(urlString) {
  const response = await fetchWithRevalidatedRedirects(urlString);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${urlString}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('html')) {
    throw new Error(`Unsupported content type for reading: ${contentType || 'unknown'}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error(`Page too large (${contentLength} bytes)`);
  }

  const html = await response.text();
  if (html.length > MAX_BODY_BYTES) {
    throw new Error('Page too large');
  }

  const dom = new JSDOM(html, { url: response.url });
  const article = new Readability(dom.window.document).parse();
  if (!article) {
    throw new Error(`Could not extract readable content from ${urlString}`);
  }

  return {
    url: response.url,
    title: article.title,
    content: article.textContent.trim(),
    excerpt: article.excerpt,
  };
}

module.exports = { readPage };
