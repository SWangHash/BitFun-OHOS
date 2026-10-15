import { phaseIdFromLabel } from '../model/ledgerSchema';
import type { ParsedStateMd, StateDecisionRow, StateGate } from '../model/types';
import { parseLastGateLine } from './parseGateOutput';

/**
 * Best-effort parser for `migration/ohos/STATE.md`.
 *
 * STATE.md is free-form Markdown maintained by the agent, so every field is
 * optional: sections are located by heading and tables by their header row.
 * Anything that cannot be located is simply omitted.
 */

type TextGateField = Exclude<keyof StateGate, 'lastGate'>;

const GATE_FIELDS: Array<[TextGateField, RegExp]> = [
  // Same shape as phase_gate.ASSESSMENT_RE.
  ['assessment', /^\s*-\s*Assessment:\s*`?([A-Za-z-]+)`?/im],
  ['currentPhase', /^\s*-\s*Current phase:\s*(.+)$/im],
  ['completionTier', /^\s*-\s*Completion tier:\s*(.+)$/im],
  ['lastUpdated', /^\s*-\s*Last updated:\s*(.+)$/im],
  ['lastCompletedAction', /^\s*-\s*Last completed action:\s*(.+)$/im],
  ['nextExecutableAction', /^\s*-\s*Next executable action:\s*(.+)$/im],
];

function cleanValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim();
  // Drop the template's trailing option hint: "`TODO` (`ready` / ...)".
  const backtickMatch = value.match(/^`([^`]*)`/);
  if (backtickMatch) {
    value = backtickMatch[1];
  }
  value = value.trim();
  if (!value || /^todo$/i.test(value)) return undefined;
  return value;
}

/** Split the document into `## Heading` → body. */
function splitSections(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  let current = '';
  let buffer: string[] = [];
  const flush = () => {
    if (current) sections.set(current, buffer.join('\n'));
  };
  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1].toLowerCase();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function findSection(sections: Map<string, string>, keyword: RegExp): string | undefined {
  for (const [heading, body] of sections) {
    if (keyword.test(heading)) return body;
  }
  return undefined;
}

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Parse the first Markdown table found in `body`. */
export function parseMarkdownTable(body: string | undefined): { header: string[]; rows: string[][] } {
  if (!body) return { header: [], rows: [] };
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line, index) =>
    line.startsWith('|') && /^\|?\s*:?-{2,}/.test(lines[index + 1] ?? ''),
  );
  if (start < 0) return { header: [], rows: [] };
  const header = splitRow(lines[start]).map((cell) => cell.toLowerCase());
  const rows: string[][] = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('|')) break;
    rows.push(splitRow(line));
  }
  return { header, rows };
}

export function parseStateMd(text: string | undefined): ParsedStateMd {
  const source = (text ?? '').replace(/^\uFEFF/, '');
  const gate: StateGate = {};
  for (const [field, pattern] of GATE_FIELDS) {
    const match = source.match(pattern);
    const value = cleanValue(match?.[1]);
    if (value) gate[field] = value;
  }
  const lastGate = parseLastGateLine(source);
  if (lastGate) gate.lastGate = lastGate;

  const sections = splitSections(source);

  const progressTable = parseMarkdownTable(findSection(sections, /progress/));
  const progress = progressTable.rows
    .filter((row) => row[0])
    .map((row) => ({
      phase: row[0],
      phaseId: phaseIdFromLabel(row[0]),
      status: (row[1] ?? '').replace(/`/g, '').trim(),
      evidence: row[2] ?? '',
    }));

  const scope: Record<string, string> = {};
  const scopeTable = parseMarkdownTable(findSection(sections, /scope/));
  for (const row of scopeTable.rows) {
    if (row[0]) scope[row[0]] = row[1] ?? '';
  }

  const decisionsTable = parseMarkdownTable(findSection(sections, /decision|blocker/));
  const decisions: StateDecisionRow[] = decisionsTable.rows
    .filter((row) => row[0])
    .map((row) => ({
      id: row[0],
      item: row[1] ?? '',
      evidence: row[2] ?? '',
      ownerStatus: row[3] ?? '',
      nextAction: row[4] ?? '',
    }));

  return { gate, progress, scope, decisions };
}
