import { WorkbenchResidencyPage } from './WorkbenchResidencyPage.mjs';

export class ComposerLayoutPage extends WorkbenchResidencyPage {
  async replaceDraft(text) {
    const element = await this.request(`/session/${this.session}/element`, {
      using: 'css selector', value: '[data-testid="chat-input-textarea"]',
    });
    const id = element['element-6066-11e4-a52e-4f735466cecf'];
    await this.request(`/session/${this.session}/element/${id}/clear`, {});
    if (text) await this.request(`/session/${this.session}/element/${id}/value`, { text });
  }

  readComposerGeometry() {
    return this.execute(() => {
      const container = document.querySelector('[data-testid="chat-input-container"]');
      const editor = container?.querySelector('[data-testid="chat-input-textarea"]');
      const area = container?.querySelector('.bitfun-chat-input__input-area');
      const surfaceSelector = '[data-bitfun-component="chat-composer"] [data-bitfun-part="surface"]';
      const surface = container?.querySelector(surfaceSelector);
      if (!container || !editor || !area || !surface) throw new Error('Composer must be mounted');
      const rect = element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const result = { draft: editor.textContent, layout: surface.dataset.bitfunLayout,
        capsule: container.classList.contains('bitfun-chat-input--capsule'),
        container: rect(container), inputArea: rect(area), surface: rect(surface),
        liveWidth: Math.max(80, Math.floor(area.getBoundingClientRect().width)),
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } };
      // Preserve the previous production probe as an independent geometry oracle.
      // This extra clone is outside all performance acceptance windows.
      const clone = container.cloneNode(true);
      Object.assign(clone.style, { position: 'fixed', left: '-100000px', top: '0',
        visibility: 'hidden', pointerEvents: 'none', width: `${container.getBoundingClientRect().width}px` });
      clone.classList.add('bitfun-chat-input--capsule');
      clone.classList.remove('bitfun-chat-input--multi-line');
      const cloneSurface = clone.querySelector(surfaceSelector);
      if (cloneSurface) cloneSurface.dataset.bitfunLayout = 'compact';
      document.body.append(clone);
      try {
        const cloneArea = clone.querySelector('.bitfun-chat-input__input-area');
        result.referenceWidth = Math.max(80, Math.floor(cloneArea.getBoundingClientRect().width));
      } finally { clone.remove(); }
      return result;
    });
  }
}
