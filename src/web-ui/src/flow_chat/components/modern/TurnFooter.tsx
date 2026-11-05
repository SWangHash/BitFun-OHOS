import type { ReactNode } from 'react';
import { useFlowChatReaderValue } from '../../timeline/readerState';

/** Only the footer subscribes; pointer movement never reprojects the transcript. */
export function TurnFooter({ turnId, isLatestTurn, ready, children }: {
  turnId: string;
  isLatestTurn: boolean;
  ready: boolean;
  children: ReactNode;
}) {
  const [interacting] = useFlowChatReaderValue(`interaction:${turnId}`, false);
  return <div
    className={`model-round-item__footer${ready ? '' : ' model-round-item__footer--pending'}`}
    data-bitfun-product-component="model-round-item"
    data-bitfun-product-part="footer"
    data-bitfun-state={ready ? undefined : 'pending'}
    data-footer-reveal={isLatestTurn || interacting ? 'visible' : 'hover'}
    aria-hidden={!ready}
  >{children}</div>;
}
