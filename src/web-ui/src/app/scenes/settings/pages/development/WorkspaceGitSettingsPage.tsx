import { SettingsPage } from '../shared/SettingsPage';
import WorkspaceSearchSection from './WorkspaceSearchSection';
import WorktreeSettingsSection from './WorktreeSettingsSection';

export default function WorkspaceGitSettingsPage() {
  return (
    <SettingsPage pageId="development.workspace">
      <WorkspaceSearchSection />
      <WorktreeSettingsSection />
    </SettingsPage>
  );
}
