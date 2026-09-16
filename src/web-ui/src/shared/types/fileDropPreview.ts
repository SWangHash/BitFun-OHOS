export interface FileDropPreviewItem {
  name: string;
  thumbnail?: string | null;
}

export interface FileDropPreview {
  count: number;
  files: FileDropPreviewItem[];
  unavailable?: boolean;
}

export interface FileDropPosition { x: number; y: number }
