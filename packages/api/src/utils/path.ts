import { logger } from '@librechat/data-schemas';

/**
 * Gets the base path from the DOMAIN_CLIENT environment variable.
 * This is useful for constructing URLs when LibreChat is served from a subdirectory.
 * @returns {string} The base path (e.g., '/librechat' or '')
 */
export function getBasePath(): string {
  if (!process.env.DOMAIN_CLIENT) {
    return '';
  }

  try {
    const clientUrl = new URL(process.env.DOMAIN_CLIENT);
    // Keep consistent with the logic in api/server/index.js
    const baseHref = clientUrl.pathname.endsWith('/')
      ? clientUrl.pathname.slice(0, -1) // Remove trailing slash for path construction
      : clientUrl.pathname;

    return baseHref === '/' ? '' : baseHref;
  } catch (error) {
    logger.warn('Error parsing DOMAIN_CLIENT for base path:', error);
    return '';
  }
}

/**
 * Fenrix: the `path` every auth cookie (`res.cookie`/`res.clearCookie`) must use, so that
 * per-tenant deployments sharing one domain behind a reverse proxy (each served from its own
 * `DOMAIN_CLIENT` subpath, e.g. `/root/<tenant_id>/app`) don't send or clear each other's
 * session cookies. Falls back to `/` when `DOMAIN_CLIENT` has no path segment.
 * A `res.clearCookie` call must pass the same path the cookie was set with, or it won't match.
 * @returns {string} The cookie path (e.g. '/root/acme/app/' or '/')
 */
export function getAuthCookiePath(): string {
  return `${getBasePath()}/`;
}
