const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/services/DesktopCardWindowService.ets'),
  'utf8',
);
const { outputText } = ts.transpileModule(serviceSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

class LocalStorageMock {
  constructor() {
    this.map = new Map();
  }

  setOrCreate(key, value) {
    this.map.set(key, value);
  }

  get(key) {
    return this.map.get(key);
  }
}

function makeWindow(label) {
  const win = {
    label,
    listeners: new Map(),
    loadedPage: null,
    storage: null,
    shown: false,
    destroyed: false,
    moving: false,
    focused: false,
    resized: null,
    moved: null,
    background: null,
    decorVisible: true,
    limits: null,
    on(event, callback) {
      this.listeners.set(event, callback);
    },
    async loadContent(page, storage) {
      this.loadedPage = page;
      this.storage = storage;
    },
    async showWindow() {
      this.shown = true;
    },
    async destroyWindow() {
      this.destroyed = true;
    },
    async resize(width, height) {
      this.resized = { width, height };
    },
    async moveWindowTo(x, y) {
      this.moved = { x, y };
    },
    async setWindowFocus() {
      this.focused = true;
    },
    async startMoving() {
      this.moving = true;
    },
    setWindowBackgroundColor(color) {
      this.background = color;
    },
    setWindowDecorVisible(visible) {
      this.decorVisible = visible;
    },
    setWindowLimits(limits) {
      this.limits = limits;
    },
    getWindowProperties() {
      return { windowRect: { left: 100, top: 50, width: 280, height: 180 } };
    },
  };
  return win;
}

function loadService(deps = {}) {
  const created = [];
  const closed = [];
  const actions = [];
  const stage = {
    async createSubWindow(name) {
      const win = makeWindow(name);
      created.push({ name, win });
      return win;
    },
  };

  global.LocalStorage = LocalStorageMock;
  global.px2vp = value => value;
  global.vp2px = value => value;

  const modules = {
    '@kit.ArkUI': {
      display: {
        getDefaultDisplaySync: () => ({ width: 1440, height: 900 }),
      },
      window: {
        WindowEventType: { WINDOW_SHOWN: 1, WINDOW_INACTIVE: 3, WINDOW_DESTROYED: 7 },
      },
    },
    '@kit.BasicServicesKit': { BusinessError: class BusinessError extends Error {} },
    '@kit.PerformanceAnalysisKit': { hilog: { info() {}, warn() {}, debug() {} } },
    'libbitfun_desktop_lib.so': {
      default: {
        desktopCardOhosClosed: cardId => closed.push(cardId),
        desktopCardOhosAction: (action, payload) => actions.push({ action, payload }),
      },
    },
  };
  Object.assign(modules, deps);

  const exports = {};
  new Function('require', 'exports', outputText)(name => modules[name], exports);
  const service = exports.installDesktopCardWindowService(stage);
  return { service, created, closed, actions };
}

const VIEW = { cardId: 'card-1', title: 'Note', kind: 'note', tone: 'accent', visible: true };
const SIZE = { width: 320, height: 200 };

test('open creates a borderless subwindow with the card view', async () => {
  const { service, created } = loadService();
  const result = JSON.parse(
    await service.handle(
      JSON.stringify({
        action: 'open',
        cardId: 'card-1',
        view: VIEW,
        size: SIZE,
        position: { x: 10, y: 20 },
      }),
    ),
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'desktop-card-card-1');
  const win = created[0].win;
  assert.equal(win.loadedPage, 'pages/DesktopCard');
  assert.equal(win.storage.get('cardId'), 'card-1');
  assert.equal(win.storage.get('card'), JSON.stringify(VIEW));
  assert.equal(win.shown, true);
  assert.equal(win.background, '#00000000');
  assert.equal(win.decorVisible, false);
  assert.deepEqual(win.resized, SIZE);
  assert.deepEqual(win.moved, { x: 10, y: 20 });
  assert.deepEqual(win.limits, { minWidth: 180, minHeight: 96, maxWidth: 640, maxHeight: 720 });
});

test('opening the same card reuses its subwindow and refreshes the view', async () => {
  const { service, created } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  const next = { ...VIEW, title: 'Updated' };
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: next, size: SIZE }));

  assert.equal(created.length, 1);
  assert.equal(created[0].win.storage.get('card'), JSON.stringify(next));
});

test('position defaults to the top-right edge of the display', async () => {
  const { service, created } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  assert.deepEqual(created[0].win.moved, { x: 1440 - 320 - 24, y: 24 });
});

test('update stores a new view without touching the window lifecycle', async () => {
  const { service, created } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  const next = { ...VIEW, title: 'New title' };
  const result = JSON.parse(
    await service.handle(JSON.stringify({ action: 'update', cardId: 'card-1', view: next })),
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(created[0].win.storage.get('card'), JSON.stringify(next));
});

test('close destroys the subwindow, reports geometry, and notifies the host', async () => {
  const { service, created, closed, actions } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  const result = JSON.parse(await service.handle(JSON.stringify({ action: 'close', cardId: 'card-1' })));

  assert.deepEqual(result, { ok: true });
  assert.equal(created[0].win.destroyed, true);
  assert.deepEqual(closed, ['card-1']);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'geometry');
});

test('resize and focus reach the subwindow', async () => {
  const { service, created } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  created[0].win.shown = false;
  await service.handle(JSON.stringify({ action: 'resize', cardId: 'card-1', size: { width: 400, height: 300 } }));
  await service.handle(JSON.stringify({ action: 'focus', cardId: 'card-1' }));

  assert.deepEqual(created[0].win.resized, { width: 400, height: 300 });
  assert.equal(created[0].win.shown, true);
});

test('a system-destroyed subwindow is forgotten exactly once', async () => {
  const { service, created, closed } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  const destroy = created[0].win.listeners.get('windowEvent');
  assert.equal(typeof destroy, 'function');
  destroy(7);
  // A later host close must not report the card twice.
  await service.handle(JSON.stringify({ action: 'close', cardId: 'card-1' }));
  assert.deepEqual(closed, ['card-1']);
});

test('startMoving is routed through the installed singleton', async () => {
  const { service, created } = loadService();
  await service.handle(JSON.stringify({ action: 'open', cardId: 'card-1', view: VIEW, size: SIZE }));
  await service.startMoving('card-1');
  assert.equal(created[0].win.moving, true);
});

test('unsupported actions and malformed payloads fail loudly', async () => {
  const { service } = loadService();
  const unsupported = JSON.parse(await service.handle(JSON.stringify({ action: 'teleport', cardId: 'x' })));
  assert.equal(unsupported.ok, false);
  const malformed = JSON.parse(await service.handle('{not json'));
  assert.equal(malformed.ok, false);
});
