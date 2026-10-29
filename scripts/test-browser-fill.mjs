// Exercise the production fill script on real Chromium, without a Rust build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireE2e = createRequire(new URL('../tests/e2e/package.json', import.meta.url));
const puppeteer = createRequire(requireE2e.resolve('@wdio/cli'))('puppeteer-core');
const base = '../src/crates/assembly/core/src/agentic/tools/browser_control/';
const [fill, resolve] = await Promise.all([
  readFile(new URL(`${base}fill.js`, import.meta.url), 'utf8'),
  readFile(new URL(`${base}resolve_element.js`, import.meta.url), 'utf8'),
]);
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: 'new',
});
try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setContent(`<input id="text" value="old"><textarea id="comments">old</textarea>
    <input id="time" type="time"><input id="date" type="date">
    <input id="password" type="password"><input id="readonly" readonly value="keep">
    <input id="disabled" disabled value="keep"><input id="check" type="checkbox">
    <div id="editable" contenteditable>old</div><div id="shadow"></div><iframe id="frame"></iframe>`);
  await page.evaluate(() => {
    document.querySelector('#shadow').attachShadow({ mode: 'open' }).innerHTML = '<input id="shadow-input">';
    document.querySelector('#frame').contentDocument.body.innerHTML = '<input id="frame-input">';
    window.changes = [];
    document.addEventListener('input', event => window.changes.push(event.target.id));
    document.querySelector('#text').addEventListener('input', event => {
      window.controlledValue = event.target.value;
    });
  });
  const evaluate = (selector, value, verify) => page.evaluate(`(() => {
    const el = (${resolve})(${JSON.stringify(selector)});
    return (${fill})(el, ${JSON.stringify(value)}, ${verify});
  })()`);
  const runFill = async (selector, value, insert = true) => {
    const prepared = await evaluate(selector, value, false);
    if (prepared.insert_text && insert) await cdp.send('Input.insertText', { text: value });
    assert.deepEqual(await evaluate(selector, value, true), { verified: true });
  };
  for (const [selector, value] of [
    ['#text', '张三'], ['#text', 'replacement'], ['#comments', 'Line 1\nLine 2'],
    ['#time', '18:30'], ['#date', '2026-10-29'], ['#password', 'private-value'],
    ['#editable', 'new content'], ['#shadow-input', 'shadow text'], ['#frame-input', 'frame text'],
  ]) {
    await runFill(selector, value);
    console.log(`PASS verified fill ${selector}`);
  }
  assert.equal(await page.evaluate(() => window.controlledValue), 'replacement');
  assert.equal(await page.evaluate(() => window.changes.includes('time')), true);
  for (const selector of ['#readonly', '#disabled', '#check']) {
    await assert.rejects(() => runFill(selector, 'rejected'));
  }
  await assert.rejects(() => runFill('#time', 'not a time'), /did not retain/);
  await assert.rejects(() => runFill('#text', 'lost input', false), /did not retain/);
  console.log('PASS rejected non-editable fields, invalid values, and accepted commands without value changes');
} finally {
  await browser.close();
}
