import { Spinner, StatusPill } from '@bitfun/ui';
import { useEffect, useState } from 'react';
import { useI18n } from '@/infrastructure/i18n';

export type WeixinLoginPhase = 'scan' | 'confirm' | 'starting';

/** iLink holds a QR status request for up to 35 seconds; waiting is not a failed login. */
export function WeixinLoginProgress({ phase }: { phase: WeixinLoginPhase }) {
  const { t } = useI18n('common');
  const [slowPhase, setSlowPhase] = useState<WeixinLoginPhase | null>(null);
  useEffect(() => {
    setSlowPhase(null);
    const timer = window.setTimeout(() => setSlowPhase(phase), 10_000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const label = phase === 'scan'
    ? t('remoteConnect.botWeixinPolling')
    : phase === 'confirm'
      ? t('remoteConnect.botWeixinConfirming')
      : t('remoteConnect.botWeixinStarting');
  const description = phase === 'scan'
    ? t('remoteConnect.botWeixinScanProgressHint')
    : phase === 'confirm'
      ? t('remoteConnect.botWeixinAwaitingPhoneConfirm')
      : t('remoteConnect.botWeixinStartingHint');

  return (
    <div className="bitfun-remote-connect__weixin-progress" role="status" aria-live="polite" aria-atomic="true">
      <StatusPill tone="neutral" leading={<Spinner size="xs" />}>{label}</StatusPill>
      <p className="bitfun-remote-connect__hint">{description}</p>
      {slowPhase === phase && (
        <p className="bitfun-remote-connect__hint">
          {phase === 'starting'
            ? t('remoteConnect.botWeixinStartingSlow')
            : t('remoteConnect.botWeixinSyncSlow')}
        </p>
      )}
    </div>
  );
}
