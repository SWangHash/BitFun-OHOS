import React, { useEffect, useRef, useState } from 'react';

interface StickySectionHeaderProps {
  children: React.ReactNode;
  scrollRootRef: React.RefObject<HTMLDivElement | null>;
  contentRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Keeps one section header in the DOM while exposing whether it has crossed
 * the top edge of its scroll container. CSS owns the sticky positioning; the
 * observer state is only for the docked divider and appearance contract.
 * Clip covered rows so the header can share the sidebar's transparent material.
 */
const StickySectionHeader: React.FC<StickySectionHeaderProps> = ({
  children,
  scrollRootRef,
  contentRef,
}) => {
  const sentinelRef = useRef<HTMLSpanElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    const header = headerRef.current;
    const content = contentRef?.current;
    if (!scrollRoot || !header || !content) return;

    const originalClipPath = content.style.clipPath;
    const updateClip = () => {
      const overlap = Math.max(0, header.getBoundingClientRect().bottom - content.getBoundingClientRect().top);
      const clipPath = overlap > 0 ? `inset(${overlap}px 0 0)` : originalClipPath;
      if (content.style.clipPath !== clipPath) content.style.clipPath = clipPath;
    };
    scrollRoot.addEventListener('scroll', updateClip, { passive: true });
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateClip) : null;
    [scrollRoot, header, content].forEach(element => resizeObserver?.observe(element));
    updateClip();

    return () => {
      scrollRoot.removeEventListener('scroll', updateClip);
      resizeObserver?.disconnect();
      content.style.clipPath = originalClipPath;
    };
  }, [scrollRootRef, contentRef]);

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    const sentinel = sentinelRef.current;
    if (!scrollRoot || !sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      const rootTop = entry.rootBounds?.top ?? scrollRoot.getBoundingClientRect().top;
      const nextIsStuck = !entry.isIntersecting && entry.boundingClientRect.top < rootTop;
      setIsStuck(current => current === nextIsStuck ? current : nextIsStuck);
    }, {
      root: scrollRoot,
      threshold: [0, 1],
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRootRef]);

  return (
    <>
      <span
        ref={sentinelRef}
        className="bitfun-nav-panel__sticky-section-sentinel"
        aria-hidden="true"
      />
      <div
        ref={headerRef}
        className={`bitfun-nav-panel__sticky-section-header${isStuck ? ' is-stuck' : ''}`}
        data-bitfun-component="nav-panel"
        data-bitfun-part="stickySectionHeader"
        data-bitfun-state={isStuck ? 'stuck' : undefined}
        data-testid="nav-sessions-sticky-header"
      >
        {children}
      </div>
    </>
  );
};

export default React.memo(StickySectionHeader);
