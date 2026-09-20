import React, { forwardRef, Suspense, useMemo } from 'react';
import type {
  TerminalOutputRendererHandle,
  TerminalOutputRendererProps,
} from './TerminalOutputRenderer';
import {
  buildTerminalOutputFallbackModel,
  composeGuardedTerminalOutput,
  guardTerminalOutput,
  type TerminalOutputFallbackModel,
} from './terminalOutputPresentation';

const DeferredTerminalOutputRenderer = React.lazy(() =>
  import('./TerminalOutputRenderer').then((module) => ({
    default: module.TerminalOutputRenderer,
  }))
);

export interface LazyTerminalOutputRendererProps extends TerminalOutputRendererProps {
  /** Composes the placeholder shown instead of binary output. */
  binarySuppressedText?: (totalChars: number) => string;
  /** Composes the marker appended to truncated output. */
  truncatedMarkerText?: (shownChars: number) => string;
}

export function TerminalOutputFallback({
  className,
  content,
  minHeight,
  maxHeight,
  maxRows,
}: Pick<TerminalOutputRendererProps, 'className' | 'content' | 'minHeight' | 'maxHeight' | 'maxRows'>) {
  const fallback = buildTerminalOutputFallbackModel(content, { minHeight, maxHeight, maxRows });

  return (
    <pre
      className={['terminal-output-pre', className].filter(Boolean).join(' ')}
      style={{
        height: `${fallback.height}px`,
        maxHeight: `${fallback.height}px`,
        overflow: 'hidden',
      }}
    >
      {fallback.content}
    </pre>
  );
}

export const LazyTerminalOutputRenderer = forwardRef<
  TerminalOutputRendererHandle,
  LazyTerminalOutputRendererProps
>((props, ref) => {
  const { binarySuppressedText, truncatedMarkerText } = props;
  const guard = useMemo(() => guardTerminalOutput(props.content), [props.content]);
  const guardedContent = useMemo(
    () => composeGuardedTerminalOutput(guard, binarySuppressedText, truncatedMarkerText),
    [guard, binarySuppressedText, truncatedMarkerText],
  );

  const initialFallback = useMemo<TerminalOutputFallbackModel>(
    () => buildTerminalOutputFallbackModel(guardedContent, {
      minHeight: props.minHeight,
      maxHeight: props.maxHeight,
      maxRows: props.maxRows,
    }),
    [guardedContent, props.maxHeight, props.maxRows, props.minHeight],
  );

  return (
    <Suspense
      fallback={(
        <TerminalOutputFallback
          content={guardedContent}
          className={props.className}
          minHeight={props.minHeight}
          maxHeight={props.maxHeight}
          maxRows={props.maxRows}
        />
      )}
    >
      <DeferredTerminalOutputRenderer
        {...props}
        content={guardedContent}
        initialFallback={initialFallback}
        ref={ref}
      />
    </Suspense>
  );
});

LazyTerminalOutputRenderer.displayName = 'LazyTerminalOutputRenderer';

export type {
  TerminalOutputRendererHandle,
  TerminalOutputRendererProps,
};
