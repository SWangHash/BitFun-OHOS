import { describe, expect, it } from 'vitest';
import { buildUsageActivity, usageActivityRequestRange } from './usageActivity';

describe('usage activity calendar', () => {
  it('aggregates by the selected local date without counting cached input twice', () => {
    const point = (bucket: string) => ({ bucket, inputTokens: 10, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 1, cacheHitRate: 0.8 });
    const activity = buildUsageActivity([
      point('2026-11-01T01:00:00Z'),
      point('2026-11-01T06:00:00Z'),
      point('2026-11-01T09:00:00Z'),
    ], 'America/Los_Angeles', new Date('2026-11-02T00:00:00Z'));
    expect(activity.days.find(day => day.key === '2026-10-31')?.tokens).toBe(30);
    expect(activity.days.find(day => day.key === '2026-11-01')?.tokens).toBe(15);
    expect(activity.totalTokens).toBe(45);
    expect(activity.days.filter(day => day.inRange).at(-1)?.key).toBe('2026-11-01');
  });

  it('covers six calendar months across month ends and pads the grid without future usage', () => {
    const now = new Date('2026-08-31T23:30:00Z');
    const activity = buildUsageActivity([], 'Asia/Tokyo', now);
    const active = activity.days.filter(day => day.inRange);
    expect(active[0]?.key).toBe('2026-03-02');
    expect(active.at(-1)?.key).toBe('2026-09-01');
    expect(activity.days[0].date.getUTCDay()).toBe(1);
    expect(activity.days).toHaveLength(activity.weekCount * 7);
    expect(activity.days.every(day => day.tokens === 0 && day.level === 0)).toBe(true);
    expect(usageActivityRequestRange('Asia/Tokyo', now)).toEqual({
      start: '2026-03-01T00:00:00.000Z', end: now.toISOString(),
    });
  });
});
