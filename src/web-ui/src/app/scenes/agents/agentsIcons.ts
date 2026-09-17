/**
 * Icon and color mapping for the agents scene
 * Shared icon sources for agent identity. Rendering stays owned by @bitfun/ui Icon.
 */
import type { IconSource } from '@bitfun/ui';
import {
  Code2,
  FlaskConical,
  Bug,
  FileText,
  BarChart2,
  Server,
  Layers,
  Cpu,
  Microscope,
} from 'lucide-react';
export { CAPABILITY_ACCENT } from './agentAppearance';

export type AgentIconKey =
  | 'code2' | 'eye' | 'flask' | 'bug' | 'filetext'
  | 'globe' | 'barchart' | 'layers' | 'penline' | 'server'
  | 'user' | 'bot' | 'terminal' | 'microscope' | 'cpu';

export const AGENT_ICON_MAP: Record<AgentIconKey, IconSource> = {
  code2: { glyph: Code2 },
  eye: { name: 'eye' },
  flask: { glyph: FlaskConical },
  bug: { glyph: Bug },
  filetext: { glyph: FileText },
  globe: { name: 'browser' },
  barchart: { glyph: BarChart2 },
  layers: { glyph: Layers },
  penline: { name: 'edit' },
  server: { glyph: Server },
  user: { name: 'user' },
  // Existing agent definitions still use this key; keep their identity readable.
  bot: { name: 'user' },
  terminal: { name: 'terminal' },
  microscope: { glyph: Microscope },
  cpu: { glyph: Cpu },
};

export function getAgentIcon(iconKey?: string): IconSource {
  return AGENT_ICON_MAP[(iconKey ?? 'user') as AgentIconKey] ?? AGENT_ICON_MAP.user;
}
