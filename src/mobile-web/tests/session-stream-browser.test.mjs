import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {launchBrowser,startSourceServer,RelayFixture,LAN} from './helpers/browser-account-harness.mjs';

test('real browser replica opens latest page, loads older records, resumes on visibility and deduplicates live echo', {timeout:40000},async()=>{
 const source=await startSourceServer();const browser=await launchBrowser();
 try {
  const page=await browser.newPage();await page.goto(source.origin);
  const module=fileURLToPath(new URL('../../shared/relay-transport/SessionStream.ts',import.meta.url));
  const result=await page.evaluate(async path=>{
   const {openSessionStream}=await import('/@fs'+path);
   const b64=bytes=>btoa(String.fromCharCode(...bytes));
   const raw=new Uint8Array(32).fill(7);const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
   const messages=[];
   for(let seq=1;seq<=150;seq++){
    const nonce=crypto.getRandomValues(new Uint8Array(12));
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,new TextEncoder().encode(JSON.stringify({session_id:'browser-test',event:'test',payload:{seq}})));
    const envelope=new TextEncoder().encode(JSON.stringify({nonce:b64(nonce),data:b64(new Uint8Array(data))}));
    messages.push({seq,id:String(seq),localId:String(seq),content:{t:'encrypted',c:JSON.stringify({v:1,eventId:String(seq).padStart(20,'0'),index:0,count:1,data:b64(envelope)})}});
   }
   const queries=[];const originalFetch=window.fetch;
   window.fetch=async input=>{
    const url=new URL(String(input));queries.push(url.search);
    const before=url.searchParams.get('before_seq');
    const after=Number(url.searchParams.get('after_seq')??0);
    const eligible=before?messages.filter(m=>m.seq<Number(before)).reverse():messages.filter(m=>m.seq>after);
    return new Response(JSON.stringify({messages:eligible.slice(0,100),hasMore:eligible.length>100}),{status:200});
   };
   let update;let history;let catches=0;const seen=[];
   const stream=await openSessionStream({connection:{onUpdate:f=>{update=f;return()=>{}},onReconnect:()=>()=>{}},relay:'https://fixture.invalid',token:'fixture',account:'a',machine:'m',sessionId:'browser-test',relaySessionId:'r',key:b64(raw),onEvent:event=>seen.push(event.payload.seq),onError:error=>{throw error},onCaughtUp:()=>catches++,onHistoryState:state=>history=state});
   await new Promise(resolve=>setTimeout(resolve,100));
   const first=[...seen];await new Promise(resolve=>setTimeout(resolve,300));
   const prefetched=seen.length;const beforeManual=queries.length;await stream.loadOlder();const afterManual=queries.length;
   const all=[...seen];const requests=queries.length;
   update({body:{sid:'r',message:messages[149]}});await new Promise(resolve=>setTimeout(resolve,50));
   const afterEcho=queries.length;
   document.dispatchEvent(new Event('visibilitychange'));await new Promise(resolve=>setTimeout(resolve,100));
   const resumed=queries.length>afterEcho;
   stream.close();window.fetch=originalFetch;
   return{first,all,history,requests,afterEcho,resumed,catches,prefetched,beforeManual,afterManual};
  },module);
  assert.equal(result.first.length,100);assert.equal(result.first[0],51);assert.equal(result.first.at(-1),150);
  assert.equal(result.prefetched,150);assert.equal(result.beforeManual,result.afterManual);
  assert.equal(new Set(result.all).size,150);assert.equal(result.history.hasMore,false);
  assert.equal(result.afterEcho,result.requests);assert.equal(result.resumed,true);assert.ok(result.catches>0);
 }finally{await browser.close();await source.close();}
});

test('LAN HTTP source uses the injected cipher when WebCrypto is unavailable', {timeout:40000}, async()=>{
 const source=await startSourceServer();const browser=await launchBrowser();
 try {
  const context=await browser.createIncognitoBrowserContext();
  const fixture=new RelayFixture();
  const page=await fixture.page(context,source.origin,LAN+'/?account-store-test=1');
  const vector=JSON.parse(await readFile(new URL('../../shared/relay-transport/session-cipher.fixture.json',import.meta.url),'utf8'));
  const module=fileURLToPath(new URL('../../shared/relay-transport/SessionCipher.ts',import.meta.url));
  const result=await page.evaluate(async({path,vector})=>{
   const {decryptSessionEvent}=await import('/@fs'+path);
   const {decryptBytes}=await import('/src/services/E2EEncryption.ts');
   return {secure:window.isSecureContext,subtle:!!crypto.subtle,event:await decryptSessionEvent(vector.sessionId,vector.key,vector.fragments,decryptBytes)};
  },{path:module,vector});
  assert.equal(result.secure,false);assert.equal(result.subtle,false);assert.deepEqual(result.event,vector.event);
 }finally{await browser.close();await source.close();}
});
