import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { LEDGER_TSV_FILES, LEDGER_TSV_HEADERS, ledgerRowStatus, normalizeStatus, phaseIdFromLabel } from './model/ledgerSchema';
import type { LedgerDocument, MigrationLedgerInput, ParsedTsv } from './model/types';
import { parseTsv } from './parsers/parseTsv';
import { parseGateCell, parseStateMd } from './parsers/parseStateMd';
import { deriveSnapshot, getAppRoot } from './services/deriveSnapshot';
import {
  classifyMigrationToolEvent,
  extractFeaturesRootHints,
  extractPathHints,
  extractToolResult,
  isMigrationEvidence,
  isMigrationSession,
  rememberMigrationSession,
} from './services/migrationToolSignals';
import { boundOutputContainer, featuresRootFromHint } from './services/MigrationProgressService';
import { buildExternalFeatures, featureAnswers, matchMilestone, parseFeatureGate } from './services/deriveExternalFeatures';
import { parseFeatureHook, parseFeatureRegistry } from './services/featurePackages';

// Copy of the built-in skill's `assets/templates/migration/ohos/`. The copy keeps
// this test self-contained; refresh it when the templates change (the test below
// compares them with the built-in skill in builtin_skills/ohos-qt-skills/).
const TEMPLATE_DIR = fileURLToPath(new URL('./__fixtures__/ledger-templates/', import.meta.url));
const SKILL_TEMPLATE_DIR = fileURLToPath(new URL(
  '../../../../crates/assembly/core/builtin_skills/ohos-qt-skills/assets/templates/migration/ohos/', import.meta.url));

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
      expect(parsed.header, file).toEqual([...LEDGER_TSV_HEADERS[file]]);
    }
  });

  it.runIf(existsSync(SKILL_TEMPLATE_DIR))('keeps the fixtures equal to the built-in skill templates', () => {
    for (const file of [...LEDGER_TSV_FILES.filter((name) => name !== 'knowledge-manifest.tsv'), 'STATE.md']) {
      expect(template(file), file).toBe(readFileSync(`${SKILL_TEMPLATE_DIR}${file}`, 'utf8'));
    }
  });
});

describe('parseStateMd', () => {
  it('drops TODO placeholders from the template gate', () => {
    const state = parseStateMd(template('STATE.md'));
    expect(state.gate).toEqual({});
    expect(state.scope).toEqual({});
    expect(state.progress).toHaveLength(7);
    expect(state.progress.map((row) => row.phaseId)).toEqual([
      'environment', 'inventory', 'decisions', 'tasks', 'diagnostics', 'features', 'validation',
    ]);
  });

  it('reads filled gate fields', () => {
    const state = parseStateMd([
      '## Gate',
      '- Assessment: `ready` (`ready` / `blocked`)',
      '- Current phase: `tasks`',
      '- Completion tier: `implemented-unverified`',
      '- Next executable action: run first app build',
    ].join('\n'));
    expect(state.gate).toEqual({
      assessment: 'ready',
      currentPhase: 'tasks',
      completionTier: 'implemented-unverified',
      nextExecutableAction: 'run first app build',
    });
  });

  it('reads the Scope table', () => {
    const state = parseStateMd([
      '## Scope and target',
      '',
      '| Field | Value | Evidence |',
      '|---|---|---|',
      '| Application target | `Notepad--` | TARGET in src/RealCompare.pro |',
      '| Qt source root | D:/code/notepad-- | init_migration.py --target |',
      '| HarmonyOS output project | D:/code/notepad--_ohos/Notepad---ohos | decisions |',
      '| Source revision at start | 91105f6 (clean) | init_migration.py |',
    ].join('\n'));
    expect(state.scope).toEqual({
      target: 'Notepad--',
      source: 'D:/code/notepad--',
      outputProject: 'D:/code/notepad--_ohos/Notepad---ohos',
      revision: '91105f6 (clean)',
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

  it('maps row statuses per ledger', () => {
    expect(ledgerRowStatus('environment.tsv', { status: 'fixed' })).toBe('done');
    expect(ledgerRowStatus('environment.tsv', { status: 'missing' })).toBe('error');
    expect(ledgerRowStatus('diagnostics.tsv', { status: 'open' })).toBe('error');
    expect(ledgerRowStatus('diagnostics.tsv', { status: 'fixed' })).toBe('done');
    expect(ledgerRowStatus('diagnostics.tsv', { status: 'blocked' })).toBe('blocked');
    expect(ledgerRowStatus('diagnostics.tsv', { status: 'accepted-limitation' })).toBe('done');
    expect(ledgerRowStatus('decisions.tsv', { answer: '' })).toBe('pending');
    expect(ledgerRowStatus('decisions.tsv', { answer: 'none' })).toBe('done');
    expect(ledgerRowStatus('decisions.tsv', { answer: 'TODO' })).toBe('pending');
    expect(ledgerRowStatus('decisions.tsv', { answer: 'com.example.app' })).toBe('done');
    expect(ledgerRowStatus('device-runs.tsv', { status: 'run' })).toBe('done');
    expect(ledgerRowStatus('device-runs.tsv', { status: 'no-device' })).toBe('done');
    expect(ledgerRowStatus('device-runs.tsv', { status: 'checked' })).toBe('pending');
    expect(ledgerRowStatus('device-runs.tsv', { status: 'hap-failed' })).toBe('error');
    expect(ledgerRowStatus('validation.tsv', { status: 'failed' })).toBe('error');
  });

  it('maps progress labels to phases', () => {
    expect(phaseIdFromLabel('Validation and delivery')).toBe('validation');
    expect(phaseIdFromLabel('TODO')).toBeUndefined();
    expect(phaseIdFromLabel('Implementation (`tasks`, tasks.tsv)')).toBe('tasks');
    expect(phaseIdFromLabel('Features (`features`, features.tsv)')).toBe('features');
    expect(phaseIdFromLabel('Diagnostics (`diagnostics`, diagnostics.tsv)')).toBe('diagnostics');
    expect(phaseIdFromLabel('Environment (`environment`, environment.tsv)')).toBe('environment');
  });
});

const header = (file: string) => LEDGER_TSV_HEADERS[file].join('\t');
const row = (file: string, values: Record<string, string>) =>
  LEDGER_TSV_HEADERS[file].map((column) => values[column] ?? '').join('\t');
const table = (file: string, ...rows: Array<Record<string, string>>) =>
  [header(file), ...rows.map((values) => row(file, values))].join('\n');

describe('deriveSnapshot', () => {
  it('reports 0% for freshly initialized templates', () => {
    const snapshot = deriveSnapshot(templateInput());
    expect(snapshot.appRoot).toBe('/work/app');
    expect(snapshot.header.overallPercent).toBe(0);
    expect(snapshot.header.liveStatus).toBe('idle');
    expect(snapshot.phases.map((phase) => phase.status)).toEqual(Array(7).fill('pending'));
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.schemaWarnings).toEqual([]);
    expect(snapshot.phases.map((phase) => phase.ledger)).toEqual([
      'environment.tsv', 'inventory.tsv', 'decisions.tsv',
      'tasks.tsv', 'diagnostics.tsv', 'features.tsv', 'validation.tsv',
    ]);
    const baseline = snapshot.phases.find((phase) => phase.id === 'environment')!;
    expect(baseline.total).toBe(0);
    expect(baseline.ledgerPath).toBe(`${ROOT}/environment.tsv`);
    // The Scope table is still TODO: fall back to the app folder.
    expect(snapshot.header.project).toBe('app');
    expect(snapshot.header.scope).toEqual({});
    expect(snapshot.documents.map((doc) => doc.label))
      .toEqual(['STATE.md', 'device-runs.tsv']);
  });

  it('takes the phase status from the STATE.md Progress row alone', () => {
    const state = (status: string, gate = '') => [
      '## Gate', '- Current phase: `diagnostics`', '', '## Progress', '| Phase | Status | Gate |', '|---|---|---|',
      `| Diagnostics (\`diagnostics\`, diagnostics.tsv) | ${status} | ${gate} |`,
    ].join('\n');
    const blocked = table('diagnostics.tsv',
      { id: 'DIAG-001', location: 'sign: devecocli', symptom: 'auth expired', cause: 'needs devecocli auth login', status: 'blocked' });
    const phase = (status: string, gate = '') => deriveSnapshot(input({ state: state(status, gate), tsv: { 'diagnostics.tsv': blocked } }))
      .phases.find((entry) => entry.id === 'diagnostics')!.status;
    expect(phase('blocked')).toBe('blocked');
    expect(phase('failed')).toBe('error');
    expect(phase('in-progress')).toBe('doing');
    expect(phase('passed')).toBe('done');
    // Neither a problem nor a READY gate overrides it.
    expect(phase('planned')).toBe('pending');
    expect(phase('planned', 'READY @2026-10-08T10:00:00Z')).toBe('pending');
    // No Progress row: nothing is known about the phase.
    expect(deriveSnapshot(input({ state: state('blocked') })).phases.find((entry) => entry.id === 'validation')!.status).toBe('unknown');
  });

  it('takes the project, output project and source revision from the STATE.md Scope table', () => {
    const state = template('STATE.md')
      .replace('| Application target | TODO | TODO |', '| Application target | Notepad-- | TARGET in src/RealCompare.pro |')
      .replace('| HarmonyOS output project | TODO | TODO |', '| HarmonyOS output project | D:/out/Notepad---ohos | decisions |')
      .replace('| Source revision at start | TODO | TODO |', '| Source revision at start | 91105f6 | init |');
    const snapshot = deriveSnapshot(input({ state }));
    expect(snapshot.header.project).toBe('Notepad--');
    expect(snapshot.header.scope.outputProject).toBe('D:/out/Notepad---ohos');
    expect(snapshot.header.revision).toBe('91105f6');
  });

  it('resolves relative paths against the Qt source root and names a bare ledger after its container', () => {
    const state = template('STATE.md').replace('| Qt source root | TODO | TODO |', '| Qt source root | D:/code/notepad-- | init |');
    const ledgerRoot = 'D:\\code\\notepad--_ohos\\migration\\ohos';
    expect(deriveSnapshot({ ...input({ state }), ledgerRoot }).appRoot).toBe('D:/code/notepad--');
    const bare = deriveSnapshot({ ...input(), ledgerRoot });
    expect(bare.appRoot).toBe('D:\\code\\notepad--_ohos');
    expect(bare.header.project).toBe('notepad--_ohos');
  });

  it('shows one row per environment item: version on the right, the issue as a note; warn/fixed are done', () => {
    const snapshot = deriveSnapshot(input({
      tsv: {
        'environment.tsv': table('environment.tsv',
          { id: 'ENV-001', item: 'qt-sdk', path: '/opt/qt', version: '5.12.12', status: 'ok' },
          { id: 'ENV-002', item: 'device', path: '/sdk/toolchains', status: 'warn', issue: 'no device connected' },
          { id: 'ENV-003', item: 'deveco', status: 'missing', issue: 'DevEco Studio not found' },
          { id: 'ENV-004', item: 'hvigor', version: '6.24.4', status: 'fixed', issue: 'NODE_PATH links the bundled hvigor' },
          { id: 'ENV-005', item: 'host', status: 'warn' }),
      },
    }));
    const baseline = snapshot.phases.find((phase) => phase.id === 'environment')!;
    expect(baseline.items.map((entry) => [entry.label, entry.status, entry.detail, entry.hint, entry.notice])).toEqual([
      ['qt-sdk', 'done', '5.12.12', '/opt/qt', undefined],
      ['device', 'done', undefined, '/sdk/toolchains', { tone: 'warning', text: 'no device connected' }],
      ['deveco', 'error', undefined, undefined, { tone: 'error', text: 'DevEco Studio not found' }],
      ['hvigor', 'done', '6.24.4', undefined, { tone: 'fixed', text: 'NODE_PATH links the bundled hvigor' }],
      ['host', 'done', undefined, undefined, { tone: 'warning', text: 'warn' }],
    ]);
    expect(baseline.done).toBe(4);
  });

  it('counts inventory rows named by a TASK as done (inventory rows have no status of their own)', () => {
    const snapshot = deriveSnapshot(input({
      tsv: {
        'inventory.tsv': table('inventory.tsv',
          { id: 'INV-001', category: 'build-files', location: 'build-file: src/a.pro:3', found_by: 'preflight: PF-A; scan: processes', disposition: 'guarded-adaptation' },
          { id: 'INV-002', category: 'qt-module', location: 'build-file: src/a.pro:8', found_by: 'closure: blocker', disposition: 'packaging-only' },
          { id: 'INV-003', category: 'resources', location: 'resource: a.qrc', found_by: 'scan: runtime-resources', disposition: 'packaging-only' },
          { id: 'INV-004', category: 'third-party', location: 'vendored: lib', found_by: 'closure: deps', disposition: 'needs-decision' }),
        'tasks.tsv': table('tasks.tsv',
          { id: 'TASK-001', task: 'build', inventory_ids: 'INV-001,INV-002', validation_ids: 'VAL-001', status: 'in-progress' },
          { id: 'TASK-002', task: 'libs', inventory_ids: 'INV-004', validation_ids: 'VAL-001', status: 'blocked' }),
      },
    }));
    const inventory = snapshot.phases.find((phase) => phase.id === 'inventory')!;
    expect(inventory.items.map((entry) => [entry.id, entry.status])).toEqual([
      ['INV-001', 'done'],
      ['INV-002', 'done'],
      ['INV-003', 'pending'],
      ['INV-004', 'done'],
    ]);
    expect(inventory.items[0]).toMatchObject({ label: 'build-files · build-file: src/a.pro:3', tags: ['preflight', 'scan'] });
    expect(inventory.done).toBe(3);
  });

  it('derives phases, pending and agent answers, problems and documents', () => {
    const snapshot = deriveSnapshot(input({
      state: '## Gate\n- Current phase: `tasks`\n- Assessment: `ready`\n',
      tsv: {
        'tasks.tsv': table('tasks.tsv',
          { id: 'TASK-001', task: 'widgets', inventory_ids: 'INV-001', validation_ids: 'VAL-001,VAL-002', status: 'passed', evidence: 'ok [last batch impl-1 passed]' },
          { id: 'TASK-002', task: 'network', inventory_ids: 'INV-002', validation_ids: 'VAL-003', status: 'planned' },
          { id: 'TASK-003', task: 'camera', status: 'blocked' }),
        'decisions.tsv': table('decisions.tsv',
          { id: 'DEC-001', question: 'Bundle name?' },
          { id: 'DEC-002', question: 'Signing?', answer: 'CLI self-signing', owner: 'user' },
          { id: 'DEC-003', question: 'Open folder on OHOS?', answer: 'Hide on OHOS (Recommended)', owner: 'agent-default' }),
        'diagnostics.tsv': table('diagnostics.tsv',
          { id: 'DIAG-001', location: 'build: step make', symptom: 'undefined symbol', cause: 'KI-008: orphan Q_OBJECT', reproduce: 'make (cwd src); log: migration/ohos/batches/impl-1/02-make.stdout.log', fix: 'drop Q_OBJECT', status: 'fixed' },
          { id: 'DIAG-002', location: 'device: step device_run', symptom: 'process not running', reproduce: 'device_run.py run (cwd .); log: logs/device', status: 'open' },
          { id: 'DIAG-003', location: 'sign: devecocli', symptom: 'auth expired', cause: 'needs devecocli auth login', status: 'blocked' }),
        // Written by batch_checks.py when its hap_check.py step passed (no device run yet).
        'device-runs.tsv': table('device-runs.tsv',
          { id: 'DEV-RUN-001', hap: 'D:/p/entry-default-signed.hap (com.example.notepad)', status: 'checked', evidence: 'batch batches/app-3: hap_check.py passed; signed' }),
      },
      documents: { 'report.md': { text: '# ok' } },
    }));

    const implementation = snapshot.phases.find((phase) => phase.id === 'tasks')!;
    // No Progress row: the status is unknown, the rows still show their own.
    expect(implementation.status).toBe('unknown');
    expect(implementation.items.map((entry) => [entry.label, entry.status, entry.detail])).toEqual([
      ['widgets', 'done', 'INV ×1 · VAL ×2 · batch impl-1 passed'],
      ['network', 'pending', 'INV ×1 · VAL ×1'],
      ['camera', 'blocked', undefined],
    ]);

    expect(snapshot.decisionsByAgent).toEqual([
      { id: 'DEC-003', question: 'Open folder on OHOS?', answer: 'Hide on OHOS (Recommended)' },
    ]);
    const contract = snapshot.phases.find((phase) => phase.id === 'decisions')!;
    expect(contract.items.map((entry) => [entry.id, entry.status, Boolean(entry.decidedByAgent)])).toEqual([
      ['DEC-001', 'pending', false], ['DEC-002', 'done', false], ['DEC-003', 'done', true],
    ]);

    // Open first, then blocked, then fixed.
    expect(snapshot.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic.status, diagnostic.stage])).toEqual([
      ['DIAG-002', 'error', 'device'], ['DIAG-003', 'blocked', 'sign'], ['DIAG-001', 'done', 'build'],
    ]);
    expect(snapshot.diagnostics[0]).toMatchObject({ open: true, needsCause: true, where: 'step device_run', logPath: undefined });
    expect(snapshot.diagnostics[2]).toMatchObject({
      open: false, needsCause: false, cause: 'KI-008: orphan Q_OBJECT', fix: 'drop Q_OBJECT', reproduce: 'make (cwd src)',
      logPath: '/work/app/migration/ohos/batches/impl-1/02-make.stdout.log',
    });
    const diagnostics = snapshot.phases.find((phase) => phase.id === 'diagnostics')!;
    expect(diagnostics.items).toEqual([]);
    expect(diagnostics.status).toBe('unknown');
    expect(diagnostics.notes).toEqual([
      { kind: 'problems', tone: 'error', values: { open: 1, blocked: 1, fixed: 1 } },
      { kind: 'hapChecked', tone: 'warning' },
    ]);
    expect(snapshot.header.liveStatus).toBe('blocked');

    expect(snapshot.documents.map((doc) => [doc.id, doc.label, doc.target])).toEqual([
      ['doc:report.md', 'report.md', undefined],
      ['ledger:device-runs.tsv', 'device-runs.tsv', undefined],
      ['artifact:hap', 'entry-default-signed.hap', 'D:/p/entry-default-signed.hap'],
    ]);
    expect(snapshot.documents.find((doc) => doc.kind === 'artifact')!.path).toBe('');
  });

  it('shows the application HAP status of device-runs.tsv', () => {
    const noteFor = (status?: string) => {
      const tsv: Record<string, string> = status === undefined ? {} : {
        'device-runs.tsv': table('device-runs.tsv',
          { id: 'DEV-RUN-001', hap: 'D:/p/entry-default-signed.hap (com.x)', status, evidence: 'batch b: hap_check.py' }),
      };
      const snapshot = deriveSnapshot(input({ tsv }));
      return [snapshot.phases.find((phase) => phase.id === 'diagnostics')!.notes![1],
        snapshot.documents.some((doc) => doc.kind === 'artifact')];
    };
    expect(noteFor('run')).toEqual([{ kind: 'deviceRun', tone: 'success' }, true]);
    expect(noteFor('no-device')).toEqual([{ kind: 'noDevice', tone: 'neutral' }, true]);
    expect(noteFor('checked')).toEqual([{ kind: 'hapChecked', tone: 'warning' }, true]);
    expect(noteFor('hap-failed')).toEqual([{ kind: 'hapFailed', tone: 'error' }, false]);
    expect(noteFor()).toEqual([{ kind: 'noHap', tone: 'warning' }, false]);
    const snapshot = deriveSnapshot(input({ tsv: { 'device-runs.tsv': table('device-runs.tsv',
      { id: 'DEV-RUN-001', hap: 'a.hap (com.x)', status: 'run', evidence: 'pid 2 alive after 10s' }) } }));
    expect(snapshot.deviceRun).toEqual({ id: 'DEV-RUN-001', hap: 'a.hap (com.x)', status: 'run', evidence: 'pid 2 alive after 10s' });
  });

  it('lists acceptance scenarios and verification features under handoff', () => {
    const snapshot = deriveSnapshot(input({
      tsv: {
        'validation.tsv': table('validation.tsv',
          { id: 'VAL-001', scenario: 'app .so builds', expected: 'libApp.so', status: 'passed', evidence: 'impl-1 built libApp.so' },
          { id: 'VAL-002', scenario: 'launch on device', expected: 'alive', status: 'failed' },
          { id: 'VAL-003', scenario: 'host regression: desktop build', status: 'planned' }),
      },
    }));
    const handoff = snapshot.phases.find((phase) => phase.id === 'validation')!;
    expect(handoff.items.map((entry) => [entry.id, entry.status, entry.detail])).toEqual([
      ['VAL-001', 'done', 'impl-1 built libApp.so'], ['VAL-002', 'error', 'alive'], ['VAL-003', 'pending', undefined],
    ]);
  });

  it('reports ledgers of an older skill instead of rendering them', () => {
    const snapshot = deriveSnapshot(input({
      tsv: {
        'decisions.tsv': 'id\tphase\tquestion\toptions\tselected\towner\tstatus\nDEC-001\tcontract\tQ\ta|b\ta\tuser\tproposed',
        'diagnostics.tsv': 'id\tstage\tcategory\tstatus\nDIAG-001\tbuild\treceipt\tpassed',
      },
    }));
    expect(snapshot.schemaWarnings).toEqual([
      'decisions.tsv (-answer +phase,options,selected,status)',
      'diagnostics.tsv (-location,symptom,cause,reproduce,fix +stage,category)',
    ]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.phases.find((phase) => phase.id === 'decisions')!.items).toEqual([]);
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
    expect(classifyMigrationToolEvent('Skill', { command: 'ohos-qt-skills' }))
      .toMatchObject({ kind: 'skill', pathHints: [], ledgerWrite: false });
    expect(classifyMigrationToolEvent('Skill', { command: '$ohos-qt-skills' })?.kind).toBe('skill');
    expect(classifyMigrationToolEvent('Skill', { command: 'docx' })?.kind).toBe('activity');
    expect(classifyMigrationToolEvent('Skill', 'not-an-object')).toBeNull();
  });

  it('classifies migration scripts and extracts path hints', () => {
    const signal = classifyMigrationToolEvent('Bash', {
      command: 'python "C:/skills/ohos-qt-skills/scripts/validate_ledgers.py" D:/out/migration/ohos --phase decisions',
    });
    expect(signal).toMatchObject({ kind: 'script', script: 'validate_ledgers.py', pathHints: ['D:/out/migration/ohos'], ledgerWrite: true });
    // `--target` is the Qt source root, never the ledger location (that is the output container's migration/ohos).
    expect(extractPathHints('python batch_checks.py D:/out/migration/ohos --target D:/proj/app')).toEqual(['D:/out/migration/ohos']);
    expect(classifyMigrationToolEvent('ExecCommand', { command: 'python scripts/ledger.py get D:/a/migration/ohos tasks.tsv TASK-001' }))
      .toMatchObject({ kind: 'script', ledgerWrite: false });
    expect(classifyMigrationToolEvent('ExecCommand', { command: 'python scripts/ledger.py list D:/a/migration/ohos tasks.tsv --where status=planned' }))
      .toMatchObject({ kind: 'script', ledgerWrite: false });
    expect(classifyMigrationToolEvent('ExecCommand', { command: 'python scripts/ledger.py state D:/a/migration/ohos' }))
      .toMatchObject({ kind: 'script', ledgerWrite: false });
    expect(classifyMigrationToolEvent('ExecCommand', { command: 'python scripts/ledger.py state D:/a/migration/ohos --set "Next executable action=x"' }))
      .toMatchObject({ kind: 'script', ledgerWrite: true });
    expect(classifyMigrationToolEvent('ExecCommand', { command: 'python scripts/ledger.py add D:/a/migration/ohos inventory.tsv --set a=b' }))
      .toMatchObject({ kind: 'script', ledgerWrite: true });
    expect(classifyMigrationToolEvent('Bash', { command: 'python other.py' })?.kind).toBe('activity');
    expect(classifyMigrationToolEvent('Read', { command: 'phase_gate.py' })?.kind).toBe('activity');
  });

  it('never treats the skill template as a ledger root', () => {
    const template = 'C:/Users/u/AppData/Roaming/bitfun/skills/.system/ohos-qt-skills/assets/templates/migration/ohos';
    expect(extractPathHints(`python init_migration.py --target D:/code/notepad-- --output-project D:/out --template-root ${template}`))
      .toEqual([]);
    expect(extractPathHints(`python init_migration.py --template-root="${template}" --target=D:/app`)).toEqual([]);
    expect(extractPathHints(`ls ${template}/STATE.md`)).toEqual([]);
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
        { content: 'environment', status: 'completed' },
        { content: 'inventory', status: 'in_progress' },
        { content: 'decisions', status: 'pending' },
      ],
    });
    expect(todos?.summary).toBe('inventory');
    expect(todos?.todos).toHaveLength(3);
  });

  it('normalizes tool results', () => {
    expect(extractToolResult({ output: 'READY phase=environment', exit_code: 0 })).toEqual({
      output: 'READY phase=environment', exitCode: 0, error: undefined,
    });
    expect(extractToolResult(undefined, 'text')).toMatchObject({ output: 'text' });
    expect(extractToolResult(undefined, undefined, 'boom')).toMatchObject({ error: 'boom' });
    expect(extractToolResult(undefined)).toBeUndefined();
  });

  it('extracts ledger roots from paths', () => {
    expect(extractPathHints('cat ./app/migration/ohos/STATE.md')).toEqual(['./app/migration/ohos']);
  });

  it('reads the output container a Qt migration question card bound', () => {
    const intake = (state: string, value?: string) => ({
      customMetadata: { qtMigrationIntakeState: { fields: { output_project: { state, value } } } },
    });
    expect(boundOutputContainer(intake('resolved', ' D:/code/notepad--_ohos '))).toBe('D:/code/notepad--_ohos');
    expect(boundOutputContainer(intake('referenced', 'D:/code/out'))).toBeUndefined();
    expect(boundOutputContainer(intake('resolved'))).toBeUndefined();
    expect(boundOutputContainer({ customMetadata: { workspaceSessionNumber: 2 } })).toBeUndefined();
    expect(boundOutputContainer({})).toBeUndefined();
  });
});

describe('gate verdicts', () => {
  it('parses a Progress Gate cell', () => {
    expect(parseGateCell('environment', 'READY @2026-10-08T16:54:51+08:00')).toMatchObject({
      phase: 'environment', verdict: 'ready', unmet: [], unmetCount: 0, at: Date.parse('2026-10-08T16:54:51+08:00'),
    });
    expect(parseGateCell('inventory', 'NOT-READY @2026-10-08T17:00:00+08:00 (3 unmet: no rows)'))
      .toMatchObject({ verdict: 'not-ready', unmetCount: 3, unmet: ['no rows'] });
    expect(parseGateCell('inventory', 'NOT-READY @2026-10-08T17:00:00+08:00 (1 unmet: INVALID: bad header)'))
      .toMatchObject({ verdict: 'not-ready', invalid: true });
    expect(parseGateCell('inventory', '')).toBeUndefined();
  });

  it('shows each phase\'s own Gate cell', () => {
    const snapshot = deriveSnapshot(input({
      state: [
        '## Gate', '- Current phase: `inventory`',
        '- Last gate: `NOT-READY inventory` @ 2026-10-08T17:00:00+08:00 via phase_gate.py (3 unmet: no rows)', '',
        '## Progress', '| Phase | Status | Gate |', '|---|---|---|',
        '| Environment (`environment`, environment.tsv) | passed | READY @2026-10-08T16:00:00+08:00 |',
        '| Inventory (`inventory`, inventory.tsv) | in-progress | NOT-READY @2026-10-08T17:00:00+08:00 (3 unmet: no rows) |',
        '| Decisions (`decisions`, decisions.tsv) | planned |  |',
      ].join('\n'),
    }));
    const phase = (id: string) => snapshot.phases.find((entry) => entry.id === id)!;
    expect(phase('environment').gate).toMatchObject({ verdict: 'ready' });
    expect(phase('inventory').gate).toMatchObject({ verdict: 'not-ready', unmetCount: 3, unmet: ['no rows'] });
    expect(phase('decisions').gate).toBeUndefined();
    // The phase status stays with the Status column.
    expect(phase('inventory').status).toBe('doing');
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
    header('tasks.tsv'),
    row('tasks.tsv', { id: 'TASK-001', task: 'build', status: 'passed' }),
    row('tasks.tsv', { id: 'TASK-002', task: 'run', status: 'not-applicable' }),
  ].join('\n');
  const validation = [
    header('validation.tsv'),
    row('validation.tsv', { id: 'VAL-001', scenario: 'launch', status: 'passed', evidence: 'run-1' }),
  ].join('\n');
  const state = (tier: string, validationGate = 'NOT-READY @2026-10-09T10:46:34+08:00 (1 unmet: tasks.tsv has no executable capability row)') => [
    '## Gate',
    '- Current phase: `validation`',
    `- Completion tier: \`${tier}\``,
    '',
    '## Progress',
    '| Phase | Status | Gate |',
    '|---|---|---|',
    '| Environment | passed |  |',
    '| Inventory | passed |  |',
    '| Decisions | passed |  |',
    '| Tasks | in-progress |  |',
    '| Diagnostics | planned |  |',
    `| Validation | planned | ${validationGate} |`,
  ].join('\n');

  it('keeps the Progress status of a phase whose ledger rows are all done', () => {
    const snapshot = deriveSnapshot(input({ state: state('implemented-unverified'), tsv: { 'tasks.tsv': queue } }));
    const implementation = snapshot.phases.find((phase) => phase.id === 'tasks')!;
    expect(implementation).toMatchObject({ status: 'doing', rawStatus: 'in-progress', done: 2, total: 2 });
  });

  it('does not spin the current phase when no agent is working', () => {
    const idle = deriveSnapshot(input({ state: state('implemented-unverified') }));
    expect(idle.phases.find((phase) => phase.id === 'validation')).toMatchObject({ status: 'pending' });
    const running = deriveSnapshot(input({ state: state('implemented-unverified'), extra: { sessionRunning: true } }));
    // The current phase is what STATE.md says, also when an earlier phase is still open.
    expect(running.header.currentPhase).toBe('validation');
    expect(running.phases.find((phase) => phase.id === 'tasks')).toMatchObject({ status: 'doing' });
    expect(running.phases.find((phase) => phase.id === 'tasks')!.paused).toBeUndefined();
    expect(running.phases.find((phase) => phase.id === 'validation')).toMatchObject({ status: 'pending' });
    // No queue rows: STATE's `in-progress` stands, but nobody is working on it.
    const pausedDoing = idle.phases.find((phase) => phase.id === 'tasks')!;
    expect(pausedDoing).toMatchObject({ status: 'doing', paused: true });
  });

  it('shows a hand-edited Current phase as it is (the next gate moves it back)', () => {
    const skipped = [
      '## Gate',
      '- Current phase: `tasks`',
      '',
      '## Progress',
      '| Phase | Status | Evidence / next action |',
      '|---|---|---|',
      '| Environment | passed | TODO |',
      '| Inventory | planned | TODO |',
      '| Decisions | planned | TODO |',
        '| Tasks | planned | TODO |',
    ].join('\n');
    const snapshot = deriveSnapshot(input({ state: skipped, extra: { sessionRunning: true } }));
    expect(snapshot.header.currentPhase).toBe('tasks');
    expect(snapshot.phases.find((phase) => phase.id === 'inventory')).toMatchObject({ status: 'pending' });
    expect(snapshot.phases.find((phase) => phase.id === 'tasks')).toMatchObject({ status: 'pending' });
  });

  const deviceRun = (status: string) => table('device-runs.tsv',
    { id: 'DEV-RUN-001', hap: 'D:/p/entry-default-signed.hap (com.x)', status, evidence: 'batch b: hap_check.py passed' });

  it('reports a finished migration even if the handoff gate is blocked', () => {
    const snapshot = deriveSnapshot(input({
      state: state('implemented-unverified'),
      tsv: { 'tasks.tsv': queue, 'validation.tsv': validation, 'device-runs.tsv': deviceRun('run') },
    }));
    expect(snapshot.header.liveStatus).toBe('completed');
    expect(snapshot.header.completedGateNotReady).toMatchObject({ phase: 'validation', unmetCount: 1 });
    // The phases keep their Progress status: the validation gate never passed.
    expect(snapshot.phases.find((phase) => phase.id === 'tasks')).toMatchObject({ status: 'doing', paused: true });
    expect(snapshot.phases.find((phase) => phase.id === 'validation')).toMatchObject({ status: 'pending' });
  });

  it('ends without "completed" when the HAP never ran on a device', () => {
    for (const status of ['no-device', 'checked']) {
      const snapshot = deriveSnapshot(input({
        state: state('packaged'),
        tsv: { 'tasks.tsv': queue, 'validation.tsv': validation, 'device-runs.tsv': deviceRun(status) },
      }));
      expect(snapshot.header.liveStatus).toBe('ended');
    }
  });

  it('is not finished before the validation gate ran', () => {
    const notRun = state('packaged', '');
    const snapshot = deriveSnapshot(input({
      state: notRun,
      tsv: { 'tasks.tsv': queue, 'validation.tsv': validation, 'device-runs.tsv': deviceRun('run') },
    }));
    expect(snapshot.header.liveStatus).not.toBe('completed');
    expect(snapshot.header.liveStatus).not.toBe('ended');
  });

  it('is not completed while the agent is still running', () => {
    const snapshot = deriveSnapshot(input({
      state: state('implemented-unverified'),
      tsv: { 'tasks.tsv': queue, 'validation.tsv': validation, 'device-runs.tsv': deviceRun('run') },
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
    expect(evidence('Skill', { command: 'ohos-qt-skills' })).toBe(true);
    expect(evidence('ExecCommand', { command: 'python D:/s/scripts/batch_checks.py plan.tsv' })).toBe(true);
    expect(evidence('Edit', { file_path: 'D:/app/migration/ohos/tasks.tsv' })).toBe(true);
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
    expect(parseFeatureGate('NOT-READY @2026-10-13T08:00:00Z (2 unmet: artifact integration-report.md missing)'))
      .toMatchObject({ verdict: 'not-ready', unmetCount: 2, firstUnmet: 'artifact integration-report.md missing' });
    expect(parseFeatureGate('CLOSED deferred-approved @2026-10-13T08:00:00Z')).toBeUndefined();
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
      hook: { phase: 'validation' }, playbook: 'feature.md', milestones: ['a', '', 'b'], exit: { max_attempts: 5 },
    }), '/skill/features/x');
    expect(hook).toMatchObject({ featureId: 'x', title: 'X', hookPhase: 'validation', milestones: ['a', 'b'], maxAttempts: 5 });
    expect(hook.playbookPath).toBe('/skill/features/x/feature.md');
    expect(parseFeatureHook('{not json', '/x')).toEqual({});
    const registry = parseFeatureRegistry('feature_id\ttitle\tkind\tpackage_path\towner\tsummary\nx\tX\tcapability\tx\tteam\tdoes x\n');
    expect(registry.get('x')).toMatchObject({ package_path: 'x', summary: 'does x' });
  });

  it('builds a generic view of an in-progress feature', () => {
    const ledgers = input({
      tsv: {
        'features.tsv': [
          header('features.tsv'),
          row('features.tsv', {
            id: 'FEAT-001', feature_id: 'harmonyos-feature-integration', kind: 'capability',
            status: 'in-progress', attempts: '1',
            current_step: '3/4 按卡片集成：深色模式', entry_gate: 'READY @2026-10-13T08:00:00Z',
            exit_gate: 'NOT-READY @2026-10-13T09:00:00Z (1 unmet: artifact missing)',
            notes: 'activated @2026-10-13T07:00:00Z: user answer: 接入特性集成',
          }),
        ].join('\n'),
      },
      extra: {
        featurePackages: { 'harmonyos-feature-integration': PACKAGE },
        featureWorkdirs: { 'FEAT-001': { path: `${ROOT}/features/FEAT-001`, files: [{ name: 'exit-1.log', path: `${ROOT}/features/FEAT-001/exit-1.log` }] } },
      },
    });
    const [feature] = buildExternalFeatures(ledgers, true);
    expect(feature).toMatchObject({
      id: 'FEAT-001', title: '鸿蒙原生特性集成', status: 'doing', running: true, attempts: 1, maxAttempts: 3,
      hostPhase: 'features', stepMatched: true, packageResolved: true,
    });
    expect(feature.milestones.map((entry) => entry.state)).toEqual(['done', 'done', 'current', 'pending']);
    expect(feature.entryGate?.verdict).toBe('ready');
    expect(feature.exitGate).toMatchObject({ verdict: 'not-ready', unmetCount: 1 });
    expect(feature.answers).toEqual([{ context: 'activate', text: '接入特性集成' }]);
    expect(feature.files.map((file) => file.name)).toEqual(['exit-1.log']);
    expect(buildExternalFeatures(ledgers, false)[0].running).toBe(false);

    const snapshot = deriveSnapshot(ledgers);
    expect(snapshot.externalFeatures).toHaveLength(1);
    expect(snapshot.phases.find((phase) => phase.id === 'features')!.items.map((entry) => [entry.label, entry.status]))
      .toEqual([['鸿蒙原生特性集成', 'doing']]);
  });

  it('renders features without a readable package and routes handoff hooks', () => {
    const ledgers = input({
      tsv: {
        'features.tsv': [
          header('features.tsv'),
          row('features.tsv', { id: 'FEAT-001', feature_id: 'unknown-pack', kind: 'verification', status: 'passed' }),
          row('features.tsv', { id: 'FEAT-002', feature_id: 'TODO', status: 'planned' }),
        ].join('\n'),
      },
    });
    const features = buildExternalFeatures(ledgers, false);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ title: 'unknown-pack', status: 'done', packageResolved: false, maxAttempts: undefined, milestones: [] });
    expect(features[0].answers).toEqual([]);
    const snapshot = deriveSnapshot(ledgers);
    const phase = (id: string) => snapshot.phases.find((entry) => entry.id === id)!;
    expect(phase('features').items).toEqual([]);
    expect(phase('validation').items.map((entry) => entry.id)).toContain('FEAT-001');
  });

  it('reads the user answers from the feature notes; decisions.tsv stays the decisions phase', () => {
    const ledgers = input({
      tsv: {
        'decisions.tsv': table('decisions.tsv',
          { id: 'DEC-001', question: 'Bundle name?', answer: 'com.example.app', owner: 'user' }),
        'features.tsv': table('features.tsv',
          { id: 'FEAT-001', feature_id: 'cap-a', kind: 'capability', status: 'passed',
            notes: 'activated @2026-10-27T01:00:00Z: user answer: cap-a ver-a; attempts reset @2026-10-27T02:00:00Z: user answer: 再试一次' },
          { id: 'FEAT-002', feature_id: 'ver-a', kind: 'verification', status: 'deferred-approved',
            exit_gate: 'NOT-READY @2026-10-27T03:00:00Z (1 unmet: exit: report.json result is pass)',
            notes: 'activated @2026-10-27T01:00:00Z: user answer: cap-a ver-a; step note; closed deferred-approved: user answer: 下个版本再做' }),
      },
    });
    const snapshot = deriveSnapshot(ledgers);
    const [cap, ver] = snapshot.externalFeatures;
    expect(cap.answers).toEqual([
      { context: 'activate', text: 'cap-a ver-a' },
      { context: 'retry', text: '再试一次' },
    ]);
    expect(ver.answers).toEqual([
      { context: 'activate', text: 'cap-a ver-a' },
      { context: 'close', text: '下个版本再做', status: 'deferred-approved' },
    ]);
    // exit_gate: the reason of the last failed exit attempt (closing does not overwrite it).
    expect(ver.exitGate).toMatchObject({ verdict: 'not-ready', unmetCount: 1 });
    const phase = (id: string) => snapshot.phases.find((entry) => entry.id === id)!;
    expect(phase('decisions').items.map((entry) => entry.id)).toEqual(['DEC-001']);
    expect(phase('features').items.map((entry) => [entry.id, entry.status])).toEqual([['FEAT-001', 'done']]);
    expect(phase('validation').items.map((entry) => entry.id)).toEqual(['FEAT-002']);
    expect(featureAnswers('activated @x: user answer: ')).toEqual([]);
  });

  it('finds the feature-package root from skill commands', () => {
    expect(extractFeaturesRootHints('python C:/s/ohos-qt-skills/scripts/feature_gate.py exit D:/app FEAT-001'))
      .toEqual(['C:/s/ohos-qt-skills/features']);
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
