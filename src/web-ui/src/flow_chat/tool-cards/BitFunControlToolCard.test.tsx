// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '@/locales/en-US/flow-chat.json';
import shared from '../../../../shared/i18n/resources/shared/en-US/terms.json';
import type { FlowToolItem } from '../types/flow-chat';
import { getToolItemCardConfig } from './toolCardMetadata';
import { BitFunControlToolCard } from './BitFunControlToolCard';

const translations = createInstance();
beforeAll(async () => {
  await translations.init({ lng: 'en-US', resources: { 'en-US': { 'flow-chat': en, shared } }, interpolation: { escapeValue: false } });
});

function render(action: string, result: unknown, status: FlowToolItem['status'] = 'completed') {
  const toolItem: FlowToolItem = {
    id: 'control-1', type: 'tool', toolName: 'BitFunControl', status, timestamp: 0,
    toolCall: { id: 'call-1', input: { action, capability_id: 'peer.feature' } },
    toolResult: { result, success: true },
  };
  return renderToStaticMarkup(<I18nextProvider i18n={translations}>
    <BitFunControlToolCard toolItem={toolItem} config={getToolItemCardConfig(toolItem)} />
  </I18nextProvider>);
}

describe('BitFun control card content', () => {
  it('uses real shared card frameworks for discovery and control', () => {
    expect(render('list', { items: [] })).toContain('data-bitfun-attention="ambient"');
    const html = render('configure', { configured: true, effectiveValue: false });
    expect(html).toContain('data-bitfun-tool-card="bitfun-control"');
    expect(html).toContain('data-bitfun-attention="prominent"');
    expect(html).toContain('Change setting');
    expect(html).toContain('BitFun');
    expect(html).toContain('lucide-sliders-horizontal');
    expect(html).not.toContain('data-bitfun-part="extra"');
    expect(html).not.toContain('Tool: BitFunControl');
  });

  it('does not render a success glyph for an unconfirmed result or pending approval', () => {
    for (const html of [render('open', { futureField: true }), render('open', undefined, 'pending_confirmation')]) {
      expect(html).not.toContain('data-bitfun-part="statusLayer"');
      expect(html).not.toContain('>Opened<');
    }
    expect(render('get', { capability: { id: 'peer.feature' } })).not.toContain('data-bitfun-part="extra"');
    expect(render('list', { items: [] })).not.toContain('data-bitfun-part="extra"');
  });

  it('shows rejection and failed acknowledgements distinctly', () => {
    expect(render('execute', { executed: false }, 'rejected')).toContain('data-bitfun-status="rejected"');
    const failed = render('execute', { executed: false });
    expect(failed).toContain('data-bitfun-status="error"');
    expect(failed).not.toContain('>Executed<');
    expect(render('configure', { configured: true, presentationSync: { status: 'notAttached' } }))
      .not.toContain('data-bitfun-part="extra"');
  });
});
