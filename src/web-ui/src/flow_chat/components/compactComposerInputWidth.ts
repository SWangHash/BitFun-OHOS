/** Read the existing compact track; expanded composers still need a compact-layout probe. */
export function readCompactComposerInputWidth(container: HTMLElement): number | null {
  if (!container.classList.contains('bitfun-chat-input--capsule')) return null;
  const surface = container.querySelector<HTMLElement>(
    '[data-bitfun-component="chat-composer"] [data-bitfun-part="surface"]',
  );
  if (surface?.dataset.bitfunLayout !== 'compact') return null;
  const area = surface.querySelector<HTMLElement>('.bitfun-chat-input__input-area');
  const width = area?.getBoundingClientRect().width;
  // Hidden/detached layouts are not a usable measurement. Keep the existing
  // off-screen fallback until the live compact track has real geometry.
  return width !== undefined && Number.isFinite(width) && width > 0
    ? Math.max(80, Math.floor(width)) : null;
}
