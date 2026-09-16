import { useTranslation } from 'react-i18next';
import {
  formatInstallPathError,
  installPathErrorShowsAdminHint,
  parseInstallPathErrorCode,
} from '../utils/installPathErrors';

interface InstallErrorPanelProps {
  message: string;
  variant?: 'options' | 'bare';
}

export function InstallErrorPanel({ message, variant = 'options' }: InstallErrorPanelProps) {
  const { t } = useTranslation();
  const text = formatInstallPathError(message, t);
  const showAdmin = installPathErrorShowsAdminHint(parseInstallPathErrorCode(message));

  return (
    <div className="install-error" data-variant={variant} role="alert">
      <p>{text}</p>
      {showAdmin && <p className="install-error__hint">{t('errors.installPath.adminHint')}</p>}
    </div>
  );
}
