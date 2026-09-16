import { useState } from 'react';
import { File, FileArchive, FileAudio, FileCode2, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation } from 'lucide-react';
import { OverflowText } from '@openbitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import type { FileDropPreview, FileDropPreviewItem } from '@/shared/types/fileDropPreview';
import { getFileDropPreviewKind, type FilePreviewKind } from './fileDropPreviewKind';

const icons = {
  image: FileImage, pdf: FileText, spreadsheet: FileSpreadsheet,
  presentation: Presentation, document: FileText, code: FileCode2,
  archive: FileArchive, audio: FileAudio, video: FileVideo, file: File,
} satisfies Record<FilePreviewKind, typeof File>;

function PreviewTile({ file }: { file: FileDropPreviewItem }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const { kind, extension } = getFileDropPreviewKind(file.name);
  const Icon = icons[kind];
  const image = file.thumbnail && file.thumbnail !== failedUrl ? file.thumbnail : null;
  return (
    <div className="openbitfun-chat-pane__file-tile" data-kind={kind}>
      {image ? <img src={image} alt={file.name} onError={() => setFailedUrl(image)} /> : (
        <><Icon size={28} strokeWidth={1.5} aria-hidden /><span>{extension}</span></>
      )}
    </div>
  );
}

export function FileDropPreviewCards({ preview }: { preview: FileDropPreview }) {
  const { t, formatNumber } = useI18n('flow-chat');
  const count = formatNumber(preview.count);
  const firstFile = preview.files[0];
  return (
    <div className="openbitfun-chat-pane__file-preview" data-multiple={preview.count > 1}
      data-stack-depth={Math.min(preview.count, 3)}>
      <div className="openbitfun-chat-pane__file-front">
        {firstFile && <PreviewTile key={firstFile.name} file={firstFile} />}
        <div className="openbitfun-chat-pane__file-caption">
          <OverflowText>{firstFile?.name}</OverflowText>
        </div>
      </div>
      {preview.count > 1 && <span className="openbitfun-chat-pane__file-count"
        aria-label={t('context.dropFileCount', { fileCount: count })}>{count}</span>}
    </div>
  );
}
