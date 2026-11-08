import type { GenUIAppDefinition, GenUIAppEnvelope } from './genUITypes';

export function harmonyPresentation(app: GenUIAppDefinition | GenUIAppEnvelope) {
  const source = 'source' in app && app.source ? app.source.kind === 'openui-lang' ? app.source.content : `${app.source.html} ${app.source.css ?? ''}` : '';
  const text = `${app.title} ${'description' in app ? app.description ?? '' : ''} ${source}`.toLowerCase();
  const themes: Array<[string, RegExp]> = [
    ['orange', /orange|food|cook|recipe|energy|\u9910|\u98df|\u70f9\u996a|\u6a59/],
    ['green', /green|health|fitness|workout|plant|nature|health|\u5065\u5eb7|\u8fd0\u52a8|\u690d\u7269|\u7eff\u8272/],
    ['indigo', /indigo|study|reading|book|plan|course|\u5b66\u4e60|\u9605\u8bfb|\u8ba1\u5212|\u975b/],
    ['purple', /purple|music|creative|night|art|\u97f3\u4e50|\u521b\u610f|\u591c|\u7d2b/],
    ['rose', /rose|beauty|gift|celebration|\u7f8e\u5986|\u793c\u7269|\u5e86\u795d|\u73ab\u7470/],
    ['teal', /teal|water|travel|weather|calm|\u65c5\u884c|\u5929\u6c14|\u6c34|\u9752\u7eff/],
    ['brown', /brown|coffee|baking|wood|history|\u5496\u5561|\u70d8\u7119|\u5386\u53f2|\u68d5/],
    ['ink', /ink|minimal|editorial|fashion|serious|\u6781\u7b80|\u7f16\u8f91|\u65f6\u5c1a|\u58a8/],
  ];
  const theme = themes.find(([, pattern]) => pattern.test(text))?.[0] ?? 'blue';
  const font = /journal|diary|personal|\u624b\u8d26|\u65e5\u8bb0/.test(text) ? 'handwritten' : /book|reading|history|paper|calligraphy|\u4e66|\u9605\u8bfb|\u5386\u53f2/.test(text) ? 'serif' : /code|technical|developer|tech|\u4ee3\u7801|\u6280\u672f/.test(text) ? 'tech' : 'sans';
  const scheme = /dark|cinema|film|movie|astronomy|night|music player|game|\u7535\u5f71|\u5f71\u9662|\u591c\u7a7a|\u64ad\u653e\u5668|\u6e38\u620f|\u6df1\u8272/.test(text) ? 'dark' : 'light';
  return { theme, font, scheme } as const;
}
