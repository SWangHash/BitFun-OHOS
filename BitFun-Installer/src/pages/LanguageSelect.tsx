import { Button, PageHeader, Radio } from '@bitfun/ui';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '../components/BrandMark';
import {
  DEFAULT_INSTALLER_UI_LANGUAGE,
  INSTALLER_LANGUAGES,
  resolveInstallerUiLanguage,
  type InstallerUiLanguage,
} from '../i18n/languages';
import packageInfo from '../../package.json';

interface LanguageSelectProps {
  onSelect: (lang: InstallerUiLanguage) => void;
}

export function LanguageSelect({ onSelect }: LanguageSelectProps) {
  const { t, i18n } = useTranslation();
  const selected = resolveInstallerUiLanguage(i18n.resolvedLanguage ?? i18n.language)
    ?? DEFAULT_INSTALLER_UI_LANGUAGE;

  return (
    <div className="welcome-page">
      <div className="welcome-brand">
        <div className="welcome-brand__identity">
          <BrandMark size="hero" />
          <h1 className="welcome-brand__name">{t('shared.product.name')}</h1>
          <span className="welcome-brand__version">{t('welcome.version', { version: packageInfo.version })}</span>
        </div>
      </div>

      <div className="page-shell">
        <div className="page-scroll">
          <div className="page-container page-container--center welcome-content">
            <PageHeader
              className="page-heading"
              level={2}
              title={t('welcome.title')}
              description={t('welcome.description')}
            />
            <fieldset className="language-options" aria-label={t('welcome.title')}>
              {INSTALLER_LANGUAGES.map((language) => (
                <Radio
                  key={language.uiCode}
                  className="language-option"
                  name="installer-language"
                  value={language.uiCode}
                  checked={selected === language.uiCode}
                  label={<span lang={language.appCode}>{language.nativeName}</span>}
                  onCheckedChange={(checked) => {
                    if (checked) void i18n.changeLanguage(language.uiCode);
                  }}
                />
              ))}
            </fieldset>
          </div>
        </div>
        <div className="page-footer">
          <Button variant="primary" trailingIcon={<ArrowRight />} onClick={() => onSelect(selected)}>
            {INSTALLER_LANGUAGES.find(language => language.uiCode === selected)?.continueLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
