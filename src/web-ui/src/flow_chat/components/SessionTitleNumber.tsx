import './SessionTitleNumber.scss';

/** Auxiliary identity stays outside the title's overflow and edit slots. */
export function SessionTitleNumber({ number }: { number?: string }) {
  return number ? (
    <span
      className="bitfun-session-title-number"
      data-bitfun-component="session-title-number"
      data-bitfun-part="root"
    >{number}</span>
  ) : null;
}
