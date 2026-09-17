 

import React, { useCallback } from 'react';

import { ActionItem, Button, Select, Tooltip, Icon } from '@bitfun/ui';
import { useLanguageSelector } from '../hooks/useI18n';
import type { LocaleId } from '../types';
import './LanguageSelector.scss';

export interface LanguageSelectorProps {
   
  mode?: 'dropdown' | 'inline' | 'icon-only';
   
  className?: string;
   
  showNativeName?: boolean;
   
  onChange?: (locale: LocaleId) => void;
}

 
export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  mode = 'dropdown',
  className = '',
  showNativeName = true,
  onChange,
}) => {
  const { currentLanguage, supportedLocales, selectLanguage, isChanging } = useLanguageSelector();

  const handleChange = useCallback(async (locale: LocaleId) => {
    await selectLanguage(locale);
    onChange?.(locale);
  }, [selectLanguage, onChange]);

  const currentLocale = supportedLocales.find(l => l.id === currentLanguage);

  if (mode === 'icon-only') {
    return (
      <div
        className={`language-selector language-selector--icon-only ${className}`}
        data-bitfun-component="language-selector"
        data-bitfun-part="root"
        data-bitfun-mode="icon-only"
        data-bitfun-state={isChanging ? 'changing' : undefined}
      >
        <span data-bitfun-component="language-selector" data-bitfun-part="trigger">
          <Tooltip content={currentLocale?.nativeName || currentLanguage}>
            <Button
              aria-label={currentLocale?.nativeName || currentLanguage}
              className="language-selector__button"
              variant="outline"
              size="sm"
              disabled={isChanging}
              leadingIcon={(
                <span data-bitfun-component="language-selector" data-bitfun-part="icon">
                  <Icon name="browser" size="md" />
                </span>
              )}
            >
              <span
                className="language-selector__code"
                data-bitfun-component="language-selector"
                data-bitfun-part="code"
              >
                {currentLanguage.split('-')[0].toUpperCase()}
              </span>
            </Button>
          </Tooltip>
        </span>
        <div
          className="language-selector__dropdown"
          data-bitfun-component="language-selector"
          data-bitfun-part="menu"
        >
          {supportedLocales.map(locale => (
            <ActionItem
              key={locale.id}
              className={`language-selector__option ${locale.id === currentLanguage ? 'language-selector__option--active' : ''}`}
              onClick={() => handleChange(locale.id)}
              disabled={isChanging}
              data-bitfun-component="language-selector"
              data-bitfun-part="option"
              data-bitfun-state={locale.id === currentLanguage ? 'active' : undefined}
              metadata={locale.id === currentLanguage ? (
                <span
                  className="language-selector__check"
                  data-bitfun-component="language-selector"
                  data-bitfun-part="check"
                >✓</span>
              ) : undefined}
            >
              <span
                className="language-selector__option-name"
                data-bitfun-component="language-selector"
                data-bitfun-part="optionLabel"
              >
                {showNativeName ? locale.nativeName : locale.englishName}
              </span>
            </ActionItem>
          ))}
        </div>
      </div>
    );
  }

  if (mode === 'inline') {
    return (
      <div
        className={`language-selector language-selector--inline ${className}`}
        data-bitfun-component="language-selector"
        data-bitfun-part="root"
        data-bitfun-mode="inline"
        data-bitfun-state={isChanging ? 'changing' : undefined}
      >
        {supportedLocales.map(locale => (
          <Button
            key={locale.id}
            className={`language-selector__inline-button ${locale.id === currentLanguage ? 'language-selector__inline-button--active' : ''}`}
            variant="text"
            size="sm"
            onClick={() => handleChange(locale.id)}
            disabled={isChanging}
            data-bitfun-component="language-selector"
            data-bitfun-part="option"
            data-bitfun-state={locale.id === currentLanguage ? 'active' : undefined}
          >
            {showNativeName ? locale.nativeName : locale.englishName}
          </Button>
        ))}
      </div>
    );
  }

  
  return (
    <div
      className={`language-selector language-selector--dropdown ${className}`}
      data-bitfun-component="language-selector"
      data-bitfun-part="root"
      data-bitfun-mode="dropdown"
      data-bitfun-state={isChanging ? 'changing' : undefined}
    >
      <Select
        className="language-selector__select"
        value={currentLanguage}
        onValueChange={(value) => handleChange(value as LocaleId)}
        disabled={isChanging}
        options={supportedLocales.map(locale => ({
          value: locale.id,
          label: showNativeName ? locale.nativeName : locale.englishName
        }))}
      />
      {isChanging && (
        <span
          className="language-selector__loading"
          data-bitfun-component="language-selector"
          data-bitfun-part="loading"
          data-bitfun-state="changing"
        >...</span>
      )}
    </div>
  );
};

export default LanguageSelector;
