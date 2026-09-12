import { useEffect, useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import {
  marketImageSrcSet, marketImageUrl, retryOriginalMarketImage, type MarketImageVariant,
} from '@/infrastructure/api/service-api/MarketImage';
import { acquireMarketImage, canCacheMarketImage } from '@/infrastructure/api/service-api/MarketImageCache';
import './MarketImage.scss';

interface MarketImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> {
  source: string;
  variant?: MarketImageVariant;
  responsive?: boolean;
}

/** Fixed media geometry stays with the card; decode only reveals its pixels. */
export function MarketImage(props: MarketImageProps) {
  return <MarketImageContent key={`${props.source}:${props.variant}`} {...props} />;
}

function MarketImageContent({
  source, variant = 'compact-v1', responsive = false, onError, onLoad, className,
  loading = 'lazy', decoding = 'async', ...props
}: MarketImageProps) {
  const nativeCache = canCacheMarketImage(source);
  const [resolvedVariant, setResolvedVariant] = useState<MarketImageVariant | undefined>(
    nativeCache && responsive ? undefined : variant,
  );
  const directUrl = marketImageUrl(source, resolvedVariant ?? variant);
  const [src, setSrc] = useState<string | undefined>(nativeCache ? undefined : directUrl);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    if (!nativeCache || !responsive || !ref.current) return;
    const image = ref.current;
    const chooseVariant = () => {
      const pixels = image.getBoundingClientRect().width * (window.devicePixelRatio || 1);
      const next = pixels > 640 ? 'large-v1' : 'compact-v1';
      // Once a larger image is loaded, shrinking a window needs no new bytes.
      setResolvedVariant(current => current === 'large-v1' ? current : next);
    };
    chooseVariant();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(chooseVariant);
    observer.observe(image);
    return () => observer.disconnect();
  }, [nativeCache, responsive]);

  useEffect(() => {
    if (!nativeCache || !resolvedVariant) return;
    let cancelled = false;
    let lease: ReturnType<typeof acquireMarketImage> | undefined;
    const load = () => {
      if (lease || cancelled) return;
      lease = acquireMarketImage(source, resolvedVariant);
      if (lease.readyUrl) setSrc(lease.readyUrl);
      void lease.url.then(url => {
        if (!cancelled) setSrc(url);
      }).catch(() => {
        if (!cancelled) setSrc(directUrl);
      });
    };
    const image = ref.current;
    let observer: IntersectionObserver | undefined;
    if (image && loading === 'lazy' && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      }, { rootMargin: '240px' });
      observer.observe(image);
    } else load();
    return () => {
      cancelled = true;
      observer?.disconnect();
      lease?.release();
    };
  }, [directUrl, loading, nativeCache, source, resolvedVariant]);

  return <img
    {...props}
    ref={ref}
    data-openbitfun-component="gallery-layout"
    data-openbitfun-part="marketImage"
    className={['market-image', className].filter(Boolean).join(' ')}
    data-loaded={loaded || undefined}
    src={src}
    srcSet={!nativeCache && responsive ? marketImageSrcSet(source) : undefined}
    loading={loading}
    decoding={decoding}
    onLoad={event => {
      setLoaded(true);
      onLoad?.(event);
    }}
    onError={event => {
      if (!retryOriginalMarketImage(event.currentTarget, source)) onError?.(event);
    }}
  />;
}
