import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LEDGER_TSV_FILES, LEDGER_TSV_HEADERS, LEDGER_TSV_OPTIONAL_HEADERS, normalizeStatus, phaseIdFromLabel } from './model/ledgerSchema';
import type { LedgerDocument, MigrationLedgerInput, ParsedTsv } from './model/types';
import { parseTsv } from './parsers/parseTsv';
import { parseStateMd } from './parsers/parseStateMd';
import { parseGateOutput, parseLastGateLine } from './parsers/parseGateOutput';
import { collectGates, deriveSnapshot, effectiveCurrentPhase, getAppRoot } from './services/deriveSnapshot';
import {
  classifyMigrationToolEvent,
  extractFeaturesRootHints,
  extractPathHints,
  extractToolResult,
  isMigrationEvidence,
  isMigrationSession,
  rememberMigrationSession,
} from './services/migrationToolSignals';
import { displayLedgerRoot, featuresRootFromHint, ledgerRootFromHint, rankLedgerRoot } from './services/MigrationProgressService';
import { buildExternalFeatures, matchMilestone, parseFeatureGate } from './services/deriveExternalFeatures';
import { parseFeatureHook, parseFeatureRegistry } from './services/featurePackages';

// Copy of the skill's `assets/templates/migration/ohos/` (the skill is an
// external, user-imported skill and no longer lives in this repository).
// Refresh it when the skill's ledger templates change.
const TEMPLATE_DIR = fileURLToPath(new URL('./__fixtures__/ledger-templates/', import.meta.url));

function template(name: string): string {
  return readFileSync(`${TEMPLATE_DIR}${name}`, 'utf8');
}

const ROOT = '/work/app/migration/ohos';

function input(overrides: {
  state?: string;
  tsv?: Record<string, string>;
  documents?: Record<string, Partial<LedgerDocument>>;
  extra?: Partial<MigrationLedgerInput>;
} = {}): MigrationLedgerInput {
  const tsv: Partial<Record<string, ParsedTsv>> = {};
  for (const file of LEDGER_TSV_FILES) {
    const text = overrides.tsv?.[file];
    if (text !== undefined) tsv[file] = parseTsv(text, LEDGER_TSV_HEADERS[file]);
  }
  const documents: Record<string, LedgerDocument> = {};
  for (const [name, doc] of Object.entries(overrides.documents ?? {})) {
    documents[name] = { path: `${ROOT}/${name}`, exists: true, ...doc };
  }
  return {
    ledgerRoot: ROOT,
    state: overrides.state !== undefined ? parseStateMd(overrides.state) : undefined,
    tsv,
    documents,
    now: 1_000_000,
    ...overrides.extra,
  };
}

function templateInput(): MigrationLedgerInput {
  const tsv: Record<string, string> = {};
  for (const file of LEDGER_TSV_FILES) {
    if (file === 'knowledge-manifest.tsv') continue;
    tsv[file] = template(file);
  }
  return input({
    state: template('STATE.md'),
    tsv,
    documents: {
      'STATE.md': { text: template('STATE.md') },
      'PORTING_CONTRACT.md': { text: template('PORTING_CONTRACT.md') },
    },
  });
}

describe('parseTsv', () => {
  it('handles BOM, CRLF, short and long rows', () => {
    const parsed = parseTsv('\uFEFFid\tstatus\textra\r\nA\tpassed\r\n\r\nB\tplanned\tx\ty\r\n', ['id', 'status', 'evidence']);
    expect(parsed.header).toEqual(['id', 'status', 'extra']);
    expect(parsed.rows).toEqual([
      { id: 'A', status: 'passed', extra: '' },
      { id: 'B', status: 'planned', extra: 'x' },
    ]);
    expect(parsed.missingColumns).toEqual(['evidence']);
    expect(parsed.extraColumns).toEqual(['extra']);
  });

  it('returns an empty result for empty input', () => {
    expect(parseTsv(undefined).rows).toEqual([]);
  });

  it('matches every shipped template header', () => {
    for (const file of LEDGER_TSV_FILES) {
      if (file === 'knowledge-manifest.tsv') continue;
      const parsed = parseTsv(template(file), LEDGER_TSV_HEADERS[file]);
      expect(parsed.missingColumns, file).toEqual([]);
      expect(parsed.extraColumns, file).toEqual([...(LEDGER_TSV_OPTIONAL_HEADERS[file] ?? [])]);
    }
  });
});

describe('parseStateMd', () => {
  it('drops TODO placeholders from the template gate', () => {
    const state = parseStateMd(template('STATE.md'));
    expect(state.gate).toEqual({});
    expect(state.progress).toHaveLength(8);
    expect(state.progress.map((row) => row.phaseId)).toEqual([
      'baseline', 'inventory', 'contract', 'pilot', 'implementation', 'features', 'diagnostics', 'handoff',
    ]);
    expect(state.decisions[0]).toMatchObject({ id: 'DEC-001', item: 'TODO' });
  });

  it('reads filled gate fields', () => {
    const state = parseStateMd([
      '## Gate',
      '- Assessment: `ready-with-decisions` (`ready` / `blocked`)',
      '- Current phase: `pilot`',
      '- Completion tier: `implemented-unverified`',
      '- Last completed action: `configured qmake`',
      '- Next executable action: run pilot build',
    ].join('\n'));
    expect(state.gate).toEqual({
      assessment: 'ready-with-decisions',
      currentPhase: 'pilot',
      completionTier: 'implemented-unverified',
      lastCompletedAction: 'configured qmake',
      nextExecutableAction: 'run pilot build',
    });
  });
});

describe('ledgerSchema helpers', () => {
  it('normalizes statuses', () => {
    expect(normalizeStatus('passed')).toBe('done');
    expect(normalizeStatus('`in-progress`')).toBe('doing');
    expect(normalizeStatus('not-run')).toBe('pending');
    expect(normalizeStatus('failed')).toBe('error');
    expect(normalizeStatus('deferred')).toBe('blocked');
    expect(normalizeStatus('weird')).toBe('unknown');
  });

  it('maps progress labels to phases', () => {
    expect(phaseIdFromLabel('Risk pilot')).toBe('pilot');
    expect(phaseIdFromLabel('Verification and handoff')).toBe('handoff');
    expect(phaseIdFromLabel('TODO')).toBeUndefined();
    expect(phaseIdFromLabel('Pilot verification (`pilot`, pilot.tsv)')).toBe('pilot');
    expect(phaseIdFromLabel('HarmonyOS feature adaptation (`features`, feature-adoption.tsv)')).toBe('features');
    expect(phaseIdFromLabel('Build and diagnostics (`diagnostics`, diagnostics.tsv)')).toBe('diagnostics');
    expect(phaseIdFromLabel('Environment preparation (`baseline`, environment.tsv)')).toBe('baseline');
  });
});

describe('deriveSnapshot', () => {
  it('reports 0% for freshly initialized templates', () => {
    const snapshot = deriveSnapshot(templateInput());
    expect(snapshot.appRoot).toBe('/work/app');
    expect(snapshot.header.overallPercent).toBe(0);
    expect(snapshot.header.liveStatus).toBe('idle');
    expect(snapshot.phases.map((phase) => phase.status)).toEqual(Array(8).fill('pending'));
    expect(snapshot.decisionsPending).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.schemaWarnings).toEqual([]);
    const baseline = snapshot.phases.find((phase) => phase.id === 'baseline')!;
    expect(baseline.total).toBe(10);
    expect(snapshot.phases.map((phase) => phase.ledger)).toEqual([
      'environment.tsv', 'inventory.tsv', 'decisions.tsv', 'pilot.tsv',
      'work-queue.tsv', 'feature-adoption.tsv', 'diagnostics.tsv', 'validation.tsv',
    ]);
    expect(baseline.ledgerPath).toBe(`${ROOT}/environment.tsv`);
    // The template leaves the project name as TODO: fall back to the app folder.
    expect(snapshot.header.project).toBe('app');
    expect(snapshot.documents.filter((doc) => doc.kind === 'ledger').map((doc) => doc.label))
      .toEqual(['baseline.tsv', 'package-manifest.tsv', 'device-runs.tsv']);
  });

  it('reads pilot attempts from pilot.tsv and legacy diagnostics rows', () => {
    const header = (file: string) => LEDGER_TSV_HEADERS[file].join('\t');
    const row = (file: string, values: Record<string, string>) =>
      LEDGER_TSV_HEADERS[file].map((column) => values[column] ?? '').join('\t');
    const snapshot = deriveSnapshot(input({
      tsv: {
        'pilot.tsv': [
          header('pilot.tsv'),
          row('pilot.tsv', { id: 'PILOT-001', phase: 'pilot', category: 'link', first_causal_signature: 'undefined symbol', status: 'open' }),
        ].join('\n'),
        'diagnostics.tsv': [
          header('diagnostics.tsv'),
          row('diagnostics.tsv', { id: 'DIAG-001', phase: 'pilot', category: 'package', first_causal_signature: 'hap missing', status: 'resolved' }),
          row('diagnostics.tsv', { id: 'DIAG-002', phase: 'build', category: 'compile', first_causal_signature: 'no member', status: 'open' }),
        ].join('\n'),
        'feature-adoption.tsv': [
          header('feature-adoption.tsv'),
          row('feature-adoption.tsv', { id: 'FEAT-001', feature_id: 'share', kind: 'capability', host_phase: 'features', status: 'passed' }),
          row('feature-adoption.tsv', { id: 'FEAT-002', feature_id: 'continuation', status: 'planned' }),
        ].join('\n'),
      },
    }));
    const phase = (id: string) => snapshot.phases.find((entry) => entry.id === id)!;
    expect(phase('pilot').items.map((entry) => entry.id)).toEqual(['DIAG-001', 'PILOT-001']);
    expect(phase('diagnostics').items.map((entry) => entry.id)).toEqual(['DIAG-002']);
    expect(phase('features').items.map((entry) => [entry.label, entry.status])).toEqual([
      ['share', 'done'], ['continuation', 'pending'],
    ]);
    expect(phase('features').ledgerPath).toBe(`${ROOT}/feature-adoption.tsv`);
    expect(phase('handoff').ledgerPath).toBeUndefined();
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.id).sort()).toEqual(['DIAG-001', 'DIAG-002', 'PILOT-001']);
  });

  it('uses the STATE.md project name as the title', () => {
    const snapshot = deriveSnapshot(input({ state: '## Scope\n| Field | Value | Evidence |\n|---|---|---|\n| Project / repository | Notepad-- | git |\n' }));
    expect(snapshot.header.project).toBe('Notepad--');
  });

  it('names a ledger inside the HarmonyOS output project after its parent folder', () => {
    const inside = deriveSnapshot({
      ...input(),
      ledgerRoot: 'D:\\code\\notepad--\\project\\migration\\ohos',
      appRootIsOhosProject: true,
    });
    expect(inside.header.project).toBe('notepad--');
    const plain = deriveSnapshot({ ...input(), ledgerRoot: 'D:\\code\\notepad--\\project\\migration\\ohos' });
    expect(plain.header.project).toBe('project');
    const named = deriveSnapshot({
      ...input({ state: '## Scope\n| Field | Value | Evidence |\n|---|---|---|\n| Project / repository | Notepad-- | git |\n' }),
      appRootIsOhosProject: true,
    });
    expect(named.header.project).toBe('Notepad--');
  });

  it('counts recorded inventory rows as done and shows their migration state separately', () => {
    const row = (id: string, scan: string, status: string, val = 'VAL-001') =>
      [id, 'qt-api-gap', 'src/a.pro', 'qmake', 'x', 'y', 'none', 'src', scan, 'fix', 'z', 'src/a.pro', 'low', status, 'e', val].join('\t');
    const snapshot = deriveSnapshot(input({
      tsv: {
        'inventory.tsv': [
          'id\tcategory\tsource_location\tsource_kind\tcurrent_behavior\tohos_constraint\tprerequisites\tscan_scope\tscan_evidence\tdisposition\ttarget_behavior\tfiles\trisk\tstatus\tevidence\tvalidation_id',
          row('CAP-001', 'grep receipt', 'planned'),
          row('CAP-002', 'grep receipt', 'verified'),
          row('CAP-003', 'TODO', 'planned', 'TODO'),
          row('CAP-004', 'grep receipt', 'blocked'),
        ].join('\n'),
      },
    }));
    const inventory = snapshot.phases.find((phase) => phase.id === 'inventory')!;
    expect(inventory.items.map((entry) => [entry.id, entry.status, entry.migration])).toEqual([
      ['CAP-001', 'done', 'pending'],
      ['CAP-002', 'done', 'done'],
      ['CAP-003', 'pending', 'pending'],
      ['CAP-004', 'done', 'blocked'],
    ]);
    expect(inventory.done).toBe(3);
  });

  it('ignores bootstrap receipt rows', () => {
    const snapshot = deriveSnapshot(input({
      tsv: {
        'diagnostics.tsv': `${LEDGER_TSV_HEADERS['diagnostics.tsv'].join('\t')}\nDIAG-BOOT-001\t\tbootstrap\t\t\t\t1\t\t\t\t\t\t\tresolved\t`,
      },
    }));
    expect(snapshot.diagnostics).toEqual([]);
  });

  it('derives phases, decisions, problems, receipts and documents', () => {
    const header = (file: string) => LEDGER_TSV_HEADERS[file].join('\t');
    const row = (file: string, values: Record<string, string>) =>
      LEDGER_TSV_HEADERS[file].map((column) => values[column] ?? '').join('\t');
    const snapshot = deriveSnapshot(input({
      state: '## Gate\n- Current phase: `implementation`\n- Assessment: `ready-with-decisions`\n',
      tsv: {
        'work-queue.tsv': [
          header('work-queue.tsv'),
          row('work-queue.tsv', { id: 'CAP-001', capability: 'widgets', status: 'passed' }),
          row('work-queue.tsv', { id: 'CAP-002', capability: 'network', status: 'planned', prerequisites: 'CAP-001' }),
          row('work-queue.tsv', { id: 'CAP-003', capability: 'camera', status: 'planned', prerequisites: 'CAP-004' }),
        ].join('\n'),
        'decisions.tsv': [
          header('decisions.tsv'),
          row('decisions.tsv', { id: 'DEC-001', question: 'Drop printing?', owner: 'user', status: 'proposed', feature_or_scope: 'printing' }),
          row('decisions.tsv', { id: 'DEC-002', question: 'Use QML?', owner: 'user', approved_at: '2026-01-01', status: 'approved' }),
        ].join('\n'),
        'diagnostics.tsv': [
          header('diagnostics.tsv'),
          row('diagnostics.tsv', { id: 'DIAG-001', phase: 'pilot', category: 'link', first_causal_signature: 'undefined symbol', affected_ids: 'CAP-001', status: 'resolved', log_path: 'migration/ohos/logs/1.log', attempts: '2' }),
          row('diagnostics.tsv', { id: 'DIAG-002', phase: 'implementation', category: 'unclassified', first_causal_signature: 'unclassified', status: 'open' }),
          row('diagnostics.tsv', { id: 'DIAG-003', phase: 'pilot', category: 'receipt', first_causal_signature: 'pilot passed', affected_ids: 'CAP-001', status: 'passed', log_path: 'devecocli smoke run-1', attempts: '3' }),
        ].join('\n'),
      },
      documents: { 'assessment.md': { text: '# ok' } },
    }));

    const implementation = snapshot.phases.find((phase) => phase.id === 'implementation')!;
    expect(implementation.status).toBe('doing');
    expect(implementation.items.map((entry) => entry.status)).toEqual(['done', 'ready', 'pending']);
    expect(snapshot.phases.find((phase) => phase.id === 'pilot')!.status).toBe('done');

    expect(snapshot.decisionsPending.map((decision) => decision.id)).toEqual(['DEC-001']);

    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(['DIAG-002', 'DIAG-001', 'DIAG-003']);
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual(['problem', 'problem', 'receipt']);
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.open)).toEqual([true, false, false]);
    expect(snapshot.diagnostics[0].unclassified).toBe(true);
    expect(snapshot.diagnostics[1].logPath).toBe('/work/app/migration/ohos/logs/1.log');
    // Not a text log: no open-log action. One of the two failed retries is recorded as DIAG-001.
    expect(snapshot.diagnostics[2].logPath).toBeUndefined();
    expect(snapshot.diagnostics[2].unrecordedFailures).toBe(1);

    expect(snapshot.documents.map((doc) => doc.id)).toEqual(['doc:assessment.md']);
    expect(snapshot.phases.find((phase) => phase.id === 'contract')!.items.map((entry) => entry.id))
      .toEqual(['DEC-001', 'DEC-002']);
  });

  it('marks recent writes and running scripts as active', () => {
    expect(deriveSnapshot(input({ extra: { lastWriteAt: 1_000_000 - 1_000 } })).header.liveStatus).toBe('active');
    expect(deriveSnapshot(input({ extra: { activeAction: 'phase_gate.py' } })).header.liveStatus).toBe('active');
    expect(deriveSnapshot(input({ extra: { lastWriteAt: 1 } })).header.liveStatus).toBe('idle');
  });

  it('strips the ledger suffix for the app root', () => {
    expect(getAppRoot('D:\\proj\\app\\migration\\ohos\\')).toBe('D:\\proj\\app');
  });
});

describe('migrationToolSignals', () => {
  it('classifies the skill invocation', () => {
    expect(classifyMigrationToolEvent('Skill', { command: 'qt-harmonyos-migration' }))
      .toMatchObject({ kind: 'skill', pathHints: [], ledgerWrite: false });
    expect(classifyMigrationToolEvent('Skill', { command: '$qt-harmonyos-migration' })?.kind).toBe('skill');
    expect(classifyMigrationToolEvent('Skill', { command: 'docx' })?.kind).toBe('activity');
    expect(classifyMigrationToolEvent('Skill', 'not-an-object')).toBeNull();
  });

  it('classifies migration scripts and extracts path hints', () => {
    const signal = classifyMigrationToolEvent('Bash', {
      command: 'python "C:/skills/qt-harmonyos-migration/scripts/validate_ledgers.py" --target D:/proj/app --phase pilot',
    });
    expect(signal).toMatchObject({ kind: 'script', script: 'validate_ledgers.py', pathHints: ['D:/proj/app'], ledgerWrite: true });
    expect(classifyMigrationToolEvent('ExecCommand', { command: 'python scripts/ledger_query.py --target D:/a' }))
      .toMatchObject({ kind: 'script', ledgerWrite: false });
    expect(classifyMigrationToolEvent('Bash', { command: 'python other.py' })?.kind).toBe('activity');
    expect(classifyMigrationToolEvent('Read', { command: 'phase_gate.py' })?.kind).toBe('activity');
  });

  it('never treats the skill template as a ledger root', () => {
    const template = 'C:/Users/u/AppData/Roaming/bitfun/skills/.system/qt-harmonyos-migration/assets/templates/migration/ohos';
    expect(extractPathHints(`python init_migration.py --target D:/code/notepad-- --template-root ${template}`))
      .toEqual(['D:/code/notepad--']);
    expect(extractPathHints(`python init_migration.py --template-root="${template}" --target=D:/app`)).toEqual(['D:/app']);
    expect(extractPathHints(`ls ${template}/STATE.md`)).toEqual([]);
    expect(ledgerRootFromHint(template, '/ws')).toBeNull();
  });

  it('describes file tools and detects ledger writes', () => {
    expect(classifyMigrationToolEvent('Write', { payload: '+++ D:/app/migration/ohos/STATE.md\n# State' }))
      .toMatchObject({ kind: 'activity', ledgerWrite: true, pathHints: ['D:/app/migration/ohos'] });
    expect(classifyMigrationToolEvent('Read', { file_path: 'D:/app/migration/ohos/STATE.md' }))
      .toMatchObject({ ledgerWrite: false, pathHints: ['D:/app/migration/ohos'] });
    expect(classifyMigrationToolEvent('Edit', { file_path: 'D:/app/src/main.cpp' }))
      .toMatchObject({ ledgerWrite: false, pathHints: [] });
    const todos = classifyMigrationToolEvent('TodoWrite', {
      todos: [
        { content: 'baseline', status: 'completed' },
        { content: 'inventory', status: 'in_progress' },
        { content: 'contract', status: 'pending' },
      ],
    });
    expect(todos?.summary).toBe('inventory');
    expect(todos?.todos).toHaveLength(3);
  });

  it('normalizes tool results', () => {
    expect(extractToolResult({ output: 'READY phase=baseline', exit_code: 0 })).toEqual({
      output: 'READY phase=baseline', exitCode: 0, error: undefined,
    });
    expect(extractToolResult(undefined, 'text')).toMatchObject({ output: 'text' });
    expect(extractToolResult(undefined, undefined, 'boom')).toMatchObject({ error: 'boom' });
    expect(extractToolResult(undefined)).toBeUndefined();
  });

  it('extracts ledger roots from paths', () => {
    expect(extractPathHints('cat ./app/migration/ohos/STATE.md')).toEqual(['./app/migration/ohos']);
  });

  it('resolves hints to ledger roots', () => {
    expect(ledgerRootFromHint('D:/proj/app', '/ws')).toBe('D:/proj/app/migration/ohos');
    expect(ledgerRootFromHint('./app/migration/ohos', '/ws')).toBe('/ws/app/migration/ohos');
    expect(ledgerRootFromHint('app', undefined)).toBeNull();
  });

  it('ranks ledger roots against the workspace', () => {
    expect(rankLedgerRoot('D:\\code\\app\\migration\\ohos', 'D:/code/app')).toBe(0);
    expect(rankLedgerRoot('D:/code/app/sub/migration/ohos', 'D:/code/app')).toBe(1);
    expect(rankLedgerRoot('D:/other/migration/ohos', 'D:/code/app')).toBe(2);
    expect(rankLedgerRoot('C:/x/skills/.system/qt-harmonyos-migration/assets/templates/migration/ohos', 'D:/code/app')).toBe(3);
    expect(displayLedgerRoot('D:/code/app/migration/ohos', 'D:/code/app')).toBe('migration/ohos');
    expect(displayLedgerRoot('D:/other/migration/ohos', 'D:/code/app')).toBe('D:/other/migration/ohos');
  });
});

describe('gate verdicts', () => {
  it('parses READY / BLOCKED stdout', () => {
    const [ready] = parseGateOutput('OK inventory=12 rows\nREADY phase=baseline\n', 5, 'phase_gate.py');
    expect(ready).toMatchObject({ phase: 'baseline', verdict: 'ready', unmet: [], unmetCount: 0, at: 5, source: 'stdout' });
    const [blocked] = parseGateOutput('BLOCKED phase=inventory\n- no rows\n- missing owner\nWARNINGS\n- unrelated');
    expect(blocked).toMatchObject({ verdict: 'blocked', unmet: ['no rows', 'missing owner'], unmetCount: 2 });
  });

  it('never reports a gate as passed when ledgers are INVALID', () => {
    const [result] = parseGateOutput('INVALID\n- bad header in todo.tsv\nREADY phase=baseline');
    expect(result).toMatchObject({ verdict: 'blocked', invalid: true, unmet: ['INVALID: bad header in todo.tsv'] });
  });

  it('parses the STATE.md Last gate line', () => {
    expect(parseLastGateLine('- Last gate: `READY baseline` @ 2026-10-08T16:54:51+08:00 via validate_ledgers.py')).toMatchObject({
      phase: 'baseline', verdict: 'ready', tool: 'validate_ledgers.py', at: Date.parse('2026-10-08T16:54:51+08:00'), source: 'state',
    });
    expect(parseLastGateLine('- Last gate: `BLOCKED inventory` @ 2026-10-08T17:00:00+08:00 via phase_gate.py (3 unmet: no rows)'))
      .toMatchObject({ verdict: 'blocked', unmetCount: 3, unmet: ['no rows'] });
    expect(parseLastGateLine(template('STATE.md'))).toBeUndefined();
    expect(parseStateMd('## Gate\n- Last gate: `READY pilot` @ 2026-10-08T10:00:00Z via phase_gate.py').gate.lastGate?.phase)
      .toBe('pilot');
  });

  it('moves the current phase past a READY gate', () => {
    const ready = { phase: 'baseline' as const, verdict: 'ready' as const, unmet: [], unmetCount: 0, source: 'stdout' as const };
    expect(effectiveCurrentPhase('baseline', { baseline: ready })).toBe('inventory');
    expect(effectiveCurrentPhase(undefined, { baseline: ready })).toBe('inventory');
    expect(effectiveCurrentPhase('pilot', { baseline: ready })).toBe('pilot');
    expect(effectiveCurrentPhase('handoff', { handoff: { ...ready, phase: 'handoff' } })).toBe('handoff');
  });

  it('prefers a newer STATE.md verdict over older stdout', () => {
    const stdout = { phase: 'baseline' as const, verdict: 'blocked' as const, unmet: ['x'], unmetCount: 1, at: 1_000, source: 'stdout' as const };
    const merged = collectGates(input({
      state: '## Gate\n- Last gate: `READY baseline` @ 2026-10-08T10:00:00Z via phase_gate.py',
      extra: { gates: { baseline: stdout } },
    }));
    expect(merged.baseline?.verdict).toBe('ready');
  });

  it('marks gated phases done and advances the snapshot', () => {
    const snapshot = deriveSnapshot(input({
      state: '## Gate\n- Current phase: `baseline`\n',
      extra: {
        gates: { baseline: { phase: 'baseline', verdict: 'ready', unmet: [], unmetCount: 0, at: 900_000, source: 'stdout' } },
      },
    }));
    const baseline = snapshot.phases.find((phase) => phase.id === 'baseline')!;
    expect(baseline).toMatchObject({ status: 'done', statusSource: 'gate' });
    expect(snapshot.header.currentPhase).toBe('inventory');
  });
});

describe('live status', () => {
  it('is active while the migration session runs', () => {
    expect(deriveSnapshot(input({ extra: { sessionRunning: true } })).header.liveStatus).toBe('active');
  });

  it('counts skipped items as done', () => {
    expect(normalizeStatus('skipped')).toBe('done');
  });
});

describe('finished and paused migrations', () => {
  const header = (file: string) => LEDGER_TSV_HEADERS[file].join('\t');
  const row = (file: string, values: Record<string, string>) =>
    LEDGER_TSV_HEADERS[file].map((column) => values[column] ?? '').join('\t');
  const queue = [
    header('work-queue.tsv'),
    row('work-queue.tsv', { id: 'CAP-001', capability: 'build', status: 'passed' }),
    row('work-queue.tsv', { id: 'CAP-002', capability: 'run', status: 'not-applicable' }),
  ].join('\n');
  const validation = [
    header('validation.tsv'),
    row('validation.tsv', { id: 'VAL-001', scenario: 'launch', platform: 'device', status: 'passed', evidence: 'run-1' }),
  ].join('\n');
  const state = (tier: string) => [
    '## Gate',
    '- Current phase: `handoff`',
    '- Last gate: `BLOCKED handoff` @ 2026-10-09T10:46:34+08:00 via validate_ledgers.py (1 unmet: work-queue.tsv has no executable capability row)',
    `- Completion tier: \`${tier}\``,
    '',
    '## Progress',
    '| Phase | Status | Evidence / next action |',
    '|---|---|---|',
    '| Baseline and KB snapshot | passed | TODO |',
    '| Compatibility inventory | passed | TODO |',
    '| Porting contract | passed | TODO |',
    '| Risk pilot | passed | TODO |',
    '| Capability queue | in-progress | TODO |',
    '| Diagnostic loop | planned | TODO |',
    '| Verification and handoff | planned | TODO |',
  ].join('\n');

  it('closes a past phase whose ledger rows are all done', () => {
    const snapshot = deriveSnapshot(input({ state: state('implemented-unverified'), tsv: { 'work-queue.tsv': queue } }));
    const implementation = snapshot.phases.find((phase) => phase.id === 'implementation')!;
    expect(implementation).toMatchObject({ status: 'done', statusSource: 'ledger', rawStatus: 'in-progress' });
  });

  it('does not spin the current phase when no agent is working', () => {
    const idle = deriveSnapshot(input({ state: state('implemented-unverified') }));
    expect(idle.phases.find((phase) => phase.id === 'handoff')).toMatchObject({ status: 'pending' });
    const running = deriveSnapshot(input({ state: state('implemented-unverified'), extra: { sessionRunning: true } }));
    // STATE points at handoff but implementation is still open, so that is the phase being worked on.
    expect(running.header.currentPhase).toBe('implementation');
    expect(running.phases.find((phase) => phase.id === 'implementation')).toMatchObject({ status: 'doing' });
    expect(running.phases.find((phase) => phase.id === 'implementation')!.paused).toBeUndefined();
    expect(running.phases.find((phase) => phase.id === 'handoff')).toMatchObject({ status: 'pending' });
    // No queue rows: STATE's `in-progress` stands, but nobody is working on it.
    const pausedDoing = idle.phases.find((phase) => phase.id === 'implementation')!;
    expect(pausedDoing).toMatchObject({ status: 'doing', paused: true });
  });

  it('does not let a hand-edited Current phase skip open phases', () => {
    const skipped = [
      '## Gate',
      '- Current phase: `implementation`',
      '',
      '## Progress',
      '| Phase | Status | Evidence / next action |',
      '|---|---|---|',
      '| Baseline and KB snapshot | passed | TODO |',
      '| Compatibility inventory | planned | TODO |',
      '| Porting contract | planned | TODO |',
      '| Risk pilot | planned | TODO |',
      '| Capability queue | planned | TODO |',
    ].join('\n');
    const snapshot = deriveSnapshot(input({ state: skipped, extra: { sessionRunning: true } }));
    expect(snapshot.header.currentPhase).toBe('inventory');
    expect(snapshot.phases.find((phase) => phase.id === 'inventory')).toMatchObject({ status: 'doing' });
    expect(snapshot.phases.find((phase) => phase.id === 'implementation')).toMatchObject({ status: 'pending' });
  });

  it('treats a later READY gate as passing the earlier phases', () => {
    const snapshot = deriveSnapshot(input({
      state: '## Gate\n- Current phase: `pilot`\n',
      extra: {
        gates: { contract: { phase: 'contract', verdict: 'ready', unmet: [], unmetCount: 0, at: 900_000, source: 'stdout' } },
      },
    }));
    for (const id of ['baseline', 'inventory', 'contract'] as const) {
      expect(snapshot.phases.find((phase) => phase.id === id)).toMatchObject({ status: 'done', statusSource: 'gate' });
    }
    expect(snapshot.header.currentPhase).toBe('pilot');
  });

  it('reports a finished migration even if the handoff gate is blocked', () => {
    const snapshot = deriveSnapshot(input({
      state: state('behavior-verified'),
      tsv: { 'work-queue.tsv': queue, 'validation.tsv': validation },
    }));
    expect(snapshot.header.liveStatus).toBe('completed');
    expect(snapshot.header.completedGateBlocked).toMatchObject({ phase: 'handoff', unmetCount: 1 });
    expect(snapshot.phases.every((phase) => phase.status === 'done')).toBe(true);
    expect(snapshot.phases.some((phase) => phase.paused)).toBe(false);
  });

  it('is not completed while the agent is still running', () => {
    const snapshot = deriveSnapshot(input({
      state: state('behavior-verified'),
      tsv: { 'work-queue.tsv': queue, 'validation.tsv': validation },
      extra: { sessionRunning: true },
    }));
    expect(snapshot.header.liveStatus).toBe('active');
  });
});

describe('migration session memory', () => {
  it('treats skill, script and ledger-path calls as evidence, plain calls not', () => {
    const evidence = (tool: string, input: unknown) => {
      const classified = classifyMigrationToolEvent(tool, input);
      return !!classified && isMigrationEvidence(classified);
    };
    expect(evidence('Skill', { command: 'qt-harmonyos-migration' })).toBe(true);
    expect(evidence('ExecCommand', { command: 'python D:/s/scripts/batch_checks.py plan.tsv' })).toBe(true);
    expect(evidence('Edit', { file_path: 'D:/app/migration/ohos/work-queue.tsv' })).toBe(true);
    expect(evidence('ExecCommand', { command: 'hvigorw assembleHap' })).toBe(false);
    expect(evidence('Read', { file_path: 'D:/app/src/main.cpp' })).toBe(false);
  });

  it('remembers sessions across app restarts through localStorage', () => {
    const saved: Record<string, string> = {};
    const target = globalThis as { localStorage?: unknown };
    const previous = target.localStorage;
    target.localStorage = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => { saved[key] = value; },
    };
    try {
      expect(isMigrationSession('restored-session')).toBe(false);
      rememberMigrationSession('restored-session');
      expect(isMigrationSession('restored-session')).toBe(true);
      expect(JSON.parse(saved['bitfun:qt-ohos-migration:sessions:v1'])).toContain('restored-session');
    } finally {
      target.localStorage = previous;
    }
  });
});

describe('external features', () => {
  const header = (file: string) => LEDGER_TSV_HEADERS[file].join('\t');
  const row = (file: string, values: Record<string, string>) =>
    LEDGER_TSV_HEADERS[file].map((column) => values[column] ?? '').join('\t');
  const MILESTONES = ['信号采集（三查）', '特性匹配与用户确认', '按卡片集成', '真机验证'];
  const PACKAGE = {
    featureId: 'harmonyos-feature-integration',
    path: '/skill/features/harmonyos-feature-integration',
    title: '鸿蒙原生特性集成',
    kind: 'capability',
    version: '0.1.0',
    hookPhase: 'features',
    milestones: MILESTONES,
    maxAttempts: 3,
    playbookPath: '/skill/features/harmonyos-feature-integration/feature.md',
  };

  it('parses gate cells', () => {
    expect(parseFeatureGate('READY @2026-10-13T08:00:00Z restart')).toMatchObject({ verdict: 'ready', restart: true });
    expect(parseFeatureGate('READY @2026-10-13T08:00:00Z digest=abc')).toMatchObject({ verdict: 'ready', restart: undefined });
    expect(parseFeatureGate('BLOCKED @2026-10-13T08:00:00Z (2 unmet: artifact integration-report.md missing)'))
      .toMatchObject({ verdict: 'blocked', unmetCount: 2, firstUnmet: 'artifact integration-report.md missing' });
    expect(parseFeatureGate('CLOSED deferred-approved by DEC-007 @2026-10-13T08:00:00Z'))
      .toMatchObject({ verdict: 'closed', closedStatus: 'deferred-approved', closedBy: 'DEC-007' });
    expect(parseFeatureGate('')).toBeUndefined();
    expect(parseFeatureGate('TODO')).toBeUndefined();
  });

  it('matches free-text steps to milestones', () => {
    expect(matchMilestone(MILESTONES, '按卡片集成')).toBe(2);
    expect(matchMilestone(MILESTONES, '3/4 按卡片集成：深色模式')).toBe(2);
    expect(matchMilestone(MILESTONES, '2')).toBe(1);
    expect(matchMilestone(MILESTONES, '真机')).toBe(3);
    expect(matchMilestone(MILESTONES, '整理报告')).toBe(-1);
    expect(matchMilestone([], '按卡片集成')).toBe(-1);
  });

  it('reads hook.json display fields and registry rows', () => {
    const hook = parseFeatureHook(JSON.stringify({
      schema: 'qt-ohos-feature/1', feature_id: 'x', title: 'X', kind: 'capability', version: '1.0',
      hook: { phase: 'handoff' }, playbook: 'feature.md', milestones: ['a', '', 'b'], exit: { max_attempts: 5 },
    }), '/skill/features/x');
    expect(hook).toMatchObject({ featureId: 'x', title: 'X', hookPhase: 'handoff', milestones: ['a', 'b'], maxAttempts: 5 });
    expect(hook.playbookPath).toBe('/skill/features/x/feature.md');
    expect(parseFeatureHook('{not json', '/x')).toEqual({});
    const registry = parseFeatureRegistry('feature_id\ttitle\tkind\thook_phase\tstatus\tpackage_path\towner\tsummary\nx\tX\tcapability\tfeatures\tstable\tx\tteam\tdoes x\n');
    expect(registry.get('x')).toMatchObject({ package_path: 'x', summary: 'does x' });
  });

  it('builds a generic view of an in-progress feature', () => {
    const ledgers = input({
      tsv: {
        'feature-adoption.tsv': [
          header('feature-adoption.tsv'),
          row('feature-adoption.tsv', {
            id: 'FEAT-001', feature_id: 'harmonyos-feature-integration', kind: 'capability', host_phase: 'features',
            package_path: 'harmonyos-feature-integration', decision_id: 'DEC-010', status: 'in-progress', attempts: '1',
            current_step: '3/4 按卡片集成：深色模式', entry_gate: 'READY @2026-10-13T08:00:00Z',
            exit_gate: 'BLOCKED @2026-10-13T09:00:00Z (1 unmet: artifact missing)', validation_ids: 'VAL-001',
          }),
        ].join('\n'),
        'validation.tsv': [header('validation.tsv'), row('validation.tsv', { id: 'VAL-001', status: 'passed' })].join('\n'),
      },
      extra: {
        featurePackages: { 'harmonyos-feature-integration': PACKAGE },
        featureWorkdirs: { 'FEAT-001': { path: `${ROOT}/features/FEAT-001`, files: [{ name: 'exit-1.log', path: `${ROOT}/features/FEAT-001/exit-1.log` }] } },
      },
    });
    const [feature] = buildExternalFeatures(ledgers, true);
    expect(feature).toMatchObject({
      id: 'FEAT-001', title: '鸿蒙原生特性集成', status: 'doing', running: true, attempts: 1, maxAttempts: 3,
      hostPhase: 'features', stepMatched: true, decisionId: 'DEC-010', packageResolved: true, legacy: false,
    });
    expect(feature.milestones.map((entry) => entry.state)).toEqual(['done', 'done', 'current', 'pending']);
    expect(feature.entryGate?.verdict).toBe('ready');
    expect(feature.exitGate).toMatchObject({ verdict: 'blocked', unmetCount: 1 });
    expect(feature.links).toEqual([{ id: 'VAL-001', ledger: 'validation.tsv', status: 'done', rawStatus: 'passed' }]);
    expect(feature.files.map((file) => file.name)).toEqual(['exit-1.log']);
    expect(buildExternalFeatures(ledgers, false)[0].running).toBe(false);

    const snapshot = deriveSnapshot(ledgers);
    expect(snapshot.externalFeatures).toHaveLength(1);
    expect(snapshot.phases.find((phase) => phase.id === 'features')!.items.map((entry) => entry.label))
      .toEqual(['鸿蒙原生特性集成']);
  });

  it('renders features without a readable package and routes handoff hooks', () => {
    const ledgers = input({
      tsv: {
        'feature-adoption.tsv': [
          header('feature-adoption.tsv'),
          row('feature-adoption.tsv', { id: 'FEAT-001', feature_id: 'unknown-pack', host_phase: 'handoff', status: 'passed', capability_ids: 'WQ-9' }),
          row('feature-adoption.tsv', { id: 'FEAT-BOOT-001', feature_id: 'TODO', status: 'planned' }),
        ].join('\n'),
      },
    });
    const features = buildExternalFeatures(ledgers, false);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ title: 'unknown-pack', status: 'done', packageResolved: false, maxAttempts: undefined, milestones: [] });
    expect(features[0].links).toEqual([{ id: 'WQ-9', status: 'pending', rawStatus: '' }]);
    const snapshot = deriveSnapshot(ledgers);
    const phase = (id: string) => snapshot.phases.find((entry) => entry.id === id)!;
    expect(phase('features').items).toEqual([]);
    expect(phase('handoff').items.map((entry) => entry.id)).toContain('FEAT-001');
  });

  it('accepts ledgers with the legacy feature-adoption header', () => {
    const legacy = [
      'id\tfeature_id\tplaybook_path\tplaybook_sha256\tstatus\tcapability_ids\tvalidation_ids\tdecision_id\tnotes\tevidence',
      'FEAT-001\tshare\tfeatures/share.md\t\tverified\t\t\tDEC-1\t\tok',
    ].join('\n');
    const ledgers = input({ tsv: { 'feature-adoption.tsv': legacy } });
    const snapshot = deriveSnapshot(ledgers);
    expect(snapshot.schemaWarnings).toEqual([]);
    expect(snapshot.externalFeatures[0]).toMatchObject({ id: 'FEAT-001', legacy: true, status: 'done', hostPhase: 'features' });
  });

  it('shows the external-feature selection decision and flags unanswered questions', () => {
    const header = 'id\tphase\tquestion\toptions\tselected\timpact\towner\tapproved_at\tfeature_or_scope\taffected_ids\tstatus\tevidence';
    const decisions = (selected: string, evidence: string) => [
      header,
      `DEC-001\tcontract\tExternal features\tenable / none\t${selected}\tscope\tuser\t2026-10-14\texternal-features\tnone\tapproved\t${evidence}`,
    ].join('\n');
    const timedOut = deriveSnapshot(input({ tsv: { 'decisions.tsv': decisions('none',
      'user: AskUserQuestion for x timed out with no response (skip-and-continue), skill default is none') } }));
    expect(timedOut.featureSelection).toMatchObject({ decisionId: 'DEC-001', selected: [], confirmed: false, unanswered: true });
    const none = deriveSnapshot(input({ tsv: { 'decisions.tsv': decisions('none', 'user: 不需要鸿蒙特性') } }));
    expect(none.featureSelection).toMatchObject({ selected: [], confirmed: true, unanswered: false });
    const chosen = deriveSnapshot(input({ tsv: { 'decisions.tsv': decisions('cap-a ver-a', 'user: 选这些') } }));
    expect(chosen.featureSelection?.selected).toEqual(['cap-a', 'ver-a']);
    expect(deriveSnapshot(input()).featureSelection).toBeUndefined();
  });

  it('finds the feature-package root from skill commands', () => {
    expect(extractFeaturesRootHints('python C:/s/qt-harmonyos-migration/scripts/feature_gate.py exit D:/app FEAT-001'))
      .toEqual(['C:/s/qt-harmonyos-migration/features']);
    expect(extractFeaturesRootHints('python scripts/feature_hooks.py --features-root /tmp/f activate D:/app'))
      .toEqual(['/tmp/f']);
    expect(extractFeaturesRootHints('python x.py --features-root=/tmp/g')).toEqual(['/tmp/g']);
    expect(featuresRootFromHint('features', '/skill')).toBe('/skill/features');
    expect(featuresRootFromHint('/abs/features/', undefined)).toBe('/abs/features');
    expect(classifyMigrationToolEvent('Bash', { command: 'python /s/scripts/feature_hooks.py status D:/app' }))
      .toMatchObject({ script: 'feature_hooks.py', ledgerWrite: false, featuresRootHints: ['/s/features'] });
    expect(classifyMigrationToolEvent('Bash', { command: 'python /s/scripts/feature_hooks.py progress D:/app FEAT-001 --step x' }))
      .toMatchObject({ script: 'feature_hooks.py', ledgerWrite: true });
  });
});
