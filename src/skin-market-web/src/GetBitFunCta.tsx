import { ArrowRight, Download as DownloadSimple } from 'lucide-react';
import type { Translate } from './i18n';
import { BITFUN_DOWNLOAD_URL } from './links';

// An appearance package only applies inside the desktop client, so the catalog
// and every listing carry the same visible route to the official download page.
export type GetBitFunPlacement = 'catalog' | 'listing';

export function GetBitFunCta({
  placement,
  t,
}: {
  placement: GetBitFunPlacement;
  t: Translate;
}) {
  return (
    <a
      className={`get-bitfun get-bitfun--${placement}`}
      href={BITFUN_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
    >
      <span className="get-bitfun__icon">
        <DownloadSimple size={20} aria-hidden="true" />
      </span>
      <span className="get-bitfun__copy">
        <strong>{t('getBitFunTitle')}</strong>
        <span>
          {t(placement === 'listing' ? 'getBitFunListingNote' : 'getBitFunCatalogNote')}
        </span>
        <span className="get-bitfun__action">
          {t('getBitFunAction')}
          <ArrowRight size={17} aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}
