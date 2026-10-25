import { ConfigPageSectionStack } from '@/infrastructure/config/components/common';
import WorktreeSettingsPage from '@/infrastructure/config/components/WorktreeSettingsPage';
import { WorkspaceSearchSettingsSection } from '@/infrastructure/config/components/RuntimeSettingsPages';
import { SettingsPage } from '../shared/SettingsPage';
import { useSettingsSectionAnchor } from '../shared/useSettingsSectionAnchor';

export default function WorkspaceGitSettingsPage() {
  const searchAnchor = useSettingsSectionAnchor('workspace-search');
  const worktreesAnchor = useSettingsSectionAnchor('worktrees');

  return (
    <SettingsPage pageId="development.workspace">
      <ConfigPageSectionStack id={searchAnchor}>
        <WorkspaceSearchSettingsSection />
      </ConfigPageSectionStack>
      <ConfigPageSectionStack id={worktreesAnchor}>
        <WorktreeSettingsPage embedded />
      </ConfigPageSectionStack>
    </SettingsPage>
  );
}
