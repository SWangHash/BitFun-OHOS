import { beforeEach, describe, expect, it, vi } from 'vitest';
import girlManifest from '../../../../public/agent-companion-pets/openbitfun-girl/pet.json';

const invoke = vi.fn();

vi.mock('@/infrastructure/api/service-api/ApiClient', () => ({
  api: { invoke },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
}));

vi.mock('@/infrastructure/runtime', () => ({
  isTauriRuntime: () => false,
}));

describe('AgentCompanionPetService built-in presets', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('defaults to the blue-golden cat while retaining the previous OpenBitFun preset', async () => {
    const { DEFAULT_AGENT_COMPANION_PET, listAgentCompanionPets } = await import('./AgentCompanionPetService');

    const pets = await listAgentCompanionPets();
    const blueGolden = pets.find(pet => pet.id === 'blue-golden');
    const openbitfun = pets.find(pet => pet.id === 'openbitfun');

    expect(DEFAULT_AGENT_COMPANION_PET).toMatchObject({
      id: 'blue-golden',
      displayName: '困困',
      source: 'preset',
      packagePath: '/agent-companion-pets/blue-golden',
      spritesheetPath: '/agent-companion-pets/blue-golden/spritesheet.png',
      spritesheetMimeType: 'image/png',
    });
    expect(blueGolden).toMatchObject({
      ...DEFAULT_AGENT_COMPANION_PET,
      previewSrc: '/agent-companion-pets/blue-golden/spritesheet.png',
    });
    expect(pets[0]).toMatchObject(DEFAULT_AGENT_COMPANION_PET);
    expect(openbitfun).toMatchObject({
      displayName: 'OpenBitFun',
      packagePath: '/agent-companion-pets/openbitfun',
      spritesheetPath: '/agent-companion-pets/openbitfun/spritesheet.webp',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('lists Fangling second and resolves its packaged v2 layout without host access', async () => {
    const { listAgentCompanionPets, resolveAgentCompanionPet } = await import('./AgentCompanionPetService');
    const pets = await listAgentCompanionPets();
    const girl = pets[1];

    expect(pets.slice(0, 3).map(pet => pet.id)).toEqual([
      'blue-golden', 'openbitfun-girl', 'deepseek-goldwhale',
    ]);
    expect(girl).toMatchObject({
      ...girlManifest,
      source: 'preset',
      spritesheetPath: `/agent-companion-pets/${girlManifest.id}/${girlManifest.spritesheetPath}`,
      spritesheetMimeType: 'image/webp',
    });
    const resolved = await resolveAgentCompanionPet(girl);
    expect(resolved.src).toBe(girl.spritesheetPath);
    expect(resolved.layout).toMatchObject({ version: 2, columns: 8, rows: 11, supportsLook: true });
    expect(invoke).not.toHaveBeenCalled();
  });
});
