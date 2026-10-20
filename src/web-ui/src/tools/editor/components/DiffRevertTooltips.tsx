import { useEffect, useRef, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { Tooltip } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';

// Monaco uses the same gutter action for block and selection reverts.
// Bind its existing controls without changing click behavior or keyboard order.
const REVERT_BUTTON_SELECTOR = [
  '.gutter .gutterItem .action-label.codicon-arrow-right',
  '.gutter .gutterItem .action-label.codicon-discard',
].join(', ');

interface RevertTrigger {
  id: number;
  ref: { current: HTMLElement };
}

export function DiffRevertTooltips({ editor }: { editor: monaco.editor.IStandaloneDiffEditor | null }) {
  const { t } = useI18n('tools');
  const [triggers, setTriggers] = useState<RevertTrigger[]>([]);
  const [scrollRevision, setScrollRevision] = useState(0);
  const nextId = useRef(0);

  useEffect(() => {
    if (!editor) {
      setTriggers([]);
      return;
    }

    const container = editor.getContainerDomNode();
    const knownTriggers = new Map<HTMLElement, RevertTrigger>();
    const syncTriggers = () => {
      const buttons = Array.from(container.querySelectorAll<HTMLElement>(REVERT_BUTTON_SELECTOR));
      const currentButtons = new Set(buttons);
      for (const element of knownTriggers.keys()) {
        if (!currentButtons.has(element)) knownTriggers.delete(element);
      }
      const updated = buttons.map(element => {
        let trigger = knownTriggers.get(element);
        if (!trigger) {
          trigger = { id: nextId.current++, ref: { current: element } };
          knownTriggers.set(element, trigger);
        }
        return trigger;
      });
      setTriggers(previous => previous.length === updated.length
        && previous.every((trigger, index) => trigger === updated[index]) ? previous : updated);
    };

    syncTriggers();
    // Monaco replaces gutter actions when the diff or selection changes.
    const observer = new MutationObserver(syncTriggers);
    observer.observe(container, { childList: true, subtree: true });
    // Monaco scrolls its view without a native DOM scroll event.
    const scrollListener = editor.getModifiedEditor().onDidScrollChange(() => {
      setScrollRevision(revision => revision + 1);
    });
    return () => {
      observer.disconnect();
      scrollListener.dispose();
    };
  }, [editor]);

  if (!editor) return null;

  return triggers.map(({ id, ref }) => (
    <Tooltip
      key={`${id}:${scrollRevision}`}
      triggerRef={ref}
      trigger="hover-focus"
      placement="right"
      content={t('editor.diffEditor.revertChangeTooltip')}
    />
  ));
}
