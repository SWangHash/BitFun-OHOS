import { MIGRATION_PHASES } from '../model/ledgerSchema';
import type { MigrationGateResult, MigrationPhaseId } from '../model/types';

/**
 * Parsers for phase-gate verdicts of the qt-harmonyos-migration skill.
 *
 * Two sources carry the same fact:
 *  - stdout of `validate_ledgers.py --phase <p>` / `phase_gate.py <root> <p>`:
 *      INVALID                (optional, followed by `- <error>` lines)
 *      READY phase=<p>   or   BLOCKED phase=<p>  (followed by `- <unmet>` lines)
 *  - the durable `- Last gate:` line the same scripts write into STATE.md:
 *      - Last gate: `BLOCKED inventory` @ 2026-10-08T16:54:51+08:00 via phase_gate.py (3 unmet: …)
 */

function asPhase(value: string | undefined): MigrationPhaseId | undefined {
  const text = (value ?? '').trim().toLowerCase();
  return MIGRATION_PHASES.find((phase) => phase === text);
}

const VERDICT_LINE_RE = /^(READY|BLOCKED)\s+phase=([a-z-]+)\s*$/i;
const BULLET_RE = /^-\s+(.*\S)\s*$/;

/** Parse gate stdout. Returns one result per `READY`/`BLOCKED` line, in order. */
export function parseGateOutput(output: string | undefined, at?: number, tool?: string): MigrationGateResult[] {
  if (!output) return [];
  const results: MigrationGateResult[] = [];
  const invalid: string[] = [];
  let sawInvalid = false;
  /** Bullet lines belong to the closest preceding marker line. */
  let sink: string[] | null = null;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^INVALID\s*$/i.test(line)) {
      sawInvalid = true;
      sink = invalid;
      continue;
    }
    const verdict = line.match(VERDICT_LINE_RE);
    if (verdict) {
      const phase = asPhase(verdict[2]);
      if (!phase) {
        sink = null;
        continue;
      }
      const unmet: string[] = [];
      results.push({
        phase,
        verdict: verdict[1].toUpperCase() === 'READY' ? 'ready' : 'blocked',
        at,
        unmet,
        unmetCount: 0,
        tool,
        source: 'stdout',
      });
      sink = unmet;
      continue;
    }
    const bullet = line.match(BULLET_RE);
    if (bullet && sink) {
      sink.push(bullet[1]);
      continue;
    }
    // Any other line (OK …, WARNINGS, WARNING …) ends the current bullet block.
    sink = null;
  }

  for (const result of results) {
    if (sawInvalid) {
      // Structurally invalid ledgers can never pass a gate, whatever the gate line says.
      result.verdict = 'blocked';
      result.invalid = true;
      result.unmet.unshift(...invalid.map((entry) => `INVALID: ${entry}`));
    }
    result.unmetCount = result.unmet.length;
  }
  return results;
}

const LAST_GATE_RE = /^\s*-\s*Last gate:\s*`(READY|BLOCKED)\s+([a-z-]+)`(?:\s*@\s*(\S+))?(?:\s+via\s+(\S+))?(?:\s*\((\d+)\s+unmet(?::\s*(.*?))?\)\s*)?$/im;

/** Parse the `- Last gate:` line of STATE.md (written by `gate_state.py`). */
export function parseLastGateLine(stateText: string | undefined): MigrationGateResult | undefined {
  const match = (stateText ?? '').match(LAST_GATE_RE);
  if (!match) return undefined;
  const phase = asPhase(match[2]);
  if (!phase) return undefined;
  const ready = match[1].toUpperCase() === 'READY';
  const parsedAt = match[3] ? Date.parse(match[3]) : Number.NaN;
  const first = (match[6] ?? '').trim();
  const count = match[5] ? Number.parseInt(match[5], 10) : 0;
  return {
    phase,
    verdict: ready ? 'ready' : 'blocked',
    at: Number.isFinite(parsedAt) ? parsedAt : undefined,
    unmet: !ready && first ? [first] : [],
    unmetCount: ready ? 0 : Math.max(count, first ? 1 : 0),
    invalid: !ready && /^INVALID:/i.test(first) ? true : undefined,
    tool: match[4] || undefined,
    source: 'state',
  };
}
