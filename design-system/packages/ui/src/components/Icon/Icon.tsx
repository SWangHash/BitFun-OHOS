import {
  forwardRef,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import {
  AppWindow,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Blocks,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleCheck,
  Clock,
  Command,
  Copy,
  Ellipsis,
  Eye,
  Files,
  Folder,
  GitCommitHorizontal,
  Globe,
  Image,
  Info,
  Link,
  ListFilter,
  LoaderCircle,
  MessageCircle,
  MessageSquarePlus,
  MessageSquareText,
  MessagesSquare,
  Mic,
  Monitor,
  Palette,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  SlidersVertical,
  Sparkles,
  Star,
  Store,
  Terminal,
  Trash2,
  Upload,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { classNames } from "../../internal/classNames";
import gitUrl from "./assets/git.svg";
import creativeUrl from "./assets/creative.svg";
import ultimateUrl from "./assets/ultimate.svg";
import standardUrl from "./assets/standard.svg";
import minimalUrl from "./assets/minimal.svg";
import styles from "./Icon.module.css";

export const iconNames = [
  "arrow-down",
  "unselected",
  "chevron-left",
  "selected",
  "delete",
  "waitlist-message",
  "creative",
  "ultimate",
  "standard",
  "minimal",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-up-right",
  "bell",
  "browser",
  "check-circle",
  "check-fill",
  "check-line",
  "chevron-down",
  "chevron-right",
  "chevron-up",
  "circle",
  "clock",
  "command-mac",
  "commit",
  "device-mac",
  "download",
  "duplicate",
  "edit",
  "extension",
  "eye",
  "files",
  "filter",
  "floating-window",
  "folder",
  "gear",
  "git",
  "image",
  "info",
  "level",
  "link",
  "mic",
  "mini-app",
  "more",
  "palette",
  "pin",
  "plus",
  "progress-25",
  "refresh",
  "search",
  "session",
  "settings",
  "show-session",
  "side-chat",
  "sidebar-left",
  "sidebar-right",
  "spark",
  "star",
  "store",
  "terminal",
  "thinking",
  "turn",
  "upload",
  "user",
  "xmark",
] as const;

/** Legacy names remain renderable; new previews use the canonical catalog. */
export const iconAliases = { download: "arrow-down", circle: "unselected" } as const;
export const canonicalIconNames = iconNames.filter(name => name !== "turn" && !(name in iconAliases)).sort();

export type IconName = (typeof iconNames)[number];
export type IconSize = "2xs" | "xs" | "sm" | "md" | "lg";
export type IconTone =
  | "inherit"
  | "primary"
  | "secondary"
  | "muted"
  | "disabled"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type IconSource =
  | { glyph: LucideIcon; name?: never }
  | { glyph?: never; name: IconName };

// Only the four harness modes and Git branch retain their authored artwork.
const iconSources: Partial<Record<IconName, string>> = {
  creative: creativeUrl,
  ultimate: ultimateUrl,
  standard: standardUrl,
  minimal: minimalUrl,
  git: gitUrl,
};

const lineGlyphs = {
  "arrow-down": ArrowDown,
  "unselected": Circle,
  "chevron-left": ChevronLeft,
  "selected": CircleCheck,
  "delete": Trash2,
  "waitlist-message": MessageSquareText,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-up-right": ArrowUpRight,
  "bell": Bell,
  "browser": Globe,
  "check-circle": CircleCheck,
  "check-fill": CircleCheck,
  "check-line": Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "circle": Circle,
  "clock": Clock,
  "command-mac": Command,
  "commit": GitCommitHorizontal,
  "device-mac": Monitor,
  "download": ArrowDown,
  "duplicate": Copy,
  "edit": Pencil,
  "extension": Puzzle,
  "eye": Eye,
  "files": Files,
  "filter": ListFilter,
  "floating-window": AppWindow,
  "folder": Folder,
  "gear": Settings,
  "image": Image,
  "info": Info,
  "level": SlidersVertical,
  "link": Link,
  "mic": Mic,
  "mini-app": Blocks,
  "more": Ellipsis,
  "palette": Palette,
  "pin": Pin,
  "plus": Plus,
  "progress-25": LoaderCircle,
  "refresh": RefreshCw,
  "search": Search,
  "session": MessageCircle,
  "settings": SlidersHorizontal,
  "show-session": MessagesSquare,
  "side-chat": MessageSquarePlus,
  "sidebar-left": PanelLeft,
  "sidebar-right": PanelRight,
  "spark": Sparkles,
  "star": Star,
  "store": Store,
  "terminal": Terminal,
  "thinking": Brain,
  "turn": Circle,
  "upload": Upload,
  "user": User,
  "xmark": X,
} satisfies Record<Exclude<IconName, "creative" | "ultimate" | "standard" | "minimal" | "git">, LucideIcon>;

interface IconBaseProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "aria-label" | "children"> {
  label?: string;
  size?: IconSize;
  tone?: IconTone;
}

export type IconProps = IconBaseProps & IconSource;

const LINE_ICON_STROKE_WIDTH = 1.6;

export const Icon = forwardRef<HTMLSpanElement, IconProps>(function Icon({
  className,
  glyph: LineGlyph,
  label,
  name,
  size = "lg",
  style,
  tone = "inherit",
  ...props
}, ref) {
  const asset = name ? iconSources[name] : undefined;
  const catalogSource = asset ? `url("${asset}")` : undefined;
  const Glyph = LineGlyph ?? (name && name in lineGlyphs ? lineGlyphs[name as keyof typeof lineGlyphs] : undefined);
  const iconStyle: CSSProperties = catalogSource
    ? {
        ...style,
        WebkitMaskImage: catalogSource,
        maskImage: catalogSource,
      }
    : style ?? {};

  return (
    <span
      {...props}
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className={classNames(styles.icon, className)}
      data-openbitfun-component="icon"
      data-openbitfun-name={name}
      data-openbitfun-source={asset ? "catalog" : "line"}
      data-openbitfun-artwork={name && name !== "progress-25" && name !== "turn" ? "monochrome" : undefined}
      data-openbitfun-tone={tone}
      data-size={size}
      ref={ref}
      role={label ? "img" : undefined}
      style={iconStyle}
    >
      {Glyph ? (
        <Glyph
          aria-hidden="true"
          focusable="false"
          strokeWidth={LINE_ICON_STROKE_WIDTH}
        />
      ) : null}
    </span>
  );
});
