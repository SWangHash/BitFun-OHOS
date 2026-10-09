import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({ api: { invoke } }));
vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => true }));

import { resolveAgentCompanionPet } from './AgentCompanionPetService';
import type { AgentCompanionPetSelection } from './AIExperienceConfigService';

const legacy: AgentCompanionPetSelection = {
  id: 'sample', displayName: 'Sample', source: 'user', packagePath: '/pets/sample',
  spritesheetPath: '/pets/sample/spritesheet.webp', spritesheetMimeType: 'image/webp',
};

/** Spritesheet bytes come from the host file service; only package enumeration is mocked per test. */
function mockHost(listResponse: unknown) {
  invoke.mockImplementation(async (command: string) =>
    command === 'read_file_binary' ? new Uint8Array([0]) : listResponse);
}

const hostCommands = () => invoke.mock.calls.map(([command]) => command);

describe('saved pet version recovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:pet'), revokeObjectURL: vi.fn() });
  });

  it('recovers v2 from an already imported package without writing settings', async () => {
    mockHost({ pets: [{ ...legacy, spriteVersionNumber: 2 }] });
    const resolved = await resolveAgentCompanionPet(legacy);
    expect(resolved.layout.rows).toBe(11);
    // The spritesheet read may be served from the blob cache; nothing else may reach the host.
    expect(hostCommands().filter(command => command !== 'read_file_binary'))
      .toEqual(['list_agent_companion_pets']);
    expect(legacy.spriteVersionNumber).toBeUndefined();
  });

  it('retains legacy manifests returned by an older host', async () => {
    mockHost({ pets: [legacy] });
    expect((await resolveAgentCompanionPet(legacy)).layout.rows).toBe(9);
  });

  it('does not require package enumeration for explicit v1 or v2 selections', async () => {
    mockHost({ pets: [] });
    for (const version of [1, 2]) {
      expect((await resolveAgentCompanionPet({ ...legacy, spriteVersionNumber: version })).layout.version).toBe(version);
    }
    expect(hostCommands()).not.toContain('list_agent_companion_pets');
  });

  it('retains an unavailable selection and reports failure instead of guessing v1', async () => {
    invoke.mockResolvedValue({ pets: [] });
    await expect(resolveAgentCompanionPet(legacy)).rejects.toThrow('unavailable');
    invoke.mockRejectedValue(new Error('Host unavailable'));
    await expect(resolveAgentCompanionPet(legacy)).rejects.toThrow('Host unavailable');
    await expect(resolveAgentCompanionPet({ ...legacy, spriteVersionNumber: 3 })).rejects.toThrow('Unsupported');
  });
});
