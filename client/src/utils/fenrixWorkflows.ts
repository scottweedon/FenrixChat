/**
 * Fenrix: derives the URL of this tenant's Langflow instance from the same `<base href>`
 * the router already reads for its own `basename` (see routes/index.tsx). Mirrors
 * packages/api/src/utils/path.ts's getSsoTokenCookiePath() on the server: Langflow is a
 * sibling app one path segment above this one (e.g. `/root/acme/app` -> `/root/acme/workflows`),
 * per design-spec.md §9.2's fixed `/root/<tenant_id>/<app>` URL convention.
 */
export function getWorkflowsUrl(): string {
  const baseHref = document.querySelector('base')?.getAttribute('href') || '/';
  const segments = baseHref.split('/').filter((segment) => segment.length > 0);
  segments.pop();
  const tenantRoot = segments.length ? `/${segments.join('/')}` : '';
  return `${tenantRoot}/workflows/`;
}
