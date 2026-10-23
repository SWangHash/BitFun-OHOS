import {
  DesignSystemProvider,
  type ColorScheme,
  type ContrastMode,
  type DensityMode,
} from '@bitfun/ui';
import {
  useEffect,
  useLayoutEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { useAppearance } from '@/infrastructure/appearance';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { useI18n } from '@/infrastructure/i18n';
import {
  HOST_CHROME_INSET_BLOCK_START_VARIABLE,
  hostWindowChromeInsetBlockStart,
  isOpenHarmonyRuntime,
} from '@/infrastructure/runtime/environment';

const DENSITY: DensityMode = 'compact';
const HIGH_CONTRAST_MEDIA_QUERY = '(prefers-contrast: more), (forced-colors: active)';
const SCROLLBAR_WIDTH_VARIABLE = '--bitfun-scrollbar-width';
/**
 * ArkWeb pairs a thin idle scrollbar thumb with a full-width hover thumb, so
 * the same scrollbar changes width when the pointer reaches it, and it ignores
 * `::-webkit-scrollbar` while the standard scrollbar properties apply. That
 * host therefore reports its scrollbar engine and gets the desktop reserved
 * width handed to the token, so the webkit path would still match the desktop
 * build if the standard properties ever stop applying.
 */
const ARKWEB_SCROLLBAR_HOST = 'arkweb';
const ARKWEB_SCROLLBAR_WIDTH = '10px';

function readHighContrastPreference(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(HIGH_CONTRAST_MEDIA_QUERY).matches;
}

function useHighContrastPreference(): boolean {
  const [highContrast, setHighContrast] = useState(readHighContrastPreference);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(HIGH_CONTRAST_MEDIA_QUERY);
    const update = () => setHighContrast(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return highContrast;
}

/**
 * The product-owned UI host. It is the only place where product appearance,
 * locale copy and the document-level portal host enter the independent design
 * system.
 */
export function BitFunDesignSystemProvider({ children }: PropsWithChildren) {
  const colorScheme: ColorScheme = useAppearance().current?.mode ?? 'light';
  const contrast: ContrastMode = useHighContrastPreference() ? 'high' : 'standard';
  const { currentLanguage, t } = useI18n('components');

  useLayoutEffect(() => {
    const root = document.documentElement;
    const openHarmony = isOpenHarmonyRuntime();
    const attributes: Record<string, string> = {
      'data-bitfun-design-system-root': '',
      'data-color-scheme': colorScheme,
      'data-contrast': contrast,
      'data-density': DENSITY,
    };
    if (openHarmony) {
      attributes['data-bitfun-scrollbar-host'] = ARKWEB_SCROLLBAR_HOST;
    }
    const previousValues = new Map(
      Object.keys(attributes).map(name => [name, root.getAttribute(name)]),
    );
    const hostTokens: Record<string, string> = {
      // A host that paints window chrome over the web view reserves that strip for
      // every floating surface; hosts without it keep the zero default.
      [HOST_CHROME_INSET_BLOCK_START_VARIABLE]: `${hostWindowChromeInsetBlockStart()}px`,
    };
    if (openHarmony) {
      hostTokens[SCROLLBAR_WIDTH_VARIABLE] = ARKWEB_SCROLLBAR_WIDTH;
    }
    const previousTokens = new Map(
      Object.keys(hostTokens).map(name => [name, root.style.getPropertyValue(name)]),
    );

    Object.entries(attributes).forEach(([name, value]) => {
      root.setAttribute(name, value);
    });
    Object.entries(hostTokens).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });

    return () => {
      previousValues.forEach((value, name) => {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      });
      previousTokens.forEach((value, name) => {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      });
    };
  }, [colorScheme, contrast]);

  return (
    <DesignSystemProvider
      colorScheme={colorScheme}
      contrast={contrast}
      density={DENSITY}
      locale={currentLanguage}
      messages={{
        clearSelection: t('search.clear'),
        confirmAction: t('dialog.confirm.ok'),
        confirmCancel: t('dialog.confirm.cancel'),
        createValue: t('select.customValueHint'),
        dialogClose: t('modal.close'),
        loading: t('select.loading'),
        noOptions: t('select.emptyText'),
        searchOptions: t('select.search'),
        selectAll: t('select.selectAll'),
        selectPlaceholder: t('select.placeholder'),
      }}
      portalHost={getAppearanceOverlayHost}
    >
      {children}
    </DesignSystemProvider>
  );
}
