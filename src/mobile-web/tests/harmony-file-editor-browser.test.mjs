import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launchBrowser } from './helpers/browser-account-harness.mjs';
test('Harmony file renderer keeps line numbers aligned, views read-only and emits edit text', {timeout:30000}, async()=>{
 const html=await readFile(new URL('../../apps/mobile/harmonyos/entry/src/main/resources/rawfile/editor/index.html',import.meta.url),'utf8');
 const browser=await launchBrowser();
 try {
  const page=await browser.newPage();await page.setViewport({width:400,height:300});
  await page.evaluateOnNewDocument(()=>{window.events=[];window.BitFunEditorHost={postMessage:raw=>window.events.push(JSON.parse(raw))};});
  await page.goto('data:text/html,'+encodeURIComponent(html));
  await page.evaluate(()=>window.BitFunEditor.accept({content:Array.from({length:100},(_,i)=>'line '+i+' '+'.'.repeat(160)).join('\n'),editing:false,lineNumbers:true,ink:'black',muted:'gray'}));
  assert.equal(await page.$eval('#editor',el=>el.readOnly),true);
  const before=await page.$eval('#editor',el=>el.value);await page.click('#editor');await page.keyboard.type('must-not-write');assert.equal(await page.$eval('#editor',el=>el.value),before);
  await page.evaluate(()=>{const el=document.querySelector('#editor');el.scrollTop=450;el.dispatchEvent(new Event('scroll'));});
  assert.equal(await page.$eval('#gutter',el=>el.scrollTop),await page.$eval('#editor',el=>el.scrollTop));
  assert.equal(await page.$eval('#gutter',el=>el.textContent.split('\n').length),100);
  await page.evaluate(()=>window.BitFunEditor.accept({content:'abc',editing:true,lineNumbers:true,ink:'black',muted:'gray'}));
  await page.click('#editor');await page.keyboard.press('End');await page.keyboard.type('d');assert.equal((await page.evaluate(()=>window.events.filter(e=>e.type==='edit').at(-1))).text,'abcd');
  await page.evaluate(()=>window.BitFunEditor.accept({content:'abcd',editing:true,lineNumbers:false,ink:'black',muted:'gray'}));assert.equal(await page.$eval('#gutter',el=>el.hidden),true);
 } finally {await browser.close();}
});
