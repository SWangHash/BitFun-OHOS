import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import RustModule from 'libbitfun_desktop_lib.so';
import { DesktopCardActionPayload, DesktopCardWindowService } from '../services/DesktopCardWindowService';

const DOMAIN: number = 0x0000;
const TAG: string = 'BitFunDesktopCardPage';

/**
 * Card material switch.
 *
 * `BACKGROUND_*` asks the compositor to sample what is behind the window. The
 * card window is a transparent subwindow, so that is normally the main window's
 * content; if a platform build cannot sample it, flip this to `false` to keep
 * the opaque card surface instead. Never ship a translucent surface without a
 * material: the text would sit on whatever happens to be behind the window.
 */
const CARD_MATERIAL_ENABLED: boolean = false;
const CARD_MATERIAL_STYLE: BlurStyle = BlurStyle.BACKGROUND_THICK;
/** How much of the theme surface stays on top of the material. */
const CARD_TINT_OPACITY: number = 0.72;

interface CardCountdownView {
  targetAtMs: number;
  startedAtMs?: number;
  message?: string;
}

interface CardChecklistItemView {
  id: string;
  text: string;
  done: boolean;
}

interface CardProgressView {
  value?: number;
  max?: number;
  status?: string;
}

interface CardMetricView {
  label: string;
  value?: Object;
  format?: string;
  digits?: number;
  currency?: string;
  prefix?: string;
  suffix?: string;
  tone?: string;
  hint?: string;
  emphasis: boolean;
}

interface CardMetricsView {
  layout: string;
  items: CardMetricView[];
}

interface CardChartPointView {
  label: string;
  value: number;
  tone?: string;
  hint?: string;
  merged: boolean;
}

interface CardChartView {
  style: string;
  points: CardChartPointView[];
  sum: number;
  total?: number;
  remainder: number;
  scale: number;
  format?: string;
  digits?: number;
  currency?: string;
  prefix?: string;
  suffix?: string;
  labelFormat?: string;
  caption?: string;
  remainderLabel: string;
}

interface CardCronView {
  name: string;
  enabled: boolean;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: string;
  lastError?: string;
}

interface CardFooterView {
  state?: string;
  fetchedAtMs: number;
  text?: string;
}

interface CardStackingView {
  alwaysOnTop: boolean;
  desktopPinned: boolean;
  pinFailure: boolean;
}

interface DesktopCardView {
  cardId: string;
  title: string;
  subtitle?: string;
  icon?: string;
  tone: string;
  kind: string;
  unsupported?: string;
  visible: boolean;
  link?: string;
  countdown?: CardCountdownView;
  checklist?: CardChecklistItemView[];
  note?: string;
  progress?: CardProgressView;
  metrics?: CardMetricsView;
  chart?: CardChartView;
  cronJobId?: string;
  cron?: CardCronView;
  customHtml?: string;
  customData?: Object;
  footer?: CardFooterView;
  stacking: CardStackingView;
  sourceSessionId?: string;
  updatedAtMs: number;
}

interface CardPalette {
  surface: string;
  surfaceRaised: string;
  text: string;
  textSecondary: string;
  border: string;
  track: string;
}

interface CustomCardPayloadCard {
  id: string;
  title: string;
  subtitle?: string;
}

interface CustomCardPayload {
  data: Object | null;
  card: CustomCardPayloadCard;
  error?: string;
}

const EMPTY_COUNTDOWN: CardCountdownView = { targetAtMs: 0 };
const EMPTY_PROGRESS: CardProgressView = {};
const EMPTY_METRICS: CardMetricsView = { layout: 'list', items: [] };
const EMPTY_CHART: CardChartView = {
  style: 'bar',
  points: [],
  sum: 0,
  remainder: 0,
  scale: 0,
  remainderLabel: '',
};
const EMPTY_CRON: CardCronView = { name: '', enabled: false };
const EMPTY_FOOTER: CardFooterView = { fetchedAtMs: 0 };

const DARK_PALETTE: CardPalette = {
  surface: '#F21E1E22',
  surfaceRaised: '#26FFFFFF',
  text: '#F2FFFFFF',
  textSecondary: '#99FFFFFF',
  border: '#33FFFFFF',
  track: '#1FFFFFFF',
};

const LIGHT_PALETTE: CardPalette = {
  surface: '#F7FFFFFF',
  surfaceRaised: '#08000000',
  text: '#E6000000',
  textSecondary: '#99000000',
  border: '#1F000000',
  track: '#0D000000',
};

function toneColor(tone: string | undefined): string {
  switch (tone) {
    case 'success':
      return '#30D158';
    case 'warning':
      return '#FF9F0A';
    case 'danger':
      return '#FF453A';
    case 'info':
      return '#32ADE6';
    case 'neutral':
      return '#8E8E93';
    default:
      return '#0A84FF';
  }
}

function toneShade(tone: string | undefined, shade: number): string {
  if (tone !== undefined) {
    return toneColor(tone);
  }
  const shades: string[] = ['#0A84FF', '#409CFF', '#74B4FF', '#A8CCFF', '#CFE3FF', '#E8F1FF'];
  return shades[shade % shades.length];
}

function iconGlyph(icon: string | undefined): string {
  switch (icon) {
    case 'alarm':
      return '⏰';
    case 'star':
      return '★';
    case 'sun':
      return '☀';
    case 'trending-up':
      return '↗';
    case 'git-pull-request':
      return '⇄';
    case 'calendar':
      return '▤';
    case 'list':
      return '☰';
    case 'note':
      return '✎';
    case 'rocket':
      return '➤';
    case 'server':
      return '▣';
    case 'hard-drive':
      return '▤';
    case 'pie-chart':
      return '◔';
    case 'chart':
      return '▁▄█';
    default:
      return '◆';
  }
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

function isChineseLocale(locale: string): boolean {
  return locale.indexOf('zh') === 0;
}

function formatNumber(value: number, locale: string, style: string | undefined, digits: number | undefined, currency: string | undefined): string {
  try {
    if (style === 'percent') {
      if (digits === undefined) {
        return new Intl.NumberFormat(locale, { style: 'percent' }).format(value / 100);
      }
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value / 100);
    }
    if (style === 'currency') {
      const code = currency !== undefined && currency.length > 0 ? currency : 'USD';
      if (digits === undefined) {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(value);
      }
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    }
    if (digits === undefined) {
      return new Intl.NumberFormat(locale).format(value);
    }
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch (error) {
    return `${value}`;
  }
}

function toNumber(value: Object | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length === 0) {
      return null;
    }
    const parsed = Number(text);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toTimestampMs(value: Object | undefined): number | null {
  const numeric = toNumber(value);
  if (numeric !== null) {
    return Math.abs(numeric) < 100000000000 ? numeric * 1000 : numeric;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function relativeTime(ms: number, locale: string): string {
  const deltaMs = ms - Date.now();
  const future = deltaMs >= 0;
  const seconds = Math.round(Math.abs(deltaMs) / 1000);
  const chinese = isChineseLocale(locale);
  let amount = seconds;
  let unit = 'second';
  if (seconds >= 86400) {
    amount = Math.round(seconds / 86400);
    unit = 'day';
  } else if (seconds >= 3600) {
    amount = Math.round(seconds / 3600);
    unit = 'hour';
  } else if (seconds >= 60) {
    amount = Math.round(seconds / 60);
    unit = 'minute';
  }
  let unitText = unit;
  if (chinese) {
    if (unit === 'second') {
      unitText = '秒';
    } else if (unit === 'minute') {
      unitText = '分钟';
    } else if (unit === 'hour') {
      unitText = '小时';
    } else {
      unitText = '天';
    }
    return future ? `${amount} ${unitText}后` : `${amount} ${unitText}前`;
  }
  if (amount === 1) {
    return future ? `in 1 ${unit}` : `1 ${unit} ago`;
  }
  return future ? `in ${amount} ${unit}s` : `${amount} ${unit}s ago`;
}

function formatDateTime(ms: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ms);
  } catch (error) {
    return new Date(ms).toISOString();
  }
}

function formatMetricValue(item: CardMetricView, locale: string): string {
  const raw = item.value;
  if (raw === undefined || raw === null || raw === '') {
    return '—';
  }
  let text: string;
  if (item.format === 'number') {
    const numeric = toNumber(raw);
    text = numeric === null ? String(raw) : formatNumber(numeric, locale, 'number', item.digits, item.currency);
  } else if (item.format === 'percent') {
    const numeric = toNumber(raw);
    text = numeric === null ? String(raw) : formatNumber(numeric, locale, 'percent', item.digits, item.currency);
  } else if (item.format === 'currency') {
    const numeric = toNumber(raw);
    text = numeric === null ? String(raw) : formatNumber(numeric, locale, 'currency', item.digits, item.currency);
  } else if (item.format === 'datetime') {
    const ms = toTimestampMs(raw);
    text = ms === null ? String(raw) : formatDateTime(ms, locale);
  } else if (item.format === 'relativeTime') {
    const ms = toTimestampMs(raw);
    text = ms === null ? String(raw) : relativeTime(ms, locale);
  } else {
    text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
  return `${item.prefix ?? ''}${text}${item.suffix ?? ''}`;
}

function chartValueText(chart: CardChartView, value: number, locale: string): string {
  const formatted = formatNumber(value, locale, chart.format ?? 'number', chart.digits, chart.currency);
  return `${chart.prefix ?? ''}${formatted}${chart.suffix ?? ''}`;
}

function chartShare(value: number, scale: number): number {
  if (scale <= 0) {
    return 0;
  }
  return Math.min(Math.max(value / scale, 0), 1);
}

function chartPercentText(value: number, scale: number): string {
  return `${Math.round(chartShare(value, scale) * 100)}%`;
}

function labelText(chart: CardChartView, raw: string, locale: string): string {
  const format = chart.labelFormat;
  if (format === undefined || raw.trim().length === 0) {
    return raw;
  }
  const ms = toTimestampMs(raw);
  if (ms === null) {
    return raw;
  }
  try {
    if (format === 'date') {
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ms);
    }
    if (format === 'time') {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ms);
    }
    if (format === 'weekday') {
      return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(ms);
    }
    if (format === 'datetime') {
      return formatDateTime(ms, locale);
    }
  } catch (error) {
    return raw;
  }
  return raw;
}

function sendAction(action: string, payload: DesktopCardActionPayload): void {
  try {
    RustModule.desktopCardOhosAction(action, JSON.stringify(payload));
  } catch (error) {
    hilog.warn(DOMAIN, TAG, `desktopCardOhosAction failed: ${(error as BusinessError).message}`);
  }
}

const CUSTOM_BRIDGE_SCRIPT: string = `(function () {
  var handlers = [];
  var latest = null;
  function deliver(handler) {
    try { handler(latest); } catch (error) { console.error(error); }
  }
  window.bitfunCard = {
    onData: function (handler) {
      if (typeof handler !== 'function') return;
      handlers.push(handler);
      if (latest) deliver(handler);
    },
    openLink: function (url) {
      if (window.bitfunCardHost) window.bitfunCardHost.openLink(String(url));
    }
  };
  window.__bitfunCardApply = function (payload) {
    latest = payload;
    handlers.forEach(deliver);
  };
})();`;

const CUSTOM_CSS: string = `* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: auto; }
body { font-family: sans-serif; font-size: 13px; line-height: 1.45; }
a { color: #0A84FF; text-decoration: none; }
img, svg, canvas { max-width: 100%; height: auto; }
.bitfun-card-stack { display: flex; flex-direction: column; gap: 8px; }
.bitfun-card-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.bitfun-card-value { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.bitfun-card-muted { opacity: 0.7; font-size: 12px; }
.bitfun-card-truncate { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bitfun-card-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.bitfun-card-item { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px; border-radius: 6px; }
.bitfun-card-item > .bitfun-card-truncate { flex: 1 1 auto; }
.bitfun-card-list > .bitfun-card-item + .bitfun-card-item { border-top: 1px solid rgba(128, 128, 128, 0.25); }
.bitfun-card-item[role='link'], .bitfun-card-item[data-url] { cursor: pointer; }
.bitfun-card-good { color: #30D158; }
.bitfun-card-warn { color: #FF9F0A; }
.bitfun-card-bad { color: #FF453A; }`;

class DesktopCardCustomBridge {
  private readonly cardId: string;

  constructor(cardId: string) {
    this.cardId = cardId;
  }

  openLink(url: string): void {
    sendAction('openLink', { cardId: this.cardId, url: url });
  }
}

@Entry
@Component
struct DesktopCardPage {
  @LocalStorageProp('cardId') @Watch('onCardChanged') cardId: string = '';
  @LocalStorageProp('card') @Watch('onCardChanged') cardJson: string = '';
  @State private card: DesktopCardView | null = null;
  @State private now: number = Date.now();
  @State private dark: boolean = false;
  @State private locale: string = 'en-US';
  @State private customReady: boolean = false;
  /** Material light-up intensity, pulsed when the card receives new data. */
  @State private glow: number = 0;
  private timerId: number = -1;
  private glowTimerId: number = -1;
  private customBridge: DesktopCardCustomBridge | null = null;
  private readonly donutSettings: RenderingContextSettings = new RenderingContextSettings(true);
  private readonly donutContext: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.donutSettings);
  private readonly lineSettings: RenderingContextSettings = new RenderingContextSettings(true);
  private readonly lineContext: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.lineSettings);
  private readonly webController: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    try {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      this.dark = context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      const language = context.config.language;
      this.locale = language !== undefined && language.length > 0 ? language : 'en-US';
    } catch (error) {
      this.dark = false;
    }
    this.applyCardJson();
    this.startTimer();
  }

  aboutToDisappear(): void {
    this.stopTimer();
    if (this.glowTimerId !== -1) {
      clearTimeout(this.glowTimerId);
      this.glowTimerId = -1;
    }
  }

  onCardChanged(): void {
    this.applyCardJson();
    this.startTimer();
    this.pulseGlow();
  }

  /**
   * Short light-up pulse so a refreshed card is visible without a layout jump.
   * It is intentionally subtle: the card updates on its own schedule, and a
   * strong flash would be distracting next to the main window.
   */
  private pulseGlow(): void {
    if (!CARD_MATERIAL_ENABLED) {
      return;
    }
    if (this.glowTimerId !== -1) {
      clearTimeout(this.glowTimerId);
      this.glowTimerId = -1;
    }
    animateTo({ duration: 180, curve: Curve.EaseOut }, () => {
      this.glow = 0.35;
    });
    this.glowTimerId = setTimeout(() => {
      this.glowTimerId = -1;
      animateTo({ duration: 500, curve: Curve.EaseInOut }, () => {
        this.glow = 0;
      });
    }, 220);
  }

  private palette(): CardPalette {
    return this.dark ? DARK_PALETTE : LIGHT_PALETTE;
  }

  private applyCardJson(): void {
    if (this.cardJson.length === 0) {
      return;
    }
    try {
      const parsed = JSON.parse(this.cardJson) as DesktopCardView;
      this.card = parsed;
      if (parsed.kind === 'custom') {
        this.customBridge = new DesktopCardCustomBridge(parsed.cardId);
        this.pushCustomData();
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `card view parse failed: ${(error as BusinessError).message}`);
    }
  }

  private kind(): string {
    return this.card?.kind ?? '';
  }

  private title(): string {
    return this.card?.title ?? '';
  }

  private subtitle(): string {
    return this.card?.subtitle ?? '';
  }

  private hasSubtitle(): boolean {
    return this.subtitle().length > 0;
  }

  private tone(): string {
    return this.card?.tone ?? 'accent';
  }

  private link(): string {
    return this.card?.link ?? '';
  }

  private unsupported(): string {
    return this.card?.unsupported ?? '';
  }

  private countdown(): CardCountdownView {
    return this.card?.countdown ?? EMPTY_COUNTDOWN;
  }

  private checklist(): CardChecklistItemView[] {
    return this.card?.checklist ?? [];
  }

  private progress(): CardProgressView {
    return this.card?.progress ?? EMPTY_PROGRESS;
  }

  private metrics(): CardMetricsView {
    return this.card?.metrics ?? EMPTY_METRICS;
  }

  private chart(): CardChartView {
    return this.card?.chart ?? EMPTY_CHART;
  }

  private cron(): CardCronView {
    return this.card?.cron ?? EMPTY_CRON;
  }

  private note(): string {
    return this.card?.note ?? '';
  }

  private customHtml(): string {
    return this.card?.customHtml ?? '';
  }

  private footer(): CardFooterView {
    return this.card?.footer ?? EMPTY_FOOTER;
  }

  private hasFooter(): boolean {
    return this.card?.footer !== undefined;
  }

  private startTimer(): void {
    if (this.kind() !== 'countdown' || this.timerId !== -1) {
      return;
    }
    this.timerId = setInterval(() => {
      this.now = Date.now();
      if (this.countdown().targetAtMs <= this.now) {
        this.stopTimer();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerId !== -1) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private send(action: string): void {
    const card = this.card;
    if (card === null) {
      return;
    }
    sendAction(action, { cardId: card.cardId });
  }

  private toggleChecklist(itemId: string, done: boolean): void {
    const card = this.card;
    if (card === null) {
      return;
    }
    sendAction('checklist', { cardId: card.cardId, itemId: itemId, done: done });
  }

  private openLink(): void {
    const card = this.card;
    if (card === null || card.link === undefined || card.link.length === 0) {
      return;
    }
    sendAction('openLink', { cardId: card.cardId, url: card.link });
  }

  private startMoving(): void {
    const card = this.card;
    const service = DesktopCardWindowService.getInstance();
    if (card === null || service === null) {
      return;
    }
    service.startMoving(card.cardId);
  }

  private unsupportedText(): string {
    if (this.unsupported() === 'chartStyle') {
      return isChineseLocale(this.locale) ? '此卡片使用了当前版本无法绘制的图表样式。' : 'This card uses a chart style this version cannot draw.';
    }
    return isChineseLocale(this.locale) ? '此卡片由更高版本创建，当前版本无法显示。' : 'This card was created by a newer version and cannot be shown.';
  }

  private countdownDue(): boolean {
    return this.countdown().targetAtMs > 0 && this.countdown().targetAtMs <= this.now;
  }

  private countdownClock(): string {
    const target = this.countdown().targetAtMs;
    const remaining = Math.max(target - this.now, 0);
    const totalSeconds = Math.ceil(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = hours > 0 || days > 0
      ? `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
      : `${pad2(minutes)}:${pad2(seconds)}`;
    return days > 0 ? `${days}d ${clock}` : clock;
  }

  private countdownProgress(): number {
    const countdown = this.countdown();
    if (countdown.startedAtMs === undefined) {
      return 0;
    }
    const span = countdown.targetAtMs - countdown.startedAtMs;
    if (span <= 0) {
      return 0;
    }
    return Math.min(Math.max((this.now - countdown.startedAtMs) / span, 0), 1);
  }

  private progressMax(): number {
    const max = this.progress().max;
    return max !== undefined && max > 0 ? max : 100;
  }

  private progressRatio(): number {
    const value = this.progress().value;
    if (value === undefined) {
      return 0;
    }
    return Math.min(Math.max(value / this.progressMax(), 0), 1);
  }

  private progressPercentLabel(): string {
    if (this.progress().value === undefined) {
      return '—';
    }
    return chartPercentText(this.progress().value ?? 0, this.progressMax());
  }

  private buildCustomDocument(): string {
    const theme = this.palette();
    const mode = this.dark ? 'dark' : 'light';
    return `<!DOCTYPE html><html data-mode="${mode}"><head><meta charset="utf-8" />` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; media-src data: https:" />` +
      `<style>:root{color-scheme:${mode};}${CUSTOM_CSS}body{color:${theme.text};}</style>` +
      `<script>${CUSTOM_BRIDGE_SCRIPT}</script></head><body>${this.customHtml()}</body></html>`;
  }

  private customPayloadJson(): string {
    const card = this.card;
    if (card === null) {
      return '{"data":null,"card":{"id":"","title":""}}';
    }
    const payload: CustomCardPayload = {
      data: card.customData ?? null,
      card: { id: card.cardId, title: card.title, subtitle: card.subtitle },
      error: card.footer?.state === 'error' ? card.footer.text : undefined,
    };
    return JSON.stringify(payload).replace(/</g, '\\u003c');
  }

  private pushCustomData(): void {
    if (!this.customReady) {
      return;
    }
    try {
      this.webController.runJavaScript(`window.__bitfunCardApply && window.__bitfunCardApply(${this.customPayloadJson()})`);
    } catch (error) {
      hilog.debug(DOMAIN, TAG, `custom card data push failed: ${(error as BusinessError).message}`);
    }
  }

  private attachCustomWeb(): void {
    try {
      this.webController.loadData(this.buildCustomDocument(), 'text/html', 'UTF-8');
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `custom card load failed: ${(error as BusinessError).message}`);
    }
  }

  private labelStep(): number {
    return Math.max(Math.ceil(this.chart().points.length / 8), 1);
  }

  private drawDonut(): void {
    const chart = this.chart();
    const size = this.donutContext.width;
    const center = size / 2;
    const radius = center - 10;
    this.donutContext.clearRect(0, 0, size, size);
    this.donutContext.lineWidth = 12;
    this.donutContext.strokeStyle = this.palette().track;
    this.donutContext.beginPath();
    this.donutContext.arc(center, center, radius, 0, Math.PI * 2);
    this.donutContext.stroke();
    let start = -Math.PI / 2;
    chart.points.forEach((point: CardChartPointView, index: number) => {
      const share = chartShare(point.value, chart.scale);
      if (share <= 0) {
        return;
      }
      const end = start + share * Math.PI * 2;
      this.donutContext.strokeStyle = toneShade(point.tone, index);
      this.donutContext.beginPath();
      this.donutContext.arc(center, center, radius, start, end);
      this.donutContext.stroke();
      start = end;
    });
  }

  private drawLine(): void {
    const chart = this.chart();
    const width = this.lineContext.width;
    const height = this.lineContext.height;
    this.lineContext.clearRect(0, 0, width, height);
    if (chart.points.length < 2) {
      return;
    }
    let min = chart.points[0].value;
    let max = chart.points[0].value;
    chart.points.forEach((point: CardChartPointView) => {
      min = Math.min(min, point.value);
      max = Math.max(max, point.value);
    });
    const span = max - min;
    this.lineContext.strokeStyle = toneColor(this.tone());
    this.lineContext.lineWidth = 2;
    this.lineContext.beginPath();
    chart.points.forEach((point: CardChartPointView, index: number) => {
      const x = (index / (chart.points.length - 1)) * width;
      const y = span > 0 ? height - 6 - ((point.value - min) / span) * (height - 12) : height / 2;
      if (index === 0) {
        this.lineContext.moveTo(x, y);
      } else {
        this.lineContext.lineTo(x, y);
      }
    });
    this.lineContext.stroke();
  }

  private cronStatusLabel(status: string): string {
    const chinese = isChineseLocale(this.locale);
    switch (status) {
      case 'ok':
        return chinese ? '成功' : 'Succeeded';
      case 'error':
        return chinese ? '失败' : 'Failed';
      case 'running':
        return chinese ? '运行中' : 'Running';
      case 'queued':
        return chinese ? '排队中' : 'Queued';
      case 'cancelled':
        return chinese ? '已取消' : 'Cancelled';
      default:
        return status;
    }
  }

  @Builder
  Header() {
    Row({ space: 8 }) {
      Text(iconGlyph(this.card?.icon))
        .fontSize(16)
        .fontColor(toneColor(this.tone()))
        .width(22)
        .textAlign(TextAlign.Center)
      Column({ space: 1 }) {
        Text(this.title())
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (this.hasSubtitle()) {
          Text(this.subtitle())
            .fontSize(11)
            .fontColor(this.palette().textSecondary)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .onClick(() => this.openLink())
      Text('↻')
        .fontSize(15)
        .fontColor(this.palette().textSecondary)
        .width(24)
        .height(24)
        .textAlign(TextAlign.Center)
        .onClick(() => this.send('refresh'))
      Text('✕')
        .fontSize(13)
        .fontColor(this.palette().textSecondary)
        .width(24)
        .height(24)
        .textAlign(TextAlign.Center)
        .onClick(() => this.send('hide'))
    }
    .width('100%')
    .padding({ left: 14, right: 10, top: 10, bottom: 6 })
    .gesture(
      PanGesture()
        .onActionStart(() => this.startMoving()),
    )
  }

  @Builder
  CountdownBody() {
    Column({ space: 8 }) {
      Text(this.countdownDue() ? (isChineseLocale(this.locale) ? '时间到' : 'Time is up') : this.countdownClock())
        .fontSize(28)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.countdownDue() ? toneColor('warning') : this.palette().text)
      if (this.countdown().message !== undefined) {
        Text(this.countdown().message ?? '')
          .fontSize(12)
          .fontColor(this.palette().textSecondary)
          .width('100%')
      }
      if (this.countdownDue()) {
        Row() {
          Text(isChineseLocale(this.locale) ? '关闭' : 'Dismiss')
            .fontSize(12)
            .fontColor(toneColor('accent'))
        }
        .height(28)
        .padding({ left: 12, right: 12 })
        .backgroundColor(this.palette().surfaceRaised)
        .borderRadius(8)
        .onClick(() => this.send('hide'))
      } else {
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width('100%')
            .height(4)
            .backgroundColor(this.palette().track)
            .borderRadius(2)
          Row()
            .width(`${(this.countdownProgress() * 100).toFixed(2)}%`)
            .height(4)
            .backgroundColor(toneColor(this.tone()))
            .borderRadius(2)
        }
        .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 14, right: 14, top: 4, bottom: 10 })
  }

  @Builder
  ChecklistBody() {
    if (this.checklist().length === 0) {
      Text(isChineseLocale(this.locale) ? '暂无条目' : 'No items')
        .fontSize(12)
        .fontColor(this.palette().textSecondary)
        .padding({ left: 14, right: 14, bottom: 10 })
    } else {
      Column({ space: 2 }) {
        ForEach(this.checklist(), (item: CardChecklistItemView) => {
          Row({ space: 8 }) {
            Toggle({ type: ToggleType.Checkbox, isOn: item.done })
              .selectedColor(toneColor(this.tone()))
              .onChange((checked: boolean) => this.toggleChecklist(item.id, checked))
            Text(item.text)
              .fontSize(12)
              .fontColor(item.done ? this.palette().textSecondary : this.palette().text)
              .decoration({ type: item.done ? TextDecorationType.LineThrough : TextDecorationType.None })
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .width('100%')
          .padding({ top: 2, bottom: 2 })
        }, (item: CardChecklistItemView) => item.id)
      }
      .width('100%')
      .padding({ left: 12, right: 12, bottom: 8 })
    }
  }

  @Builder
  ProgressBody() {
    Column({ space: 6 }) {
      Row() {
        Text(this.progressPercentLabel())
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text)
        Blank()
        if (this.progress().value !== undefined) {
          Text(`${this.progress().value} / ${this.progressMax()}`)
            .fontSize(11)
            .fontColor(this.palette().textSecondary)
        }
      }
      .width('100%')
      Stack({ alignContent: Alignment.Start }) {
        Row()
          .width('100%')
          .height(6)
          .backgroundColor(this.palette().track)
          .borderRadius(3)
        Row()
          .width(`${(this.progressRatio() * 100).toFixed(2)}%`)
          .height(6)
          .backgroundColor(toneColor(this.tone()))
          .borderRadius(3)
      }
      .width('100%')
      if (this.progress().status !== undefined) {
        Text(this.progress().status ?? '')
          .fontSize(11)
          .fontColor(this.palette().textSecondary)
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 14, right: 14, top: 4, bottom: 10 })
  }

  @Builder
  MetricsBody() {
    if (this.metrics().layout === 'grid') {
      Grid() {
        ForEach(this.metrics().items, (item: CardMetricView, index: number) => {
          GridItem() {
            Column({ space: 2 }) {
              Text(item.label)
                .fontSize(10)
                .fontColor(this.palette().textSecondary)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(formatMetricValue(item, this.locale))
                .fontSize(item.emphasis ? 18 : 14)
                .fontWeight(item.emphasis ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(item.tone !== undefined ? toneColor(item.tone) : this.palette().text)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ top: 3, bottom: 3 })
          }
        }, (item: CardMetricView, index: number) => `${item.label}-${index}`)
      }
      .columnsTemplate('1fr 1fr')
      .columnsGap(10)
      .rowsGap(2)
      .width('100%')
      .padding({ left: 14, right: 14, bottom: 8 })
      .scrollBar(BarState.Off)
    } else {
      Column({ space: 4 }) {
        ForEach(this.metrics().items, (item: CardMetricView, index: number) => {
          Row() {
            Text(item.label)
              .fontSize(11)
              .fontColor(this.palette().textSecondary)
              .maxLines(1)
              .layoutWeight(1)
            Text(formatMetricValue(item, this.locale))
              .fontSize(item.emphasis ? 18 : 13)
              .fontWeight(item.emphasis ? FontWeight.Medium : FontWeight.Normal)
              .fontColor(item.tone !== undefined ? toneColor(item.tone) : this.palette().text)
              .maxLines(1)
          }
          .width('100%')
          .padding({ top: 2, bottom: 2 })
        }, (item: CardMetricView, index: number) => `${item.label}-${index}`)
      }
      .width('100%')
      .padding({ left: 14, right: 14, bottom: 8 })
    }
  }

  @Builder
  BarChartBody() {
    Column({ space: 6 }) {
      ForEach(this.chart().points, (point: CardChartPointView, index: number) => {
        Column({ space: 2 }) {
          Row() {
            Text(labelText(this.chart(), point.label, this.locale))
              .fontSize(11)
              .fontColor(this.palette().text)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
            Text(chartValueText(this.chart(), point.value, this.locale))
              .fontSize(11)
              .fontColor(this.palette().textSecondary)
          }
          .width('100%')
          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(6)
              .backgroundColor(this.palette().track)
              .borderRadius(3)
            Row()
              .width(`${(chartShare(point.value, this.chart().scale) * 100).toFixed(2)}%`)
              .height(6)
              .backgroundColor(toneShade(point.tone, index))
              .borderRadius(3)
          }
          .width('100%')
          if (point.hint !== undefined) {
            Text(point.hint)
              .fontSize(10)
              .fontColor(this.palette().textSecondary)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }, (point: CardChartPointView, index: number) => `${point.label}-${index}`)
    }
    .width('100%')
    .padding({ left: 14, right: 14, bottom: 8 })
  }

  @Builder
  ColumnChartBody() {
    Column({ space: 4 }) {
      Row({ space: 2 }) {
        ForEach(this.chart().points, (point: CardChartPointView, index: number) => {
          Column() {
            Blank()
            Row()
              .width('100%')
              .height(`${(chartShare(point.value, this.chart().scale) * 100).toFixed(2)}%`)
              .backgroundColor(toneShade(point.tone, index))
              .borderRadius({ topLeft: 2, topRight: 2 })
          }
          .height(80)
          .layoutWeight(1)
          .justifyContent(FlexAlign.End)
        }, (point: CardChartPointView, index: number) => `col-${index}`)
      }
      .width('100%')
      .height(80)
      .alignItems(VerticalAlign.Bottom)
      Row({ space: 2 }) {
        ForEach(this.chart().points, (point: CardChartPointView, index: number) => {
          Text(index % this.labelStep() === 0
            ? labelText(this.chart(), point.label, this.locale)
            : '')
            .fontSize(9)
            .fontColor(this.palette().textSecondary)
            .layoutWeight(1)
            .textAlign(TextAlign.Center)
            .maxLines(1)
        }, (point: CardChartPointView, index: number) => `col-label-${index}`)
      }
      .width('100%')
    }
    .width('100%')
    .padding({ left: 14, right: 14, bottom: 8 })
  }

  @Builder
  StackedChartBody() {
    Column({ space: 6 }) {
      Row() {
        Text(chartValueText(this.chart(), this.chart().sum, this.locale))
          .fontSize(20)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.palette().text)
        if (this.chart().total !== undefined) {
          Text(` / ${chartValueText(this.chart(), this.chart().total ?? 0, this.locale)}`)
            .fontSize(11)
            .fontColor(this.palette().textSecondary)
        }
      }
      .width('100%')
      Row() {
        ForEach(this.chart().points, (point: CardChartPointView, index: number) => {
          Row()
            .width(`${(chartShare(point.value, this.chart().scale) * 100).toFixed(2)}%`)
            .height(10)
            .backgroundColor(toneShade(point.tone, index))
        }, (point: CardChartPointView, index: number) => `seg-${index}`)
        if (this.chart().remainder > 0) {
          Row()
            .width(`${(chartShare(this.chart().remainder, this.chart().scale) * 100).toFixed(2)}%`)
            .height(10)
            .backgroundColor(this.palette().track)
        }
      }
      .width('100%')
      .height(10)
      .borderRadius(5)
      .clip(true)
      Column({ space: 3 }) {
        ForEach(this.chart().points, (point: CardChartPointView, index: number) => {
          Row({ space: 6 }) {
            Row()
              .width(8)
              .height(8)
              .backgroundColor(toneShade(point.tone, index))
              .borderRadius(2)
            Text(labelText(this.chart(), point.label, this.locale))
              .fontSize(11)
              .fontColor(this.palette().text)
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(chartValueText(this.chart(), point.value, this.locale))
              .fontSize(11)
              .fontColor(this.palette().textSecondary)
            Text(chartPercentText(point.value, this.chart().scale))
              .fontSize(10)
              .fontColor(this.palette().textSecondary)
          }
          .width('100%')
        }, (point: CardChartPointView, index: number) => `legend-${index}`)
        if (this.chart().remainder > 0) {
          Row({ space: 6 }) {
            Row()
              .width(8)
              .height(8)
              .backgroundColor(this.palette().track)
              .borderRadius(2)
            Text(this.chart().remainderLabel)
              .fontSize(11)
              .fontColor(this.palette().text)
              .layoutWeight(1)
              .maxLines(1)
            Text(chartValueText(this.chart(), this.chart().remainder, this.locale))
              .fontSize(11)
              .fontColor(this.palette().textSecondary)
            Text(chartPercentText(this.chart().remainder, this.chart().scale))
              .fontSize(10)
              .fontColor(this.palette().textSecondary)
          }
          .width('100%')
        }
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 14, right: 14, bottom: 8 })
  }

  @Builder
  DonutChartBody() {
    Column({ space: 8 }) {
      Canvas(this.donutContext)
        .width(120)
        .height(120)
        .onReady(() => this.drawDonut())
      Text(this.chart().total !== undefined
        ? chartPercentText(this.chart().sum, this.chart().total ?? 0)
        : chartValueText(this.chart(), this.chart().sum, this.locale))
        .fontSize(12)
        .fontColor(this.palette().textSecondary)
      Column({ space: 3 }) {
        ForEach(this.chart().points, (point: CardChartPointView, index: number) => {
          Row({ space: 6 }) {
            Row()
              .width(8)
              .height(8)
              .backgroundColor(toneShade(point.tone, index))
              .borderRadius(2)
            Text(labelText(this.chart(), point.label, this.locale))
              .fontSize(11)
              .fontColor(this.palette().text)
              .layoutWeight(1)
              .maxLines(1)
            Text(chartPercentText(point.value, this.chart().scale))
              .fontSize(10)
              .fontColor(this.palette().textSecondary)
          }
          .width('100%')
        }, (point: CardChartPointView, index: number) => `donut-${index}`)
      }
      .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding({ left: 14, right: 14, bottom: 8 })
  }

  @Builder
  LineChartBody() {
    Column({ space: 4 }) {
      if (this.chart().points.length >= 2) {
        Canvas(this.lineContext)
          .width('100%')
          .height(80)
          .onReady(() => this.drawLine())
        Row() {
          Text(labelText(this.chart(), this.chart().points[0].label, this.locale))
            .fontSize(9)
            .fontColor(this.palette().textSecondary)
          Blank()
          Text(labelText(this.chart(), this.chart().points[this.chart().points.length - 1].label, this.locale))
            .fontSize(9)
            .fontColor(this.palette().textSecondary)
        }
        .width('100%')
      } else {
        Text(isChineseLocale(this.locale) ? '数据点不足' : 'Not enough points')
          .fontSize(11)
          .fontColor(this.palette().textSecondary)
      }
    }
    .width('100%')
    .padding({ left: 14, right: 14, bottom: 8 })
  }

  @Builder
  CronBody() {
    Column({ space: 5 }) {
      Row() {
        Text(this.cron().name)
          .fontSize(13)
          .fontColor(this.palette().text)
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.cron().enabled
          ? (isChineseLocale(this.locale) ? '已启用' : 'Enabled')
          : (isChineseLocale(this.locale) ? '已暂停' : 'Paused'))
          .fontSize(10)
          .fontColor(this.cron().enabled ? toneColor('success') : this.palette().textSecondary)
      }
      .width('100%')
      Row() {
        Text(isChineseLocale(this.locale) ? '下次运行' : 'Next run')
          .fontSize(11)
          .fontColor(this.palette().textSecondary)
        Blank()
        Text(this.cron().enabled && this.cron().nextRunAtMs !== undefined
          ? relativeTime(this.cron().nextRunAtMs ?? 0, this.locale)
          : '—')
          .fontSize(11)
          .fontColor(this.palette().text)
      }
      .width('100%')
      Row() {
        Text(isChineseLocale(this.locale) ? '上次运行' : 'Last run')
          .fontSize(11)
          .fontColor(this.palette().textSecondary)
        Blank()
        Text(this.cron().lastStatus !== undefined
          ? `${this.cronStatusLabel(this.cron().lastStatus ?? '')}${this.cron().lastRunAtMs !== undefined ? ` · ${relativeTime(this.cron().lastRunAtMs ?? 0, this.locale)}` : ''}`
          : (isChineseLocale(this.locale) ? '尚未运行' : 'Never run'))
          .fontSize(11)
          .fontColor(this.cron().lastStatus === 'error' ? toneColor('danger') : this.palette().text)
      }
      .width('100%')
      if (this.cron().lastError !== undefined) {
        Text(this.cron().lastError ?? '')
          .fontSize(10)
          .fontColor(toneColor('danger'))
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 14, right: 14, bottom: 8 })
  }

  @Builder
  CustomBody() {
    Web({ src: 'about:blank', controller: this.webController })
      .layoutWeight(1)
      .width('100%')
      .backgroundColor(Color.Transparent)
      .javaScriptProxy({
        object: this.customBridge ?? new DesktopCardCustomBridge(this.cardId),
        name: 'bitfunCardHost',
        methodList: ['openLink'],
        controller: this.webController,
      })
      .onControllerAttached(() => this.attachCustomWeb())
      .onPageEnd(() => {
        this.customReady = true;
        this.pushCustomData();
      })
  }

  @Builder
  NoteBody() {
    Text(this.note())
      .fontSize(12)
      .fontColor(this.palette().text)
      .width('100%')
      .padding({ left: 14, right: 14, bottom: 10 })
  }

  @Builder
  UnsupportedBody() {
    Text(this.unsupportedText())
      .fontSize(11)
      .fontColor(this.palette().textSecondary)
      .width('100%')
      .padding({ left: 14, right: 14, bottom: 10 })
  }

  @Builder
  Body() {
    if (this.card === null) {
      Text(isChineseLocale(this.locale) ? '加载中…' : 'Loading…')
        .fontSize(12)
        .fontColor(this.palette().textSecondary)
        .padding(14)
    } else if (this.unsupported().length > 0) {
      this.UnsupportedBody()
    } else if (this.kind() === 'countdown') {
      this.CountdownBody()
    } else if (this.kind() === 'checklist') {
      this.ChecklistBody()
    } else if (this.kind() === 'progress') {
      this.ProgressBody()
    } else if (this.kind() === 'metrics') {
      this.MetricsBody()
    } else if (this.kind() === 'chart') {
      if (this.chart().style === 'column') {
        this.ColumnChartBody()
      } else if (this.chart().style === 'line') {
        this.LineChartBody()
      } else if (this.chart().style === 'donut') {
        this.DonutChartBody()
      } else if (this.chart().style === 'stacked') {
        this.StackedChartBody()
      } else {
        this.BarChartBody()
      }
    } else if (this.kind() === 'cronJob') {
      this.CronBody()
    } else if (this.kind() === 'note') {
      this.NoteBody()
    } else {
      Text(isChineseLocale(this.locale) ? '加载中…' : 'Loading…')
        .fontSize(12)
        .fontColor(this.palette().textSecondary)
        .padding(14)
    }
  }

  @Builder
  Footer() {
    if (this.hasFooter()) {
      Row({ space: 6 }) {
        Text(this.footer().text ?? '')
          .fontSize(10)
          .fontColor(this.footer().state === 'error'
            ? toneColor('danger')
            : this.palette().textSecondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(relativeTime(this.footer().fetchedAtMs, this.locale))
          .fontSize(10)
          .fontColor(this.palette().textSecondary)
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 4, bottom: 8 })
    }
  }

  build() {
    Stack() {
      // Material layer. It carries no backgroundColor on purpose: a
      // non-transparent fill would have to disable the blur.
      Column()
        .width('100%')
        .height('100%')
        .borderRadius(12)
        .backgroundBlurStyle(
          CARD_MATERIAL_ENABLED ? CARD_MATERIAL_STYLE : BlurStyle.NONE,
          {
            colorMode: ThemeColorMode.SYSTEM,
            policy: BlurStyleActivePolicy.ALWAYS_ACTIVE,
          }
        )
        .lightUpEffect(this.glow)
      // Theme surface tint on top of the material, independent of the content so
      // text opacity is never affected.
      Column()
        .width('100%')
        .height('100%')
        .borderRadius(12)
        .backgroundColor(this.palette().surface)
        .opacity(CARD_MATERIAL_ENABLED ? CARD_TINT_OPACITY : 1)
      Column() {
        this.Header()
        if (this.kind() === 'custom') {
          this.CustomBody()
        } else {
          Scroll() {
            Column() {
              this.Body()
            }
            .width('100%')
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
        }
        this.Footer()
      }
      .width('100%')
      .height('100%')
      .borderRadius(12)
      .border({ width: 1, color: this.palette().border })
      .clip(true)
    }
    .width('100%')
    .height('100%')
  }
}
