import React from 'react';
import { MobileBanner, MobileButton } from '@bitfun/ui/mobile';
import { ArrowUpRight, LogIn, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';

interface PairingFormProps {
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  onCancel: () => void;
  onFocus: () => void;
}

/** Presentation for independent email and GitHub account sign-in. */
const PairingForm: React.FC<PairingFormProps> = ({ busy, error, onSignIn, onCancel, onFocus }) => {
  const { t } = useI18n();
  return (
    <form className="pairing-page__form" onSubmit={(event) => { event.preventDefault(); onSignIn(); }}>
      <div className="pairing-page__scroll">
        <div className="pairing-page__form-content">
          <span className="pairing-page__symbol"><MonitorSmartphone size={24} aria-hidden="true" /></span>
          <h1 className="pairing-page__title">{t('pairing.loginTitle')}</h1>
          <p className="pairing-page__intro">{t('pairing.githubDescription')}</p>
          {error && <MobileBanner className="pairing-page__error" tone="danger">{error}</MobileBanner>}
          {busy && <div className="pairing-page__waiting" role="status">
            <ShieldCheck size={20} aria-hidden="true" /><p>{t('pairing.waitingForGitHub')}</p>
          </div>}
        </div>
      </div>
      <div className="pairing-page__action">
        <MobileButton appearance="primary" block className="pairing-page__retry" type={busy ? "button" : "submit"} onClick={busy ? onFocus : undefined} leading={busy ? <ArrowUpRight size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}>
          {t(busy ? 'pairing.returnToSignIn' : 'pairing.githubSignIn')}
        </MobileButton>
        {busy && <MobileButton appearance="plain" onClick={onCancel}>{t('common.cancel')}</MobileButton>}
      </div>
    </form>
  );
};
export default PairingForm;
