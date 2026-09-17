import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GetBitFunCta, type GetBitFunPlacement } from './GetBitFunCta';
import type { MessageKey } from './i18n';
import { BITFUN_DOWNLOAD_URL } from './links';

const t = (key: MessageKey): string => key;

describe('GetBitFunCta', () => {
  it.each<GetBitFunPlacement>(['catalog', 'listing'])(
    'sends %s visitors to the official download page',
    (placement) => {
      const markup = renderToStaticMarkup(<GetBitFunCta placement={placement} t={t} />);

      expect(markup).toContain(`href="${BITFUN_DOWNLOAD_URL}"`);
      expect(markup).toContain('rel="noreferrer"');
      expect(markup).toContain('getBitFunTitle');
      expect(markup).toContain('getBitFunAction');
    },
  );

  it('explains the surface the visitor is actually looking at', () => {
    expect(renderToStaticMarkup(<GetBitFunCta placement="listing" t={t} />))
      .toContain('getBitFunListingNote');
    expect(renderToStaticMarkup(<GetBitFunCta placement="catalog" t={t} />))
      .toContain('getBitFunCatalogNote');
  });
});
