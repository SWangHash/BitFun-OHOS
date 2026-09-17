// @vitest-environment jsdom

import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StickySectionHeader from './StickySectionHeader';

describe('StickySectionHeader', () => {
  let container: HTMLDivElement;
  let root: Root;
  let observerCallback: IntersectionObserverCallback;
  let disconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    disconnectSpy = vi.fn();
    vi.stubGlobal('IntersectionObserver', class IntersectionObserverMock {
      readonly root: Element | Document | null;
      readonly rootMargin = '0px';
      readonly thresholds = [0, 1];

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observerCallback = callback;
        this.root = options?.root ?? null;
      }

      disconnect = disconnectSpy;
      observe = vi.fn();
      takeRecords = () => [];
      unobserve = vi.fn();
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('docks the same header only after its sentinel crosses the scroll root', () => {
    const scrollRoot = document.createElement('div');
    const scrollRootRef = createRef<HTMLDivElement>();
    scrollRootRef.current = scrollRoot;

    act(() => {
      root.render(
        <StickySectionHeader scrollRootRef={scrollRootRef}>
          <button type="button" data-testid="session-filter">Filter</button>
        </StickySectionHeader>,
      );
    });

    const stickyHeader = container.querySelector<HTMLElement>(
      '[data-testid="nav-sessions-sticky-header"]',
    );
    expect(stickyHeader?.dataset.bitfunState).toBeUndefined();
    expect(container.querySelectorAll('[data-testid="session-filter"]')).toHaveLength(1);

    act(() => {
      observerCallback([
        {
          boundingClientRect: { top: 20 } as DOMRectReadOnly,
          intersectionRatio: 1,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: true,
          rootBounds: { top: 10 } as DOMRectReadOnly,
          target: container.querySelector('.bitfun-nav-panel__sticky-section-sentinel')!,
          time: 0,
        },
      ], {} as IntersectionObserver);
    });
    expect(stickyHeader?.dataset.bitfunState).toBeUndefined();

    act(() => {
      observerCallback([
        {
          boundingClientRect: { top: 9 } as DOMRectReadOnly,
          intersectionRatio: 0,
          intersectionRect: {} as DOMRectReadOnly,
          isIntersecting: false,
          rootBounds: { top: 10 } as DOMRectReadOnly,
          target: container.querySelector('.bitfun-nav-panel__sticky-section-sentinel')!,
          time: 1,
        },
      ], {} as IntersectionObserver);
    });
    expect(stickyHeader?.dataset.bitfunState).toBe('stuck');
    expect(stickyHeader?.classList.contains('is-stuck')).toBe(true);
    expect(container.querySelectorAll('[data-testid="session-filter"]')).toHaveLength(1);
  });

  it('disconnects its observer on unmount', () => {
    const scrollRootRef = createRef<HTMLDivElement>();
    scrollRootRef.current = document.createElement('div');

    act(() => root.render(
      <StickySectionHeader scrollRootRef={scrollRootRef}>Sessions</StickySectionHeader>,
    ));
    act(() => root.unmount());

    expect(disconnectSpy).toHaveBeenCalledOnce();
    root = createRoot(container);
  });

  it('clips covered rows on scroll and resize, then restores them on return and unmount', () => {
    let onResize: ResizeObserverCallback;
    const disconnectResize = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { onResize = callback; }
      observe = vi.fn();
      disconnect = disconnectResize;
    });
    const scrollRootRef = createRef<HTMLDivElement>();
    scrollRootRef.current = document.createElement('div');
    const contentRef = createRef<HTMLDivElement>();
    const content = document.createElement('div');
    contentRef.current = content;
    let contentTop = 100;
    vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, contentTop, 300, 1000));

    act(() => root.render(
      <StickySectionHeader scrollRootRef={scrollRootRef} contentRef={contentRef}>Sessions</StickySectionHeader>,
    ));
    const header = container.querySelector<HTMLElement>('[data-testid="nav-sessions-sticky-header"]')!;
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 22));
    expect(content.style.clipPath).toBe('');

    contentTop = -20;
    act(() => scrollRootRef.current!.dispatchEvent(new Event('scroll')));
    expect(content.style.clipPath).toBe('inset(42px 0 0)');

    contentTop = -40;
    act(() => onResize!([], {} as ResizeObserver));
    expect(content.style.clipPath).toBe('inset(62px 0 0)');

    contentTop = 100;
    act(() => scrollRootRef.current!.dispatchEvent(new Event('scroll')));
    expect(content.style.clipPath).toBe('');

    contentTop = -20;
    act(() => scrollRootRef.current!.dispatchEvent(new Event('scroll')));
    act(() => root.unmount());
    expect(content.style.clipPath).toBe('');
    expect(disconnectResize).toHaveBeenCalledOnce();
    act(() => scrollRootRef.current!.dispatchEvent(new Event('scroll')));
    expect(content.style.clipPath).toBe('');
    root = createRoot(container);
  });
});
