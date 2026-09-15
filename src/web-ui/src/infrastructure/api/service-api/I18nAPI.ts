 

import { invoke } from '@tauri-apps/api/core';
import type { LocaleId, LocaleMetadata, I18nConfig } from '@/infrastructure/i18n/types';
import { getLocaleMetadata } from '@/infrastructure/i18n/presets';
import { createLogger } from '@/shared/utils/logger';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';

const log = createLogger('I18nAPI');

 
interface LocaleMetadataResponse {
  id: string;
  name: string;
  englishName: string;
  nativeName: string;
  rtl: boolean;
}

 
class I18nAPIClass {
   
  async getCurrentLanguage(): Promise<LocaleId> {
    try {
      const language = await invoke<string>('i18n_get_current_language');
      return language as LocaleId;
    } catch (error) {
      log.warn('Failed to get current language, using default', error);
      return 'zh-CN';
    }
  }

   
  async setLanguage(language: LocaleId): Promise<string> {
    const result = await invoke<string>('i18n_set_language', {
      request: { language }
    });
    await this.setApplicationPreferredLanguage(language);
    return result;
  }

  async setApplicationPreferredLanguage(language: LocaleId): Promise<void> {
    if (!isOpenHarmonyRuntime()) return;
    try {
      await invoke<string>('set_app_preferred_language', { language });
    } catch (error) {
      log.warn('Failed to sync OpenHarmony application language', error);
    }
  }

   
  async getSupportedLanguages(): Promise<LocaleMetadata[]> {
    const response = await invoke<LocaleMetadataResponse[]>('i18n_get_supported_languages');
    
    return response.map(item => {
      const id = item.id as LocaleId;
      const registryMetadata = getLocaleMetadata(id);

      return {
        ...registryMetadata,
        id,
        name: item.name,
        englishName: item.englishName,
        nativeName: item.nativeName,
        rtl: item.rtl,
        dateFormat: registryMetadata?.dateFormat ?? '',
        numberFormat: registryMetadata?.numberFormat ?? {
          decimal: '.',
          thousands: ',',
        },
        shortName: registryMetadata?.shortName ?? item.id,
        aliases: registryMetadata?.aliases ?? [item.id],
        contentFallbacks: registryMetadata?.contentFallbacks ?? ['en-US'],
        builtin: true,
      };
    });
  }

   
  async getConfig(): Promise<I18nConfig> {
    try {
      const config = await invoke<any>('i18n_get_config');
      return {
        currentLanguage: config.currentLanguage || 'zh-CN',
        fallbackLanguage: config.fallbackLanguage || 'en-US',
        autoDetect: config.autoDetect || false,
        loadedNamespaces: [],
      };
    } catch (error) {
      log.warn('Failed to get i18n config, using defaults', error);
      return {
        currentLanguage: 'zh-CN',
        fallbackLanguage: 'en-US',
        autoDetect: false,
        loadedNamespaces: [],
      };
    }
  }

   
  async setConfig(config: Partial<I18nConfig>): Promise<string> {
    return invoke<string>('i18n_set_config', { config });
  }
}


export const i18nAPI = new I18nAPIClass();
