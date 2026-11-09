import { phaseIdFromLabel } from '../model/ledgerSchema';
import type { MigrationGateResult, MigrationPhaseId, ParsedStateMd, StateGate, StateScope } from '../model/types';

/**
 * Best-effort parser for `migration/ohos/STATE.md`.
 *
 * STATE.md is free-form Markdown maintained by the agent, so every field is
 * optional: sections are located by heading and tables by their header row.
 * Anything that cannot be located is simply omitted.
 */

type TextGateField = keyof StateGate;

const GATE_FIELDS: Array<[TextGateField, RegExp]> = [
  // Same shape as phase_gate.ASSESSMENT_RE.
  ['assessment', /^\s*-\s*Assessment:\s*`?([A-Za-z-]+)`?/im],
  ['currentPhase', /^\s*-\s*Current phase:\s*(.+)$/im],
  ['completionTier', /^\s*-\s*Completion tier:\s*(.+)$/im],
  ['nextExecutableAction', /^\s*-\s*Next executable action:\s*(.+)$/im],
];

/** Scope table field (first column, case-insensitive prefix) → StateScope key. */
const SCOPE_FIELDS: Array<[RegExp, keyof StateScope]> = [
  [/^application target/i, 'target'],
  [/^qt source root/i, 'source'],
  [/^harmonyos output project/i, 'outputProject'],
  [/^source revision/i, 'revision'],
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

/** A Scope cell: a value wrapped entirely in backticks loses them; TODO means unset. */
function scopeValue(raw: string | undefined): string | undefined {
  const value = (raw ?? '').trim().replace(/^`([^`]*)`$/, '$1').trim();
  return !value || /^todo$/i.test(value) ? undefined : value;
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

const GATE_CELL_RE = /^(READY|NOT-READY)\s*@\s*(\S+)(?:\s*\((\d+)\s+unmet(?::\s*(.*?))?\)\s*)?$/i;

/**
 * Parse a Progress Gate cell (gate_state.py):
 *   READY @2026-10-08T16:54:51+08:00
 *   NOT-READY @2026-10-08T16:54:51+08:00 (3 unmet: …)
 */
export function parseGateCell(phase: MigrationPhaseId, cell: string | undefined): MigrationGateResult | undefined {
  const match = (cell ?? '').trim().match(GATE_CELL_RE);
  if (!match) return undefined;
  const ready = match[1].toUpperCase() === 'READY';
  const parsedAt = Date.parse(match[2]);
  const first = (match[4] ?? '').trim();
  const count = match[3] ? Number.parseInt(match[3], 10) : 0;
  return {
    phase,
    verdict: ready ? 'ready' : 'not-ready',
    at: Number.isFinite(parsedAt) ? parsedAt : undefined,
    unmet: !ready && first ? [first] : [],
    unmetCount: ready ? 0 : Math.max(count, first ? 1 : 0),
    invalid: !ready && /^INVALID:/i.test(first) ? true : undefined,
  };
}

export function parseStateMd(text: string | undefined): ParsedStateMd {
  const source = (text ?? '').replace(/^\uFEFF/, '');
  const gate: StateGate = {};
  for (const [field, pattern] of GATE_FIELDS) {
    const match = source.match(pattern);
    const value = cleanValue(match?.[1]);
    if (value) gate[field] = value;
  }

  const sections = splitSections(source);

  const scope: StateScope = {};
  for (const row of parseMarkdownTable(findSection(sections, /^scope/)).rows) {
    const key = SCOPE_FIELDS.find(([pattern]) => pattern.test(row[0] ?? ''))?.[1];
    const value = scopeValue(row[1]);
    if (key && value && !scope[key]) scope[key] = value;
  }

  const progressTable = parseMarkdownTable(findSection(sections, /progress/));
  const gateColumn = progressTable.header.indexOf('gate');
  const progress = progressTable.rows
    .filter((row) => row[0])
    .map((row) => {
      const phaseId = phaseIdFromLabel(row[0]);
      return {
        phase: row[0],
        phaseId,
        status: (row[1] ?? '').replace(/`/g, '').trim(),
        gate: phaseId && gateColumn >= 0 ? parseGateCell(phaseId, row[gateColumn]) : undefined,
      };
    });

  return { scope, gate, progress };
}
