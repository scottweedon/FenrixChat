import React, { memo, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Globe, Workflow } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { useBadgeRowContext } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import useLocalStorage from '~/hooks/useLocalStorageAlt';
import { badgeAccents } from './accents';

/**
 * MCP servers promoted to their own composer badge, mirroring WebSearch.tsx/
 * CodeInterpreter.tsx, instead of living inside the generic "MCP Servers" combo
 * badge/submenu - these are this platform's own first-party tools (admin-defined
 * in librechat.yaml), not a user-added connector, so they get first-class billing
 * next to the native tool badges. MCPSelect.tsx and MCPSubMenu.tsx filter these
 * names out of their own listing so each tool has exactly one toggle, not two.
 */
export const PROMOTED_MCP_SERVER_NAMES = new Set(['fenrix-search', 'fenrix-workflows']);

/** Per-server pin state, mirroring useToolToggle.ts's isPinned handling for the
 * native badges (same `interface.defaultPinnedTools` admin default, same
 * "stored preference always wins" race-guard against startupConfig resolving
 * after mount) - but keyed by MCP server name instead of a Tools/AgentCapabilities
 * toolKey, since these aren't ephemeralAgent.tools entries. */
function usePromotedMcpPin(serverName: string) {
  const { data: startupConfig } = useGetStartupConfig();
  const localStorageKey = `mcp_pinned_${serverName}`;

  const defaultPinned = useMemo(() => {
    const defaultPinnedTools = startupConfig?.interface?.defaultPinnedTools;
    return Array.isArray(defaultPinnedTools) && defaultPinnedTools.includes(serverName);
  }, [startupConfig?.interface?.defaultPinnedTools, serverName]);

  const [hadStoredPin] = useState(() => localStorage.getItem(localStorageKey) != null);
  const [isPinned, setIsPinnedRaw] = useLocalStorage<boolean>(localStorageKey, defaultPinned);

  const userSetPin = useRef(false);
  const setIsPinned = useCallback(
    (value: boolean) => {
      userSetPin.current = true;
      setIsPinnedRaw(value);
    },
    [setIsPinnedRaw],
  );

  const appliedDefaultPin = useRef(false);
  useEffect(() => {
    if (appliedDefaultPin.current || startupConfig == null) {
      return;
    }
    appliedDefaultPin.current = true;
    if (hadStoredPin || userSetPin.current) {
      return;
    }
    if (defaultPinned !== isPinned) {
      setIsPinnedRaw(defaultPinned);
    }
  }, [startupConfig, hadStoredPin, defaultPinned, isPinned, setIsPinnedRaw]);

  return { isPinned, setIsPinned };
}

export function usePromotedMcpTool(serverName: string) {
  const context = useBadgeRowContext();
  const manager = context?.mcpServerManager;
  const server = manager?.selectableServers?.find((s) => s.serverName === serverName);
  const checked = manager?.mcpValues?.includes(serverName) ?? false;
  const toggle = () => manager?.toggleServerSelection(serverName);
  const { isPinned, setIsPinned } = usePromotedMcpPin(serverName);
  const label = server?.config?.title || serverName;
  return { server, checked, toggle, isPinned, setIsPinned, label };
}

export const FenrixSearchTool = memo(function FenrixSearchTool() {
  const { server, checked, toggle, isPinned, label } = usePromotedMcpTool('fenrix-search');

  if (!server || !(isPinned || checked)) {
    return null;
  }

  return (
    <CheckboxButton
      checked={checked}
      setValue={toggle}
      label={label}
      isCheckedClassName={badgeAccents.blue}
      icon={<Globe className="icon-md" aria-hidden="true" />}
    />
  );
});

export const FenrixWorkflowsTool = memo(function FenrixWorkflowsTool() {
  const { server, checked, toggle, isPinned, label } = usePromotedMcpTool('fenrix-workflows');

  if (!server || !(isPinned || checked)) {
    return null;
  }

  return (
    <CheckboxButton
      checked={checked}
      setValue={toggle}
      label={label}
      isCheckedClassName={badgeAccents.orange}
      icon={<Workflow className="icon-md" aria-hidden="true" />}
    />
  );
});
