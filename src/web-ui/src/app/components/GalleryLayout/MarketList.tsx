import { Component, createRef, type HTMLAttributes, type ReactNode } from 'react';
import { isReducedMotionPreferred } from '@/shared/utils/motionPreference';

interface MarketListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Stable item identities, in display order. Metadata refreshes need no motion. */
  revision: string;
  animate?: boolean;
}
interface Position { left: number; top: number }
type Snapshot = Map<string, Position> | null;

/** FLIP uses a pre-commit snapshot, so interrupted sorts start where cards are. */
export class MarketList extends Component<MarketListProps, Record<string, never>, Snapshot> {
  private root = createRef<HTMLDivElement>();
  private animations = new Map<HTMLElement, Animation>();

  getSnapshotBeforeUpdate(previous: MarketListProps): Snapshot {
    const root = this.root.current;
    if (!root || previous.revision === this.props.revision || !this.shouldAnimate()) return null;
    const origin = root.getBoundingClientRect();
    return new Map([...root.querySelectorAll<HTMLElement>(':scope > [data-market-key]')].map(item => {
      const rect = item.getBoundingClientRect();
      return [item.dataset.marketKey!, { left: rect.left - origin.left, top: rect.top - origin.top }];
    }));
  }

  componentDidUpdate(_previous: MarketListProps, _state: Record<string, never>, snapshot: Snapshot) {
    // Snapshot includes the current visual transform. Cancel before measuring
    // the new layout, then retarget from that visual position without snapping.
    if (_previous.revision === this.props.revision) return;
    this.cancelAnimations();
    const root = this.root.current;
    if (!snapshot || !root || !this.shouldAnimate() || !root.getClientRects().length) return;
    const origin = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const durationToken = style.getPropertyValue('--openbitfun-motion-duration-normal').trim();
    const duration = durationToken.endsWith('ms') ? parseFloat(durationToken) : parseFloat(durationToken) * 1000;
    const easing = style.getPropertyValue('--openbitfun-motion-easing-standard').trim() || 'ease-out';
    for (const item of root.querySelectorAll<HTMLElement>(':scope > [data-market-key]')) {
      if (typeof item.animate !== 'function') continue;
      const rect = item.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      const previous = snapshot.get(item.dataset.marketKey!);
      const x = previous ? previous.left - (rect.left - origin.left) : 0;
      const y = previous ? previous.top - (rect.top - origin.top) : 0;
      if (previous && Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue;
      const frames = previous
        ? [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }]
        : [{ opacity: 0 }, { opacity: 1 }];
      const animation = item.animate(frames, {
        duration: Number.isFinite(duration) ? Math.min(duration, 260) : 220,
        easing,
      });
      this.animations.set(item, animation);
      animation.onfinish = () => {
        if (this.animations.get(item) === animation) this.animations.delete(item);
      };
    }
  }

  componentWillUnmount() { this.cancelAnimations(); }

  private shouldAnimate() {
    return this.props.animate !== false && !isReducedMotionPreferred();
  }

  private cancelAnimations() {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
  }

  render() {
    const { children, revision: _revision, animate: _animate, ...props } = this.props;
    return <div {...props} ref={this.root}>{children}</div>;
  }
}
