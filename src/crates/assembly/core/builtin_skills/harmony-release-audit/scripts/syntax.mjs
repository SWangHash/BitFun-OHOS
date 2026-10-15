import JSON5 from './vendor/json5.mjs';

// A bounded lexical model, not an ArkTS compiler. Strings/comments are opaque,
// bracket pairs retain source positions, and unsupported syntax stays unresolved.
export function lex(source) {
  const tokens = [], stack = [], pairs = new Map(), errors = [];
  let i = 0;
  while (i < source.length) {
    const start = i, c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i); if (i < 0) i = source.length; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); if (end < 0) errors.push({ start, reason: 'unterminated-comment' }); i = end < 0 ? source.length : end + 2; continue; }
    let kind = 'punct', value;
    const previous = tokens.at(-1)?.text;
    if (c === '/' && (previous === undefined || ['=', '(', '[', ',', ':', '!', '?', 'return', '|', '&'].includes(previous) || (previous === '>' && tokens.at(-2)?.text === '='))) {
      kind = 'regex'; i++; let inClass = false, closed = false;
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        if (source[i] === ']') inClass = false;
        if (source[i++] === '/' && !inClass) { closed = true; break; }
      }
      if (!closed) errors.push({ start, reason: 'unterminated-regex' });
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
    } else if ('\'"`'.includes(c)) {
      i++;
      while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === c) break; }
      const raw = source.slice(start, i);
      kind = c === '`' ? 'template' : 'string';
      if (!raw.endsWith(c) || raw.length < 2) errors.push({ start, reason: 'unterminated-string' });
      if (kind === 'string') { try { value = JSON5.parse(raw); } catch { errors.push({ start, reason: 'invalid-string' }); } }
    } else if (/[A-Za-z_$\u0080-\uffff]/.test(c)) {
      i++; while (i < source.length && /[\w$\u0080-\uffff]/.test(source[i])) i++;
      kind = 'identifier';
    } else if (/\d/.test(c)) {
      i++; while (i < source.length && /[\w.]/.test(source[i])) i++;
      kind = 'number';
    } else i++;
    const token = { text: source.slice(start, i), start, end: i, kind, value };
    const index = tokens.push(token) - 1;
    if (kind !== 'punct') continue;
    if ('([{'.includes(c)) stack.push(index);
    else if (')]}'.includes(c)) {
      const open = stack.pop();
      if (open === undefined || '([{'.indexOf(tokens[open].text) !== ')]}'.indexOf(c)) errors.push({ start, reason: 'unbalanced-brackets' });
      else { pairs.set(open, index); pairs.set(index, open); }
    }
  }
  for (const open of stack) errors.push({ start: tokens[open].start, reason: 'unclosed-bracket' });
  return { tokens, pairs, errors, source };
}

export const containers = new Set(['Column', 'Row', 'Flex', 'Stack', 'RelativeContainer', 'Scroll', 'List', 'ListItem', 'Grid', 'GridItem', 'GridRow', 'GridCol', 'FlowItem', 'WaterFlow', 'NavDestination', 'Navigation', 'Tabs', 'TabContent', 'Swiper', 'Refresh']);
const leaves = new Set(['Text', 'Span', 'Checkbox', 'CheckboxGroup', 'Toggle', 'Button', 'Image', 'SymbolGlyph', 'TextInput', 'TextArea', 'Divider', 'Blank']);

export function parseUI(source) {
  const syntax = lex(source), { tokens: t, pairs } = syntax;
  const nodes = [], structs = [], styleNames = new Set();
  for (let i = 1; i < t.length; i++) {
    if (t[i - 1].text !== '@' || !['Styles', 'Extend'].includes(t[i].text)) continue;
    let next = i + 1;
    if (t[next]?.text === '(' && pairs.has(next)) next = pairs.get(next) + 1;
    if (t[next]?.text === 'function') next++;
    if (t[next]?.kind === 'identifier') styleNames.add(t[next].text);
  }
  for (let i = 0; i < t.length; i++) {
    if (['struct', 'class'].includes(t[i].text)) {
      const open = t.findIndex((x, j) => j > i && x.text === '{');
      if (open >= 0 && pairs.has(open)) structs.push({ name: t[i + 1]?.text, open, close: pairs.get(open) });
    }
    if (t[i].kind !== 'identifier' || !/^[A-Z]/.test(t[i].text) || t[i + 1]?.text !== '(' || ['.', 'new', 'function', '@'].includes(t[i - 1]?.text)) continue;
    const argClose = pairs.get(i + 1);
    if (argClose === undefined) continue;
    let next = argClose + 1, bodyOpen = null, bodyClose = null;
    if (t[next]?.text === '{') { bodyOpen = next; bodyClose = pairs.get(next); if (bodyClose === undefined) continue; next = bodyClose + 1; }
    const props = new Map();
    while (t[next]?.text === '.' && t[next + 1]?.kind === 'identifier' && t[next + 2]?.text === '(' && pairs.has(next + 2)) {
      const close = pairs.get(next + 2);
      props.set(t[next + 1].text, { expression: source.slice(t[next + 2].end, t[close].start).trim(), start: t[next].start, end: t[close].end });
      next = close + 1;
    }
    const known = containers.has(t[i].text) || leaves.has(t[i].text);
    const owner = structs.filter(s => s.open < i && i < s.close).sort((a, b) => b.open - a.open)[0];
    // Uppercase builder function declarations must not become UI containers.
    const containingBrace = [...pairs.entries()].filter(([a, b]) => a < i && i < b && t[a].text === '{').sort((a, b) => b[0] - a[0])[0]?.[0];
    if (!known && !props.size && bodyOpen !== null && owner && containingBrace === owner.open) continue;
    if (!known && bodyOpen === null && !props.size) continue;
    nodes.push({ name: t[i].text, start: t[i].start, end: t[next - 1].end, arg: source.slice(t[i + 1].end, t[argClose].start), bodyStart: bodyOpen === null ? null : t[bodyOpen].end, bodyEnd: bodyClose === null ? null : t[bodyClose].start, props, known, owner, tokenIndex: i, parent: null, customStyle: [...props.keys()].some(k => styleNames.has(k)) });
  }
  for (const n of nodes) {
    const enclosing = nodes.filter(p => p !== n && p.bodyStart !== null && p.bodyStart <= n.start && n.end <= p.bodyEnd).sort((a, b) => b.bodyStart - a.bodyStart);
    n.parent = enclosing[0] ?? null;
  }
  return { ...syntax, nodes, structs };
}

export function firstArgument(expression) {
  const { tokens, pairs } = lex(expression);
  for (let i = 0; i < tokens.length; i++) {
    if ('([{'.includes(tokens[i].text) && pairs.has(i)) { i = pairs.get(i); continue; }
    if (tokens[i].text === ',') return expression.slice(0, tokens[i].start).trim();
  }
  return expression.trim();
}

export function objectProperty(expression, key) {
  const { tokens: t, pairs } = lex(expression);
  if (t[0]?.text !== '{') return null;
  for (let i = 1; i < t.length - 1; i++) {
    if ('([{'.includes(t[i].text) && pairs.has(i)) { i = pairs.get(i); continue; }
    if ((t[i].value ?? t[i].text) !== key || t[i + 1]?.text !== ':') continue;
    const start = t[i + 2]?.start;
    if (start === undefined) return null;
    let j = i + 2;
    for (; j < t.length - 1; j++) {
      if ('([{'.includes(t[j].text) && pairs.has(j)) { j = pairs.get(j); continue; }
      if (t[j].text === ',') break;
    }
    return expression.slice(start, t[j].start).trim();
  }
  return null;
}

export function literal(expression) {
  const tokens = lex(expression).tokens;
  if (tokens.length === 1 && tokens[0].kind === 'string') return tokens[0].value;
  if (tokens.length === 1 && tokens[0].kind === 'template' && !tokens[0].text.includes('${')) return tokens[0].text.slice(1, -1);
  if (tokens.length > 1 && tokens.length % 2 === 1 && tokens.every((t, i) => i % 2 === 0 ? t.kind === 'string' && typeof t.value === 'string' : t.text === '+')) return tokens.filter((_, i) => i % 2 === 0).map(t => t.value).join('');
  return null;
}

export function initializer(ui, node, expression) {
  const ref = expression.trim().match(/^(?:this\.)?([\w$]+)$/);
  if (!ref) return null;
  const name = ref[1], { tokens: t, pairs, source } = ui, candidates = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].text !== name || t[i - 1]?.text === '.') continue;
    if (node.owner && !(node.owner.open < i && i < node.owner.close)) continue;
    if (!node.owner && ui.structs.some(s => s.open < i && i < s.close)) continue;
    let j = i + 1;
    if (t[j]?.text === ':') { j++; while (j < t.length && !['=', ';', '{', '}'].includes(t[j].text)) j++; }
    if (t[j]?.text !== '=' || t[j + 1]?.text === '=') continue;
    // Only declarations in the component body or explicit const/let locals.
    const containing = [...pairs.entries()].filter(([a, b]) => a < i && i < b && t[a].text === '{').sort((a, b) => b[0] - a[0])[0];
    if (node.owner && containing?.[0] !== node.owner.open && !['const', 'let', 'var'].includes(t[i - 1]?.text)) continue;
    if (!node.owner && containing && !['const', 'let', 'var'].includes(t[i - 1]?.text)) continue;
    if (containing && !(t[containing[0]].start < node.start && node.end < t[containing[1]].end)) continue;
    let end = j + 1;
    while (end < t.length && ![';', '}'].includes(t[end].text)) { if ('([{'.includes(t[end].text) && pairs.has(end)) end = pairs.get(end); end++; }
    const atom = t[j + 1]?.text;
    const simpleBoolean = ['true', 'false'].includes(atom) && !['?', '&', '|', '=', '.', '('].includes(t[j + 2]?.text);
    const value = simpleBoolean ? atom : source.slice(t[j + 1].start, t[end]?.start ?? source.length).trim();
    candidates.push({ name, value, start: t[i].start, end: t[end]?.start ?? source.length });
  }
  return candidates.length === 1 ? candidates[0] : null;
}
