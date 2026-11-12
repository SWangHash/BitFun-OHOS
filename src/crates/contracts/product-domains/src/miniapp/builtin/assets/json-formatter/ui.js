// JSON Formatter — built-in MiniApp.
// Validate, beautify, minify, sort keys, and copy JSON with error line/col hints.
//
// No node worker, no shell, no net: pure frontend plus the host bridge for
// storage persistence and clipboard write.

const I18N = {
  'zh-CN': {
    title: 'JSON 格式化',
    subtitle: '校验 · 美化 · 压缩 · 键排序',
    statusReady: '就绪',
    statusInitializing: '初始化中…',
    statusOk: '合法 JSON',
    statusError: 'JSON 无效',
    inputTitle: '输入',
    outputTitle: '输出',
    inputPlaceholder: '把 JSON 粘贴到这里，例如 {"name":"BitFun","ok":true}',
    outputEmpty: '格式化结果将在这里展示。',
    sample: '示例',
    clear: '清空',
    copy: '复制',
    copied: '已复制',
    copyEmpty: '没有可复制的内容',
    useOutput: '用作输入',
    indent: '缩进',
    format: '格式化',
    minify: '压缩',
    sortKeys: '键排序',
    validate: '校验',
    statsBytes: (n) => `${n} 字节`,
    statsLines: (n) => `${n} 行`,
    errorAt: (line, col) => `第 ${line} 行，第 ${col} 列`,
    emptyInput: '请先输入 JSON 内容',
  },
  'zh-TW': {
    title: 'JSON 格式化',
    subtitle: '校驗 · 美化 · 壓縮 · 鍵排序',
    statusReady: '就緒',
    statusInitializing: '初始化中…',
    statusOk: '合法 JSON',
    statusError: 'JSON 無效',
    inputTitle: '輸入',
    outputTitle: '輸出',
    inputPlaceholder: '把 JSON 貼到這裡，例如 {"name":"BitFun","ok":true}',
    outputEmpty: '格式化結果將在這裡展示。',
    sample: '示例',
    clear: '清空',
    copy: '複製',
    copied: '已複製',
    copyEmpty: '沒有可複製的內容',
    useOutput: '用作輸入',
    indent: '縮進',
    format: '格式化',
    minify: '壓縮',
    sortKeys: '鍵排序',
    validate: '校驗',
    statsBytes: (n) => `${n} 位元組`,
    statsLines: (n) => `${n} 行`,
    errorAt: (line, col) => `第 ${line} 行，第 ${col} 列`,
    emptyInput: '請先輸入 JSON 內容',
  },
  'en-US': {
    title: 'JSON Formatter',
    subtitle: 'Validate · Beautify · Minify · Sort keys',
    statusReady: 'Ready',
    statusInitializing: 'Initializing…',
    statusOk: 'Valid JSON',
    statusError: 'Invalid JSON',
    inputTitle: 'Input',
    outputTitle: 'Output',
    inputPlaceholder: 'Paste JSON here, e.g. {"name":"BitFun","ok":true}',
    outputEmpty: 'Formatted output will appear here.',
    sample: 'Sample',
    clear: 'Clear',
    copy: 'Copy',
    copied: 'Copied',
    copyEmpty: 'Nothing to copy',
    useOutput: 'Use as input',
    indent: 'Indent',
    format: 'Format',
    minify: 'Minify',
    sortKeys: 'Sort keys',
    validate: 'Validate',
    statsBytes: (n) => `${n} bytes`,
    statsLines: (n) => `${n} lines`,
    errorAt: (line, col) => `line ${line}, column ${col}`,
    emptyInput: 'Enter some JSON first',
  },
};

function currentLocale() {
  return (window.app && window.app.locale) || 'en-US';
}

function ui(key) {
  const lang = currentLocale();
  const table = I18N[lang] || I18N['en-US'];
  return table[key];
}

const SAMPLE_JSON = {
  name: 'BitFun',
  version: '1.0.7',
  ok: true,
  features: ['agent', 'miniapp', 'terminal'],
  meta: { stars: 4321, forks: 123, license: null },
};

const dom = {
  statusPill: document.getElementById('status-pill'),
  input: document.getElementById('input'),
  output: document.getElementById('output'),
  outputEmpty: document.getElementById('output-empty'),
  errorBox: document.getElementById('error-box'),
  inputStats: document.getElementById('input-stats'),
  outputStats: document.getElementById('output-stats'),
  btnFormat: document.getElementById('btn-format'),
  btnMinify: document.getElementById('btn-minify'),
  btnSort: document.getElementById('btn-sort'),
  btnValidate: document.getElementById('btn-validate'),
  btnCopy: document.getElementById('btn-copy'),
  btnSample: document.getElementById('btn-paste-sample'),
  btnClear: document.getElementById('btn-clear'),
  btnUseOutput: document.getElementById('btn-download'),
  indentGroup: document.getElementById('indent-group'),
};

const state = {
  indent: '2',
  lastResult: '', // last successful JSON.stringify result (formatted)
  activeAction: 'format', // last triggered action — drives the toolbar highlight
};

// Toolbar action buttons behave like a segmented control: the last executed
// action keeps the primary (dark) style, the others stay light.
const ACTION_BUTTONS = [
  { mode: 'format', el: () => dom.btnFormat },
  { mode: 'minify', el: () => dom.btnMinify },
  { mode: 'sort', el: () => dom.btnSort },
  { mode: 'validate', el: () => dom.btnValidate },
];

function syncActionButtons() {
  for (const action of ACTION_BUTTONS) {
    const button = action.el();
    if (!button) continue;
    const isActive = state.activeAction === action.mode;
    button.classList.toggle('btn--primary', isActive);
    button.classList.toggle('is-active', isActive);
  }
}

// ── Storage (best-effort persistence) ────────────────
async function restoreState() {
  try {
    const app = window.app;
    if (!app || !app.storage) return;
    const saved = await app.storage.get('json-formatter-state');
    if (saved && typeof saved === 'object') {
      if (typeof saved.indent === 'string') state.indent = saved.indent;
      if (typeof saved.input === 'string') dom.input.value = saved.input;
    }
  } catch (e) { /* storage unavailable — run in-memory */ }
  syncIndentButtons();
  updateInputStats();
  run('format', { silent: true });
}

let persistTimer = null;
function persistState() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      const app = window.app;
      if (!app || !app.storage) return;
      await app.storage.set('json-formatter-state', {
        indent: state.indent,
        input: dom.input.value,
      });
    } catch (e) { /* ignore */ }
  }, 400);
}

// ── Formatting core ──────────────────────────────────
function indentValue() {
  if (state.indent === 'tab') return '\t';
  const n = parseInt(state.indent, 10);
  return Number.isFinite(n) && n > 0 ? ' '.repeat(n) : '  ';
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

// Returns { ok: true, value } or { ok: false, message, line, col }
function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    const loc = errorPosition(text, e);
    return { ok: false, message: e.message, line: loc.line, col: loc.col };
  }
}

// Derive line/col from a JSON.parse error when the engine exposes a position.
function errorPosition(text, err) {
  let pos = -1;
  const m = /position\s+(\d+)/i.exec(err && err.message ? err.message : '');
  if (m) pos = parseInt(m[1], 10);
  if (!Number.isFinite(pos) || pos < 0) return { line: 0, col: 0 };
  const before = text.slice(0, Math.min(pos, text.length));
  const line = before.split('\n').length;
  const lastBreak = before.lastIndexOf('\n');
  const col = pos - lastBreak;
  return { line, col };
}

// ── Output rendering ─────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Minimal JSON syntax highlighter for the already-formatted output.
function highlight(jsonText) {
  const tokenRe = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = tokenRe.exec(jsonText)) !== null) {
    out += escapeHtml(jsonText.slice(last, m.index));
    if (m[1] !== undefined) {
      if (m[2]) {
        out += `<span class="tk-key">${escapeHtml(m[1])}</span>${escapeHtml(m[2])}`;
      } else {
        out += `<span class="tk-string">${escapeHtml(m[1])}</span>`;
      }
    } else if (m[3] !== undefined) {
      out += `<span class="tk-bool">${m[3]}</span>`;
    } else if (m[0] === 'null') {
      out += '<span class="tk-null">null</span>';
    } else {
      out += `<span class="tk-number">${escapeHtml(m[0])}</span>`;
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(jsonText.slice(last));
  return out;
}

function setStatus(kind, key) {
  dom.statusPill.className = `status status--${kind}`;
  dom.statusPill.textContent = ui(key);
}

function showError(message, loc) {
  const parts = [];
  if (loc && loc.line) parts.push(ui('errorAt')(loc.line, loc.col));
  parts.push(message || 'JSON.parse error');
  dom.errorBox.textContent = parts.join(' — ');
  dom.errorBox.hidden = false;
}

function clearOutput() {
  dom.output.innerHTML = '';
  dom.outputEmpty.hidden = false;
  dom.errorBox.hidden = true;
  dom.outputStats.textContent = '';
  dom.btnUseOutput.hidden = true;
  state.lastResult = '';
}

function showResult(text) {
  state.lastResult = text;
  dom.output.innerHTML = highlight(text);
  dom.outputEmpty.hidden = true;
  dom.errorBox.hidden = true;
  dom.btnUseOutput.hidden = false;
  dom.outputStats.textContent = ui('statsBytes')(text.length);
}

// ── Actions ──────────────────────────────────────────
// mode: 'format' | 'minify' | 'sort' | 'validate'
function run(mode, opts) {
  const options = opts || {};
  state.activeAction = mode;
  syncActionButtons();
  const raw = dom.input.value.trim();
  updateInputStats();

  if (raw === '') {
    clearOutput();
    setStatus('ok', 'statusReady');
    if (!options.silent) flashError(ui('emptyInput'));
    return;
  }

  let parsed = parseJson(raw);
  if (!parsed.ok) {
    clearOutput();
    showError(parsed.message, parsed);
    setStatus('error', 'statusError');
    return;
  }

  if (mode === 'validate') {
    clearOutput();
    setStatus('ok', 'statusOk');
    showResult(JSON.stringify(parsed.value, null, indentValue()));
    return;
  }

  if (mode === 'sort') parsed = { ok: true, value: sortKeysDeep(parsed.value) };

  const indent = mode === 'minify' ? undefined : indentValue();
  const out = mode === 'minify' ? JSON.stringify(parsed.value) : JSON.stringify(parsed.value, null, indent);
  showResult(out);
  setStatus('ok', 'statusOk');
}

function flashError(message) {
  dom.errorBox.textContent = message;
  dom.errorBox.hidden = false;
  setTimeout(() => { if (dom.errorBox.textContent === message) dom.errorBox.hidden = true; }, 2500);
}

function updateInputStats() {
  const text = dom.input.value;
  const lines = text === '' ? 0 : text.split('\n').length;
  dom.inputStats.textContent = text === '' ? '' : ui('statsBytes')(text.length) + ' · ' + ui('statsLines')(lines);
}

async function copyResult() {
  const app = window.app;
  const text = state.lastResult || dom.input.value.trim();
  if (!text) { flashError(ui('copyEmpty')); return; }
  try {
    if (app && app.clipboard && app.clipboard.writeText) {
      await app.clipboard.writeText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    const label = dom.btnCopy.querySelector('span');
    const prev = label.textContent;
    label.textContent = ui('copied');
    setTimeout(() => { label.textContent = ui('copy'); }, 1500);
  } catch (e) {
    flashError(String(e && e.message ? e.message : e));
  }
}

function syncIndentButtons() {
  for (const btn of dom.indentGroup.querySelectorAll('.opt')) {
    btn.classList.toggle('is-active', btn.dataset.indent === state.indent);
  }
}

function applyStaticI18n() {
  document.documentElement.setAttribute('lang', currentLocale());
  for (const el of document.querySelectorAll('[data-i18n]')) {
    // Elements whose copy targets an attribute (placeholder 等) must never get
    // textContent: assigning textContent on a <textarea> SETS ITS VALUE, which
    // turned the placeholder into real input text on first open.
    if (el.dataset.i18nAttr) continue;
    const key = el.dataset.i18n;
    const value = ui(key);
    if (typeof value === 'string') el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    const attr = el.dataset.i18nAttr;
    const value = ui(el.dataset.i18n);
    if (typeof value === 'string') el.setAttribute(attr, value);
  }
}

// ── Init ─────────────────────────────────────────────
function bindEvents() {
  dom.btnFormat.addEventListener('click', () => run('format'));
  dom.btnMinify.addEventListener('click', () => run('minify'));
  dom.btnSort.addEventListener('click', () => run('sort'));
  dom.btnValidate.addEventListener('click', () => run('validate'));
  dom.btnCopy.addEventListener('click', copyResult);
  dom.btnUseOutput.addEventListener('click', () => {
    if (state.lastResult) {
      dom.input.value = state.lastResult;
      persistState();
      updateInputStats();
      run('format');
    }
  });
  dom.btnSample.addEventListener('click', () => {
    dom.input.value = JSON.stringify(SAMPLE_JSON, null, 2);
    persistState();
    run('format');
  });
  dom.btnClear.addEventListener('click', () => {
    dom.input.value = '';
    persistState();
    clearOutput();
    updateInputStats();
    setStatus('ok', 'statusReady');
  });
  dom.input.addEventListener('input', persistState);
  dom.input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run('format');
    }
  });
  dom.indentGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    state.indent = btn.dataset.indent;
    syncIndentButtons();
    persistState();
    if (dom.input.value.trim() !== '') run('format');
  });
}

// ── Host readiness gate ──────────────────────────────
// During host startup, bridge calls queue or get lost; gate the UI on
// window.app.ready so the wait is visible instead of silently dead buttons.
function setButtonsEnabled(enabled) {
  for (const b of document.querySelectorAll('button')) b.disabled = !enabled;
}

async function waitForHost() {
  const app = window.app;
  if (!app || !app.ready) return;
  setButtonsEnabled(false);
  dom.statusPill.className = 'status status--busy';
  dom.statusPill.textContent = ui('statusInitializing');
  try {
    await Promise.race([app.ready, new Promise((r) => setTimeout(r, 30000))]);
  } catch (e) { /* proceed after the fallback timeout */ }
  setButtonsEnabled(true);
}

async function init() {
  await waitForHost();
  applyStaticI18n();
  syncActionButtons();
  syncIndentButtons();
  bindEvents();
  await restoreState();
  if (window.app && typeof window.app.onLocaleChange === 'function') {
    window.app.onLocaleChange(() => {
      applyStaticI18n();
    });
  }
}

init();
