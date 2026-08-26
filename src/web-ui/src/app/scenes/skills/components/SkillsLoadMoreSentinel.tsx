import React, { useEffect, useRef } from 'react';

interface SkillsLoadMoreSentinelProps {
  active: boolean;
  onLoad: () => void;
}

const SkillsLoadMoreSentinel: React.FC<SkillsLoadMoreSentinelProps> = ({ active, onLoad }) => {
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !active || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadRef.current();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);

  return <div ref={sentinelRef} className="skills-load-more-sentinel" aria-hidden="true" />;
};

export default SkillsLoadMoreSentinel;
