import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type { TSandboxFilesTree } from 'librechat-data-provider';

/**
 * Flat file listing for the current conversation/Project's Langflow sandbox, behind the
 * file-tree side panel. Invalidated (not directly refetched) after each assistant turn
 * completes — see useSSE.ts/useResumableSSE.ts — so a panel that isn't currently mounted
 * doesn't pay for a fetch nobody's looking at.
 */
export const useSandboxFilesTreeQuery = (
  conversationId?: string | null,
  config?: UseQueryOptions<TSandboxFilesTree>,
): QueryObserverResult<TSandboxFilesTree> => {
  return useQuery<TSandboxFilesTree>(
    [QueryKeys.sandboxFilesTree, conversationId],
    () => dataService.getSandboxFilesTree(conversationId as string),
    {
      enabled: !!conversationId,
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};
