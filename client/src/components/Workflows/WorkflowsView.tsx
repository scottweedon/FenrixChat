import { useMediaQuery } from '@librechat/client';
import { useDocumentTitle, useLocalize } from '~/hooks';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { getWorkflowsUrl } from '~/utils';

/**
 * Fenrix: full-panel iframe embedding this tenant's Langflow instance (design-spec.md
 * §5/§9.2 - "Workflows" nav item, authenticated via the shared Keycloak SSO session set up
 * by FenrixChat's own OIDC login, no second login). Deliberately no chrome around the
 * iframe beyond the mobile sidebar toggle every other full-page route also shows - Langflow
 * is meant to feel like part of this app, not an embedded third-party page.
 */
export default function WorkflowsView() {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  useDocumentTitle(`${localize('com_ui_workflows')} | LibreChat`);

  return (
    <div className="relative flex h-full w-full flex-col">
      {isSmallScreen ? (
        <div className="flex items-center gap-2 border-b border-border-light p-2">
          <OpenSidebar />
        </div>
      ) : null}
      <iframe
        title={localize('com_ui_workflows')}
        src={getWorkflowsUrl()}
        className="h-full w-full flex-1 border-0"
      />
    </div>
  );
}
