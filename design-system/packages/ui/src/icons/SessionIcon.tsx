import { forwardRef, type SVGProps } from "react";
import { MessageCircle } from "lucide-react";

export interface SessionIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

/** SVG-compatible entry point for the same Lucide glyph as Icon name="session". */
export const SessionIcon = forwardRef<SVGSVGElement, SessionIconProps>(function SessionIcon({
  height, size = 24, width, style, ...props
}, ref) {
  return <MessageCircle {...props} ref={ref} width={width ?? size} height={height ?? size}
    strokeWidth={1.6} style={{ opacity: "var(--openbitfun-opacity-icon-artwork)", ...style }} />;
});
