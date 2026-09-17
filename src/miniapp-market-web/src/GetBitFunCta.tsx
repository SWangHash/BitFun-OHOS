import { ArrowRight, Download as DownloadSimple } from 'lucide-react';
import type { MessageKey } from './i18n';
import { BITFUN_DOWNLOAD_URL } from './links';

// A .bfminiapp package is useless without the desktop client, so the catalog
// and every listing keep one explicit path to the official download page.
export type GetBitFunPlacement = 'catalog' | 'listing';

export function GetBitFunCta({
  placement,
  t,
}: {
  placement: GetBitFunPlacement;
  t: (key: MessageKey) => string;
}) {
  return (
    <a
      className={`get-bitfun get-bitfun-${placement}`}
      href={BITFUN_DOWNLOAD_URL}
      target="_blank"
      rel="noreferrer"
    >
      <span className="get-bitfun-icon">
        <DownloadSimple size={18} aria-hidden="true" />
      </span>
      <span className="get-bitfun-copy">
        <strong>{t('getBitFunTitle')}</strong>
        <span>
          {t(placement === 'listing' ? 'getBitFunListingNote' : 'getBitFunCatalogNote')}
        </span>
        <span className="get-bitfun-action">
          {t('getBitFunAction')}
          <ArrowRight size={18} aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}
