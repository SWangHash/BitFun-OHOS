import type { AppearanceSurfaceDescriptor } from '@/infrastructure/appearance/types';
export const tabsAppearanceDescriptor: AppearanceSurfaceDescriptor = {
  id: 'tabs', parts: [{ id: 'root' }, { id: 'nav' }, { id: 'navList' }, { id: 'tab' }, { id: 'icon' }, { id: 'label' }, { id: 'close' }, { id: 'inkBar' }, { id: 'content' }, { id: 'pane' }],
  facets: [{ id: 'variant', attribute: 'data-openbitfun-variant', values: ['line', 'card', 'pill'] }, { id: 'size', attribute: 'data-openbitfun-size', values: ['small', 'medium', 'large'] }],
  states: [{ id: 'hover', selector: { kind: 'self', suffix: ':hover' } }, { id: 'active', selector: { kind: 'self', suffix: '[data-openbitfun-state~="active"]' } }, { id: 'disabled', selector: { kind: 'self', suffix: '[data-openbitfun-state~="disabled"]' } }, { id: 'stretch', selector: { kind: 'self', suffix: '[data-openbitfun-state~="stretch"]' } }],
};
