import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@librechat/client';
import { useLocalize, useExpandCollapse } from '~/hooks';
import { cn } from '~/utils';

interface TurnPreambleProps {
  children: ReactNode;
}

/**
 * Collapses everything that led up to the final answer (Thoughts blocks,
 * tool-call groups, interim text) into one disclosure, default-collapsed -
 * only mounted once the turn has settled with a clean trailing answer, see
 * ContentParts.tsx's `hasFinalAnswer`. Nothing inside is unmounted when
 * collapsed (just hidden via grid-row + inert, same technique ToolCallGroup
 * uses) so a nested ToolCallGroup's own expand state survives toggling this.
 */
export default function TurnPreamble({ children }: TurnPreambleProps) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useState(false);
  const { style, ref } = useExpandCollapse(isExpanded);
  const label = localize('com_ui_show_work');

  return (
    <div className="mb-2 mt-1">
      <Button
        variant="ghost"
        type="button"
        className="inline-flex h-auto w-full items-center justify-start gap-2 rounded-none bg-transparent p-0 py-1 text-text-secondary hover:bg-transparent hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy focus-visible:ring-offset-0"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-label={label}
      >
        <span className="min-w-0 truncate text-xs font-normal">{label}</span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200 ease-out',
            isExpanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </Button>
      <div style={style} ref={ref} data-testid="turn-preamble-panel">
        <div className="overflow-hidden">
          <div className="py-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}
