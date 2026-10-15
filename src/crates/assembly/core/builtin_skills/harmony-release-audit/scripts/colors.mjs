export function rgba(value) {
  if (typeof value !== 'string') return null;
  let v = value.trim().replace(/^(['"])(.*)\1$/, '$2');
  const named = { 'Color.Black': '#000000', 'Color.White': '#FFFFFF', 'Color.Red': '#FF0000', 'Color.Blue': '#0000FF', 'Color.Transparent': '#00000000' };
  v = named[v] ?? v;
  if (/^0x[0-9a-f]{8}$/i.test(v)) v = '#' + v.slice(2);
  if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map(c => c + c).join('');
  if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return null;
  const raw = v.slice(1), rgb = raw.length === 8 ? raw.slice(2) : raw;
  return { r: parseInt(rgb.slice(0, 2), 16), g: parseInt(rgb.slice(2, 4), 16), b: parseInt(rgb.slice(4, 6), 16), a: raw.length === 8 ? parseInt(raw.slice(0, 2), 16) / 255 : 1 };
}
export function composite(fg, bg) {
  const a = fg.a + bg.a * (1 - fg.a);
  if (!a) return { r: 0, g: 0, b: 0, a: 0 };
  const blend = k => (fg[k] * fg.a + bg[k] * bg.a * (1 - fg.a)) / a;
  return { r: blend('r'), g: blend('g'), b: blend('b'), a };
}
export function ratio(fg, bg) {
  if (!fg || !bg || bg.a !== 1) return null;
  const luminance = c => {
    const channel = x => { const v = x / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return .2126 * channel(c.r) + .7152 * channel(c.g) + .0722 * channel(c.b);
  };
  const a = luminance(composite(fg, bg)), b = luminance(bg);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function contrast(foreground, background) { return ratio(rgba(foreground), rgba(background)); }

// Keep the input pair attached to every calculated recommendation so a ratio
// computed on one background cannot be mistaken for another background.
export function contrastDetails(foreground, background) {
  const fg = rgba(foreground), bg = rgba(background), value = ratio(fg, bg);
  if (value === null) return null;
  return { foreground, background, compositedForeground: composite(fg, bg), ratio: value,
    thresholds: { operator: '>', title: 3, body: 4.5 }, titlePass: value > 3, bodyPass: value > 4.5 };
}
