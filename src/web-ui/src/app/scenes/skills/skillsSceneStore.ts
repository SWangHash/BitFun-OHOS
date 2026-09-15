import { create } from 'zustand';

export type InstalledFilter = 'all' | 'builtin' | 'user' | 'project' | `source:${string}`;
export type SkillsView = InstalledFilter | 'groups';

interface SkillsSceneState {
  nativeNavigationRequest: number;
  openNativeSkills: () => void;
  searchDraft: string;
  marketQuery: string;
  installedView: SkillsView;
  hideDuplicates: boolean;
  isAddFormOpen: boolean;
  setSearchDraft: (value: string) => void;
  submitMarketQuery: () => void;
  setInstalledView: (view: SkillsView) => void;
  setHideDuplicates: (hide: boolean) => void;
  setAddFormOpen: (open: boolean) => void;
  toggleAddForm: () => void;
}

export const useSkillsSceneStore = create<SkillsSceneState>((set) => ({
  nativeNavigationRequest: 0,
  openNativeSkills: () => set((state) => ({ nativeNavigationRequest: state.nativeNavigationRequest + 1, installedView: 'all', hideDuplicates: false })),
  searchDraft: '',
  marketQuery: '',
  installedView: 'all',
  hideDuplicates: false,
  isAddFormOpen: false,
  setSearchDraft: (value) => set(
    value.trim() === ''
      ? { searchDraft: value, marketQuery: '' }
      : { searchDraft: value },
  ),
  submitMarketQuery: () => set((state) => ({ marketQuery: state.searchDraft.trim() })),
  setInstalledView: (view) => set({ installedView: view }),
  setHideDuplicates: (hide) => set({ hideDuplicates: hide }),
  setAddFormOpen: (open) => set({ isAddFormOpen: open }),
  toggleAddForm: () => set((state) => ({ isAddFormOpen: !state.isAddFormOpen })),
}));
