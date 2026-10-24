const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/services/BrowserWebviewService.ets'),
  'utf8',
);
const webviewSource = fs.readFileSync(
  path.join(__dirname, '../oh-rs-ability/src/main/ets/webview/DefaultWebview.ets'),
  'utf8',
);
const helperSource = fs.readFileSync(
  path.join(__dirname, '../oh-rs-ability/src/main/ets/webview/Utils.ets'),
  'utf8',
);
const { outputText } = ts.transpileModule(serviceSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

function serviceHost(setBounds, onCreate = () => {}, runJavaScript = async () => '') {
  const exports = {};
  const helper = {
    loadUrl() {},
    setBounds,
    // The legacy helper only delivers successful evaluations to its callback.
    runJavaScript: (script, callback) => { runJavaScript(script).then(callback, () => {}); },
  };
  const controller = {
    addWebview: data => {
      data.controller = { runJavaScript };
      onCreate(data);
      return { webTag: 'browser-test', controller: helper };
    },
    removeWebview() {},
  };
  global.AppStorage = { get: () => controller };
  const modules = {
    '@kit.PerformanceAnalysisKit': { hilog: { info() {}, warn() {} } },
    'libbitfun_desktop_lib.so': { default: { emitBrowserPageLoad() {} } },
    '@ohos-rs/ability': {},
  };
  new Function('require', 'exports', outputText)(name => modules[name], exports);
  exports.BrowserWebviewService.instance = null;
  return exports.BrowserWebviewService.getInstance();
}

test('embedded browser enables DOM storage before loading a web page', async () => {
  // Execute the production builder with the ArkUI attribute boundary mocked.
  // Inspect the applied setting when the controller starts its first navigation.
  const builderSource = webviewSource.match(/@Builder\s+(function WebBuilder[\s\S]*?)\nconst webViewWrap/)[1];
  const builderJs = ts.transpileModule(builderSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let attach;
  let storageEnabled = false; // ArkWeb's default when domStorageAccess is omitted.
  const attributes = new Proxy({}, {
    get: (_, name) => value => {
      if (name === 'domStorageAccess') storageEnabled = value;
      if (name === 'onControllerAttached') attach = value;
      return attributes;
    },
  });
  const build = new Function('Web', 'WebDarkMode', 'Visibility', `${builderJs}\nreturn WebBuilder;`)(
    () => attributes,
    { Auto: 'auto' },
    { Hidden: 'hidden', Visible: 'visible' },
  );
  const navigations = [];
  const service = serviceHost(() => true, data => {
    build({
      ...data,
      controller: {
        loadUrl: url => navigations.push({ url, storageEnabled }),
      },
    });
    attach();
  });

  assert.deepEqual(JSON.parse(await service.create({
    label: 'browser', url: 'https://example.test/pulls/new',
    x: 0, y: 0, width: 800, height: 600,
  })), { ok: true });
  assert.deepEqual(navigations, [{ url: 'https://example.test/pulls/new', storageEnabled: true }]);
});

test('script evaluation returns native results and failures to the caller', { timeout: 1000 }, async () => {
  const failure = { code: 17100001, message: 'Controller is not attached' };
  const service = serviceHost(() => true, () => {}, script => {
    if (script === 'throw') throw failure;
    if (script === 'reject') return Promise.reject(failure);
    return Promise.resolve('page result');
  });
  await service.create({ label: 'browser', url: 'https://example.test', x: 0, y: 0, width: 200, height: 100 });

  assert.deepEqual(JSON.parse(await service.eval({ label: 'browser', script: 'succeed' })), {
    ok: true, result: 'page result',
  });
  for (const script of ['throw', 'reject']) {
    const response = JSON.parse(await service.eval({ label: 'browser', script }));
    assert.match(response.error, /Controller is not attached/);
  }
});

test('bounds updates report whether the ArkUI node accepted the rectangle', async () => {
  const calls = [];
  const service = serviceHost((...bounds) => {
    calls.push(bounds);
    return true;
  });
  await service.create({ label: 'browser', url: 'https://example.test', x: 0, y: 0, width: 200, height: 100 });

  assert.deepEqual(
    JSON.parse(await service.setBounds({ label: 'browser', x: 10, y: 20, width: 800, height: 600 })),
    { ok: true },
  );
  assert.deepEqual(calls, [[10, 20, 800, 600]]);

  const unavailable = serviceHost(() => false);
  await unavailable.create({ label: 'browser', url: 'https://example.test', x: 0, y: 0, width: 200, height: 100 });
  assert.match(JSON.parse(await unavailable.setBounds({ label: 'browser', x: 0, y: 0, width: 1, height: 1 })).error, /node not ready/);
});

test('style-only BuilderNode updates cannot reload browser content', () => {
  assert.match(webviewSource, /if \(data\.contentLoaded\) \{\s*return;\s*\}/);
  assert.match(webviewSource, /data\.contentLoaded = true;\s*const ctrl = data\.controller;/);
  assert.match(helperSource, /setBounds: \(x: number, y: number, width: number, height: number\) => boolean/);
});

test('bounds updates reapply Web component bounds so ArkWeb resizes its viewport', () => {
  const boundsBody = webviewSource.match(
    /const setBounds = \(x: number, y: number, width: number, height: number\): boolean => \{([\s\S]*?)\n    \};/,
  )?.[1] ?? '';
  assert.match(boundsBody, /node\.update\(initData\);/);
  assert.doesNotMatch(boundsBody, /frameNode\.setMeasuredSize\(/);
  assert.doesNotMatch(boundsBody, /frameNode\.setLayoutPosition\(/);
});

test('internal drags keep the drop hint but skip the native file retry path on drop', () => {
  assert.match(webviewSource, /function classifyNativeDragData\(dragEvent: DragEvent\): NativeDragDataKind/);
  assert.match(webviewSource, /\.onDragEnter\(\(dragEvent: DragEvent\) => \{[\s\S]*?dispatchNativeDragEvent\(data\.controller, "enter", \[\]\);/);
  assert.match(webviewSource, /if \(classifyNativeDragData\(dragEvent\) === NativeDragDataKind\.NonFile\) \{[\s\S]*?dispatchNativeDragEvent\(data\.controller, "drop", \[\], \[\]\);\s*return;/);
});

test('the web component opts out of ArkWeb overlay scrollbars', () => {
  const builder = webviewSource.match(/function WebBuilder\(data: WebviewNodeData\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  // ArkWeb's default overlay thumb paints over page content and cannot be
  // dragged with a mouse; the resident scrollbar keeps its own column.
  assert.match(builder, /\.forceDisplayScrollBar\(true\)/);
});
