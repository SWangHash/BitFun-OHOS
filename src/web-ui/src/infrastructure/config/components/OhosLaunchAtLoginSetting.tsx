import { useCallback, useEffect, useState } from 'react';
import { Button, Switch } from '@bitfun/ui';
import { useTranslation } from 'react-i18next';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { ConfigPageRow } from './common';

export function OhosLaunchAtLoginSetting() {
  const { t } = useTranslation('settings/application');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setEnabled(await systemAPI.getLaunchAtLoginEnabled()); }
    catch { setEnabled(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  return <ConfigPageRow label={t('launchAtLogin.toggleLabel')} description={t('launchAtLogin.ohosGuide')} align="center">
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--bitfun-space-4)' }}>
      <Button size="sm" variant="outline" loading={loading} disabled={loading} onClick={() => void refresh()}>{t('launchAtLogin.refresh')}</Button>
      <Switch checked={enabled === true} disabled aria-label={t('launchAtLogin.toggleLabel')} />
    </div>
  </ConfigPageRow>;
}
