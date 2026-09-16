import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { MobileBanner, MobileButton, MobileConfirmSheet, MobileSheet, MobileTextarea } from '@openbitfun/ui/mobile';
import { useI18n } from '../i18n';

interface Props {
  path: string; content: string; dirty: boolean; busy: boolean; error: string | null;
  onChange: (content: string) => void; onSave: () => void; onBack: () => void;
}

/** A separate full-screen document surface; the directory retains its own position underneath. */
export function WorkspaceFileEditor({ path, content, dirty, busy, error, onChange, onSave, onBack }: Props) {
  const { t } = useI18n();
  const lineCount = content.split('\n').length;
  const lineNumbers = useMemo(() => Array.from({length: lineCount}, (_, index) => index + 1).join('\n'), [lineCount]);
  const gutter = useRef<HTMLPreElement>(null);
  const [discard, setDiscard] = useState(false);
  const back = () => { if (!busy) { if (dirty) setDiscard(true); else onBack(); } };
  return <>
    <MobileSheet className="runtime-file-editor" open showHandle={false} closeOnPointerOutside={false}
      title={<>{path.split('/').slice(-1)[0]}{dirty && <span className="runtime-file-editor__dirty"> •</span>}</>}
      description={path} onOpenChange={back}
      headerAction={<div className="runtime-file-editor__actions">
        <MobileButton size="sm" appearance="plain" leading={<ArrowLeft size={17} />} disabled={busy} onClick={back}>{t('workspace.files')}</MobileButton>
        <MobileButton size="sm" appearance="primary" leading={<Save size={16} />} disabled={busy || !dirty} loading={busy} onClick={onSave}>{t('workspace.save')}</MobileButton>
      </div>}>
      {error && <MobileBanner tone="danger">{error}</MobileBanner>}
      <div className="runtime-file-editor__document">
        <div className="runtime-file-editor__gutter" aria-hidden="true" style={{minWidth: `${String(lineCount).length + 2}ch`}}><pre ref={gutter}>{lineNumbers}</pre></div>
        <MobileTextarea wrap="off" onScroll={event => { if (gutter.current) gutter.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`; }} className="runtime-file-editor__input" aria-label={t('workspace.fileContent')} value={content} onChange={event => onChange(event.target.value)} disabled={busy} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      </div>
    </MobileSheet>
    <MobileConfirmSheet open={discard} title={t('workspace.discardChanges')} cancelLabel={t('common.cancel')} confirmLabel={t('common.continue')} confirmTone="danger" onOpenChange={() => setDiscard(false)} onConfirm={() => { setDiscard(false); onBack(); }}><p>{path}</p></MobileConfirmSheet>
  </>;
}
