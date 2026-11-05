import { create } from 'zustand';

export type InstalledFilter = 'all' | 'builtin' | 'user' | 'project' | `source:${string}`;
export type SkillsView = InstalledFilter | 'groups' | 'matrix';
export type SkillTab = 'installed' | 'discover';

interface SkillsSceneState {
  activeTab: SkillTab;
  setActiveTab: (tab: SkillTab) => void;
  nativeNavigationRequest: number;
  nativeNavigationTarget: SkillTab;
  openNativeSkills: (target?: SkillTab) => void;
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
  activeTab: 'installed',
  setActiveTab: activeTab => set({ activeTab }),
  nativeNavigationRequest: 0,
  nativeNavigationTarget: 'installed',
  openNativeSkills: (target = 'installed') => set((state) => ({
    activeTab: target,
    nativeNavigationRequest: state.nativeNavigationRequest + 1,
    nativeNavigationTarget: target,
    installedView: 'all',
    hideDuplicates: false,
    ...(target === 'discover' ? { searchDraft: '', marketQuery: '' } : {}),
  })),
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
