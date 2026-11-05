import { SettingsPage } from '../shared/SettingsPage';
import HooksSettingsSection from './HooksSettingsSection';
import QuickActionsSettingsSection from './QuickActionsSettingsSection';

export default function AutomationSettingsPage() {
  return (
    <SettingsPage pageId="tools.automation" data-bitfun-component="automation-settings-page" data-bitfun-part="root">
      <div data-bitfun-component="automation-settings-page" data-bitfun-part="quickActions">
        <QuickActionsSettingsSection />
      </div>
      <div data-bitfun-component="automation-settings-page" data-bitfun-part="hooks">
        <HooksSettingsSection />
      </div>
    </SettingsPage>
  );
}
