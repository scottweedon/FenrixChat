import { useCallback } from 'react';
import { FolderTree, Loader2 } from 'lucide-react';
import { useChatContext } from '~/Providers';
import { useSandboxFilesTreeQuery } from '~/data-provider';
import { dataService } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import FileTree from './FileTree';

/**
 * Shows what an agent has written into the current conversation's (or, if it's part of a
 * Project, the shared Project's) Langflow sandbox — the same filesystem `build_document`/
 * `write_file` write into and `show_document` previews from, just browsable without
 * needing the agent to explicitly call `show_document` first.
 */
export default function SandboxFilesPanel() {
  const localize = useLocalize();
  const { conversation } = useChatContext();
  const conversationId = conversation?.conversationId;

  const { data, isLoading } = useSandboxFilesTreeQuery(conversationId);
  const files = data?.files ?? [];

  const handleFileClick = useCallback(
    async (path: string) => {
      if (!conversationId) {
        return;
      }
      try {
        const { url } = await dataService.getSandboxFilesPreviewUrl(conversationId, path);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        console.error('Failed to build sandbox file preview URL', error);
      }
    },
    [conversationId],
  );

  return (
    <div className="flex h-auto w-full flex-col gap-2 px-3 pb-3 pt-2">
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-text-secondary">
          <FolderTree className="size-6" aria-hidden="true" />
          <span>{localize('com_sidepanel_sandbox_files_empty')}</span>
        </div>
      ) : (
        <FileTree files={files} onFileClick={handleFileClick} />
      )}
    </div>
  );
}
