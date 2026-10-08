import React, { useEffect, useRef } from 'react';

interface SkillsLoadMoreSentinelProps {
  active: boolean;
  onLoad: () => void;
  /**
   * The real scrolling element that owns the list viewport. When omitted the
   * observer falls back to the browser viewport, which is unreliable inside
   * nested ScrollArea containers (e.g. ArkWeb). Pass the ScrollArea root node
   * so intersection is judged against the actual scroll bounds.
   */
  root?: Element | null;
}

const SkillsLoadMoreSentinel: React.FC<SkillsLoadMoreSentinelProps> = ({ active, onLoad, root }) => {
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !active || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadRef.current();
        }
      },
      {
        // Judge intersection against the real scroll container instead of the
        // browser viewport; nested ScrollArea setups otherwise miss or
        // mis-fire on ArkWeb and some Chromium builds.
        root: root ?? null,
        // Pre-trigger before the sentinel reaches the bottom edge so the next
        // page is in flight by the time the user hits the end, matching the
        // smooth append feel of the MiniApp market.
        rootMargin: '200px',
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, root]);

  return <div ref={sentinelRef} className="skills-load-more-sentinel" aria-hidden="true" />;
};

export default SkillsLoadMoreSentinel;
