import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, readFile } = vi.hoisted(() => ({ invoke: vi.fn(), readFile: vi.fn() }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke } }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile }));
vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => true }));

import { resolveAgentCompanionPet } from './AgentCompanionPetService';
import type { AgentCompanionPetSelection } from './AIExperienceConfigService';

const legacy: AgentCompanionPetSelection = {
  id: 'sample', displayName: 'Sample', source: 'user', packagePath: '/pets/sample',
  spritesheetPath: '/pets/sample/spritesheet.webp', spritesheetMimeType: 'image/webp',
};

describe('saved pet version recovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    readFile.mockResolvedValue(new Uint8Array([0]));
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:pet'), revokeObjectURL: vi.fn() });
  });

  it('recovers v2 from an already imported package without writing settings', async () => {
    invoke.mockResolvedValue({ pets: [{ ...legacy, spriteVersionNumber: 2 }] });
    const resolved = await resolveAgentCompanionPet(legacy);
    expect(resolved.layout.rows).toBe(11);
    expect(invoke.mock.calls).toEqual([['list_agent_companion_pets']]);
    expect(legacy.spriteVersionNumber).toBeUndefined();
  });

  it('retains legacy manifests returned by an older host', async () => {
    invoke.mockResolvedValue({ pets: [legacy] });
    expect((await resolveAgentCompanionPet(legacy)).layout.rows).toBe(9);
  });

  it('does not require package enumeration for explicit v1 or v2 selections', async () => {
    for (const version of [1, 2]) {
      expect((await resolveAgentCompanionPet({ ...legacy, spriteVersionNumber: version })).layout.version).toBe(version);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('retains an unavailable selection and reports failure instead of guessing v1', async () => {
    invoke.mockResolvedValue({ pets: [] });
    await expect(resolveAgentCompanionPet(legacy)).rejects.toThrow('unavailable');
    invoke.mockRejectedValue(new Error('Host unavailable'));
    await expect(resolveAgentCompanionPet(legacy)).rejects.toThrow('Host unavailable');
    await expect(resolveAgentCompanionPet({ ...legacy, spriteVersionNumber: 3 })).rejects.toThrow('Unsupported');
  });
});
