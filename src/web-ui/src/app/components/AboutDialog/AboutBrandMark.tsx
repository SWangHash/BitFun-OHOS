import { useEffect, useRef } from 'react';

/**
 * Fixed 256-unit diagonal mark: one filled silhouette drawn as four subpaths.
 * Kept in step with `design-system/assets/welcome-brand-contours.json`, which
 * records the same geometry and path length for the native renderers.
 */
const MARK_PATH = 'M66.560 16.000L67.840 16.000L67.840 32.640L70.400 48.000L74.240 59.520L82.560 74.240L96.000 88.960L131.200 115.840L147.840 131.840L152.960 138.880L158.720 152.320L158.720 168.960L151.680 183.040L137.600 195.200L122.880 201.600L113.920 203.520L101.760 202.880L108.800 201.600L120.960 195.840L130.560 187.520L134.400 181.760L136.960 174.720L137.600 165.760L132.480 151.040L122.240 138.880L88.320 112.000L71.040 96.000L58.880 80.640L51.840 64.000L50.560 44.160L52.480 35.840L58.880 23.680ZM52.480 82.560L58.240 95.360L65.280 104.960L80.000 119.040L113.280 143.360L126.720 157.440L130.560 166.400L130.560 176.000L126.720 184.960L119.040 192.640L112.640 195.200L117.120 188.160L117.120 179.200L111.360 168.320L103.040 161.280L71.680 141.440L56.320 124.800L51.200 114.560L48.640 103.040L49.280 91.520ZM199.680 116.480L206.720 117.120L212.480 120.320L223.360 120.960L232.960 124.800L211.840 123.520L200.960 126.720L191.360 132.480L172.800 163.200L158.080 178.560L162.560 169.600L163.200 161.280L172.160 150.400L184.960 126.080L191.360 119.040ZM111.360 179.200L112.640 179.200L113.280 182.400L112.640 188.160L106.240 197.120L93.440 202.880L58.240 211.200L39.680 218.880L26.240 229.760L19.840 240.640L24.320 223.360L30.720 211.840L35.200 207.360L42.880 202.880L54.400 199.040L97.280 190.720L106.240 186.240Z';
const MARK_OPACITY = 0.34;
const FLOW_CYCLE_MS = 18000;
const FLOW_LAYERS = [
  { length: 34, opacity: 0.12 },
  { length: 26, opacity: 0.14 },
  { length: 18, opacity: 0.36 },
];

export function AboutBrandMark({ active = true }: { active?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !active) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];

    const synchronizePlayback = () => {
      if (reducedMotion.matches) {
        animations.forEach(animation => animation.cancel());
        animations = [];
        return;
      }
      if (document.hidden) {
        animations.forEach(animation => animation.pause());
        return;
      }
      if (animations.length === 0) {
        // Equal lap times preserve the spacing between highlights indefinitely.
        // Only the highlights circulate; the silhouette stays fixed.
        animations = Array.from(svg.querySelectorAll('.bitfun-about-dialog__brand-flow'))
          .map((strand, index) => {
            const start = -index * 3;
            return strand.animate([
              { strokeDashoffset: String(start) },
              { strokeDashoffset: String(start - 100) },
            ], { duration: FLOW_CYCLE_MS, iterations: Infinity, easing: 'linear' });
          });
      } else {
        animations.forEach(animation => animation.play());
      }
    };

    synchronizePlayback();
    reducedMotion.addEventListener('change', synchronizePlayback);
    document.addEventListener('visibilitychange', synchronizePlayback);
    return () => {
      animations.forEach(animation => animation.cancel());
      reducedMotion.removeEventListener('change', synchronizePlayback);
      document.removeEventListener('visibilitychange', synchronizePlayback);
    };
  }, [active]);

  return (
    <svg
      ref={svgRef}
      className="bitfun-about-dialog__brand-mark"
      viewBox="0 0 256 256"
      width={256}
      height={256}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={MARK_PATH}
        fill="currentColor"
        fillRule="evenodd"
        stroke="none"
        opacity={MARK_OPACITY}
      />
      <g className="bitfun-about-dialog__brand-flow">
        {FLOW_LAYERS.map(layer => (
          <path
            key={layer.length}
            d={MARK_PATH}
            pathLength={100}
            strokeDasharray={`${layer.length / 2} ${100 - layer.length} ${layer.length / 2} 0`}
            opacity={layer.opacity}
          />
        ))}
      </g>
    </svg>
  );
}
