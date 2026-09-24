import { afterEach, describe, expect, it } from 'vitest';
import { notificationStore } from '../store/NotificationStore';
import { notificationService } from './NotificationService';

/**
 * The toast timeout is owned by the notification presentation (see
 * NotificationContainer), so the service contract verified here is the duration
 * it records. Auto-expiry itself is covered by the container tests.
 */
const activeToast = (id: string) =>
  notificationStore.getState().activeNotifications.find((item) => item.id === id);

describe('NotificationService error toast', () => {
  afterEach(() => {
    notificationService.dismissAll();
  });

  it('records the default toast duration so the presentation expires it', () => {
    const id = notificationService.error('Failed');

    expect(activeToast(id)?.duration).toBe(notificationStore.getState().config.defaultDuration);
  });

  it('keeps an explicit zero duration as the opt-out of automatic expiry', () => {
    const id = notificationService.error('Failed', { duration: 0 });

    expect(activeToast(id)?.duration).toBe(0);
  });
});
