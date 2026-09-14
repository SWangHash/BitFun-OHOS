import { beforeEach, expect, it, vi } from 'vitest';
import { applyEcosystemBatchUndo, type BatchUndoEntry, type BatchUndoResult } from './ecosystemBatchUndo';

const mocks = vi.hoisted(() => ({ apply: vi.fn(), assert: vi.fn() }));
vi.mock('./ecosystemImportUndo', () => ({ applyImportUndo: mocks.apply }));
vi.mock('@/infrastructure/peer-device/deviceSurface', () => ({ getActiveSurfaceScope: () => ({ surfaceId: 'local', assertCurrent: mocks.assert }), isLocalSurface: () => true }));
beforeEach(() => vi.resetAllMocks());

it('removes multiple MCP copies in one CAS without restoring earlier removals or touching other settings', async () => {
  const config = { mcpServers: { first: {}, second: {}, keep: { env: { KEEP: 'value' } } }, other: true };
  const entries: BatchUndoEntry[] = ['first', 'second'].map((id) => {
    const copy = structuredClone(config);
    delete copy.mcpServers[id as 'first' | 'second'];
    return { id, name: id, review: { kind: 'mcp', target: id, jsonConfig: JSON.stringify(copy), fingerprint: 'reviewed' } };
  });
  mocks.apply.mockResolvedValue({ runtimeApplied: true });
  const results: BatchUndoResult[] = [];
  await applyEcosystemBatchUndo(entries, '/workspace', (result) => results.push(result));
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.apply.mock.calls[0][0].jsonConfig)).toEqual({ mcpServers: { keep: { env: { KEEP: 'value' } } }, other: true });
  expect(mocks.apply.mock.calls[0][0].fingerprint).toBe('reviewed');
  expect(results.map((result) => result.status)).toEqual(['removed', 'removed']);
});

it('rejects mixed MCP review revisions without mutating either copy', async () => {
  const entries: BatchUndoEntry[] = ['one', 'two'].map((id) => ({ id, name: id, review: { kind: 'mcp', target: id, fingerprint: id, jsonConfig: '{"mcpServers":{}}' } }));
  const results: BatchUndoResult[] = [];
  await applyEcosystemBatchUndo(entries, undefined, (result) => results.push(result));
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(results.every((result) => result.status === 'failed')).toBe(true);
});

it('advances Hook revisions only after its own success, preserving failures and continuing independent copies', async () => {
  const entries: BatchUndoEntry[] = ['one', 'two', 'three'].map((id) => ({ id, name: id, review: { kind: 'hook', target: id, revision: 'r1', importId: id } }));
  mocks.apply.mockResolvedValueOnce({ runtimeApplied: true, revision: 'r2' }).mockRejectedValueOnce(new Error('concurrent edit')).mockResolvedValueOnce({ runtimeApplied: true, revision: 'r3' });
  const results: BatchUndoResult[] = [];
  await applyEcosystemBatchUndo(entries, undefined, (result) => results.push(result));
  expect(mocks.apply.mock.calls.map(([review]) => review.revision)).toEqual(['r1', 'r2', 'r2']);
  expect(results.map((result) => result.status)).toEqual(['removed', 'failed', 'removed']);
  expect(results[1].error).toBe('concurrent edit');
});

it('never starts another removal after switching hosts', async () => {
  const entries: BatchUndoEntry[] = ['one', 'two'].map((id) => ({ id, name: id, review: { kind: 'hook', target: id, revision: 'r1', importId: id } }));
  mocks.apply.mockImplementationOnce(async () => { mocks.assert.mockImplementation(() => { throw new Error('host changed'); }); return { runtimeApplied: true }; });
  await applyEcosystemBatchUndo(entries, undefined, () => {});
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});
