import { api } from './ApiClient';

export interface ComputerUseControlSnapshot {
  supported: boolean;
  generation: number;
  owner: string | null;
  mode: 'observe' | 'background' | 'foreground';
  state: string;
  target: string | null;
  action: string | null;
  sequence: number;
  reason: string | null;
  pointer: { x: number; y: number; click: boolean; sequence?: number; occurred_at_ms?: number;
    last_click?: { x: number; y: number; sequence: number; occurred_at_ms: number } | null } | null;
  capabilities: string[];
}

export interface ComputerUseControlPreview {
  generation: number;
  target: string;
  image_base64: string;
  mime_type: string;
  width: number;
  height: number;
  origin_x: number;
  origin_y: number;
  span_width: number;
  span_height: number;
}

export const computerUseControlAPI = {
  status: () => api.invoke<ComputerUseControlSnapshot>('computer_use_control_status'),
  stop: (generation: number) => api.invoke<ComputerUseControlSnapshot>(
    'computer_use_control_stop', { request: { generation } },
  ),
  preview: (generation: number) => api.invoke<ComputerUseControlPreview>(
    'computer_use_control_preview', { request: { generation } },
  ),
};

/** Reject points outside the captured content rather than clamping to an edge. */
export function projectControlPointer(
  frame: ComputerUseControlPreview,
  pointer: ComputerUseControlSnapshot['pointer'],
): { x: number; y: number; click: boolean } | null {
  if (!pointer || ![frame.origin_x, frame.origin_y, frame.span_width, frame.span_height,
    pointer.x, pointer.y].every(Number.isFinite) || frame.span_width <= 0 || frame.span_height <= 0) return null;
  const x = (pointer.x - frame.origin_x) / frame.span_width;
  const y = (pointer.y - frame.origin_y) / frame.span_height;
  return x >= 0 && x < 1 && y >= 0 && y < 1 ? { x, y, click: pointer.click } : null;
}
