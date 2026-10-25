import { ConfigPageSectionStack } from '@/infrastructure/config/components/common';
import DefaultHarnessConfig from '@/infrastructure/config/components/DefaultHarnessConfig';
import MemorySettingsPage from '@/infrastructure/config/components/MemorySettingsPage';
import SessionTitleConfig from '@/infrastructure/config/components/SessionTitleConfig';
import { SettingsPage } from '../shared/SettingsPage';
import { useSettingsSectionAnchor } from '../shared/useSettingsSectionAnchor';

export default function SessionMemorySettingsPage() {
  const sessionAnchor = useSettingsSectionAnchor('session');
  const memoryAnchor = useSettingsSectionAnchor('memory');

  return (
    <SettingsPage pageId="ai.session-memory">
      <ConfigPageSectionStack id={sessionAnchor}>
        <DefaultHarnessConfig />
        <SessionTitleConfig />
      </ConfigPageSectionStack>
      <ConfigPageSectionStack id={memoryAnchor}>
        <MemorySettingsPage embedded />
      </ConfigPageSectionStack>
    </SettingsPage>
  );
}
