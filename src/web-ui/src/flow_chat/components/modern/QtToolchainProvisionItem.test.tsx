// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';

import { qtToolchainProvisioningStatusText } from './QtToolchainProvisionItem';

describe('qtToolchainProvisioningStatusText', () => {
  // The card was acknowledged before the runtime install finished, so this text
  // is the "preparing" state that must stay visible on the waterfall row.
  const t = ((key: string, options?: Record<string, unknown>) => (
    options ? `${key}(${Object.entries(options).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key
  )) as unknown as TFunction<'flow-chat'>;

  it('renders nothing without a provisioning state', () => {
    expect(qtToolchainProvisioningStatusText(t, undefined)).toBeNull();
  });

  it('reports the stage and the transfer progress while running', () => {
    const text = qtToolchainProvisioningStatusText(t, {
      status: 'running',
      stage: 'downloading',
      downloadedBytes: 512,
      totalBytes: 1024,
    });
    expect(text).toContain('toolCards.askUser.qtMigration.provisioning');
    expect(text).toContain('toolCards.askUser.qtMigration.provisioningStage.downloading');
    expect(text).toContain('percent=50');
  });

  it('omits the percentage when the server declared no total', () => {
    const text = qtToolchainProvisioningStatusText(t, {
      status: 'running',
      stage: 'extracting',
      totalBytes: null,
    });
    expect(text).toContain('toolCards.askUser.qtMigration.provisioningStage.extracting');
    expect(text).not.toContain('provisioningPercent');
  });

  it('drops an unknown stage instead of rendering a raw key', () => {
    const text = qtToolchainProvisioningStatusText(t, {
      status: 'running',
      stage: 'future_stage_from_a_newer_backend',
    });
    expect(text).toBe('toolCards.askUser.qtMigration.provisioning');
  });

  it('surfaces the stable backend error code on failure', () => {
    const text = qtToolchainProvisioningStatusText(t, {
      status: 'failed',
      errorCode: 'source_not_published',
    });
    expect(text).toContain('toolCards.askUser.qtMigration.provisioningFailed');
    expect(text).toContain('code=source_not_published');
  });

  it('reports the ready state after a successful install', () => {
    expect(qtToolchainProvisioningStatusText(t, { status: 'succeeded' }))
      .toBe('toolCards.askUser.qtMigration.provisioningDone');
  });
});
