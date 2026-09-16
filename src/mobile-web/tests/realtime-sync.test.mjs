import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(new URL('../../shared/relay-transport/AccountRealtime.ts',import.meta.url),'utf8');
const payloadSource = await readFile(new URL('../../shared/relay-transport/RpcPayload.ts', import.meta.url), 'utf8');
const payloadCode = ts.transpileModule(payloadSource, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const payloadUrl = `data:text/javascript;base64,${Buffer.from(payloadCode).toString('base64')}`;
const policySource = await readFile(new URL('../../shared/relay-transport/RpcPolicy.ts', import.meta.url), 'utf8');
const policyCode = ts.transpileModule(policySource, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const policyUrl = `data:text/javascript;base64,${Buffer.from(policyCode).toString('base64')}`;
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  .replace("'socket.io-client'",JSON.stringify(import.meta.resolve('socket.io-client')))
  .replace("'./RpcPayload'",JSON.stringify(payloadUrl))
  .replace("'./RpcPolicy'", JSON.stringify(policyUrl));
const {SessionSync}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(fetch) {
 let listener;let reconnect;let cursor=0;const applied=[];const errors=[];
 const sync=new SessionSync({onUpdate:f=>{listener=f;return()=>{}},onReconnect:f=>{reconnect=f;return()=>{}}},'s',{
  cursor:async()=>cursor,apply:async(messages,next)=>{applied.push(...messages.map(m=>m.seq));cursor=next;}
 },fetch,e=>errors.push(e));
 return {sync,applied,errors,update:seq=>listener({body:{sid:'s',message:{seq}}}),reconnect:()=>reconnect()};
}
test('live messages apply in sequence and duplicate notifications do not re-fetch or reapply',async()=>{
 let reads=0;const f=fixture(async()=>{reads++;return{messages:[],hasMore:false}});
 try {
  await tick();f.update(1);f.update(2);await tick();f.update(2);await tick();
  assert.deepEqual(f.applied,[1,2]);assert.equal(reads,1);assert.deepEqual(f.errors,[]);
 }finally{f.sync.close()}
});
test('a gap fetches the intervening sender and keeps the receive cursor independent',async()=>{
 const reads=[];const f=fixture(async cursor=>{reads.push(cursor);return{messages:cursor===0&&reads.length>1?[{seq:1},{seq:2},{seq:3}]:[],hasMore:false}});
 try {await tick();f.update(3);await tick();assert.deepEqual(f.applied,[1,2,3]);assert.deepEqual(reads,[0,0]);}
 finally{f.sync.close()}
});
test('reconnect reads from committed cursor and notification during a read is not stranded',async()=>{
 let release;let reads=0;
 const f=fixture(async cursor=>{reads++;if(reads===2)return new Promise(resolve=>release=resolve);return{messages:[],hasMore:false}});
 try {
  await tick();f.update(1);await tick();f.reconnect();await tick();f.update(3);
  release({messages:[{seq:2}],hasMore:false});await tick();await tick();
  assert.deepEqual(f.applied,[1,2,3]);assert.deepEqual(f.errors,[]);
 }finally{f.sync.close()}
});
test('closing during recovery prevents a late response from applying to a disposed account',async()=>{
 let release;const f=fixture(async()=>new Promise(resolve=>release=resolve));
 await tick();f.sync.close();release({messages:[{seq:1}],hasMore:false});await tick();assert.deepEqual(f.applied,[]);
});
test('a notification ahead of the readable log reports a recoverable gap',async()=>{
 const f=fixture(async()=>({messages:[],hasMore:false}));
 try {
  await tick();f.update(4);await tick();
  assert.equal(f.errors.length,1);
  assert.match(f.errors[0].message,/not supplied/);
  assert.deepEqual(f.applied,[]);
 }finally{f.sync.close()}
});
test('failed replica commit never advances the recovery cursor',async()=>{
 let commits=0;let cursor=0;let reconnect;const seen=[];const errors=[];
 const sync=new SessionSync({onUpdate:()=>()=>{},onReconnect:f=>{reconnect=f;return()=>{}}},'s',{
  cursor:async()=>cursor,
  apply:async(messages,next)=>{if(++commits===1)throw new Error('decrypt failed');cursor=next;}
 },async after=>{seen.push(after);return{messages:[{seq:1}],hasMore:false}},e=>errors.push(e));
 try {
  await tick();assert.equal(cursor,0);assert.equal(errors.length,1);
  await new Promise(resolve=>setTimeout(resolve,1050));
  assert.deepEqual(seen,[0,0]);assert.equal(cursor,1);
 }finally{sync.close()}
});

test('shared session cipher vector authenticates fragments and rejects wrong bindings', async () => {
  const source = await readFile(new URL('../../shared/relay-transport/SessionCipher.ts', import.meta.url),'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const {decryptSessionEvent} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const vector = JSON.parse(await readFile(new URL('../../shared/relay-transport/session-cipher.fixture.json', import.meta.url),'utf8'));
  assert.deepEqual(await decryptSessionEvent(vector.sessionId,vector.key,vector.fragments),vector.event);
  const { gcm } = await import('@noble/ciphers/aes.js');
  const previousCrypto=globalThis.crypto;
  try {
    Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
    assert.deepEqual(await decryptSessionEvent(vector.sessionId,vector.key,vector.fragments,(key,data,nonce)=>gcm(key,nonce).decrypt(data)),vector.event);
  } finally {Object.defineProperty(globalThis,'crypto',{value:previousCrypto,configurable:true});}
  await assert.rejects(decryptSessionEvent('other-session',vector.key,vector.fragments),/binding mismatch/);
  await assert.rejects(decryptSessionEvent(vector.sessionId,vector.key,[...vector.fragments].reverse()),/order mismatch/);
  await assert.rejects(decryptSessionEvent(vector.sessionId,vector.key,vector.fragments.slice(1)),/Incomplete/);
});

test('mobile canonical records replace by revision and never mix transcript RPC snapshots', async () => {
  async function compile(path, replacements = {}) {
    const source = await readFile(new URL(path, import.meta.url),'utf8');
    let code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    for (const [name,url] of Object.entries(replacements)) code=code.replace(`'${name}'`,JSON.stringify(url));
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  }
  const replica=await compile('../../shared/relay-transport/SessionRecordReplica.ts');
  const presentation=await compile('../src/services/SessionRecordPresentation.ts');
  const {SessionSynchronizer}=await import(await compile('../src/services/SessionSynchronizer.ts',{
    '../../../shared/relay-transport/SessionRecordReplica':replica,'./SessionRecordPresentation':presentation,
  }));
  let events,caughtUp,reads=0;
  const updates=[];
  const sync=new SessionSynchronizer({
    pollSession:async()=>{reads++;throw new Error('Legacy snapshot path entered')},
    subscribeSessionStream:async(_id,event,_error,ready)=>{events=event;caughtUp=ready;return{close(){},wake(){},async loadOlder(){}}},
  },'session',update=>updates.push(update));
  const record=(revision,text,status='inprogress')=>({session_id:'session',event:'session-record',payload:{sessionId:'session',id:'item/i',revision,
    turn:{sessionId:'session',turnId:'t',turnIndex:0,timestamp:1,status,userMessage:{id:'u',content:'hello',timestamp:1}},
    round:{id:'r',turnId:'t',roundIndex:0},item:{type:'text',data:{id:'i',content:text,orderIndex:0}}}});
  sync.start();await tick();events(record(1,'a'));assert.equal(updates.length,0);caughtUp();
  events(record(3,'abc','completed'));events(record(2,'ab'));
  assert.equal(updates.at(-1).message_snapshot[1].content,'abc');
  assert.equal(reads,0);
  events({session_id:'session',event:'session-record',payload:{sessionId:'session',id:'turn/t',revision:4,deleted:true}});
  assert.deepEqual(updates.at(-1).message_snapshot,[]);
  const count=updates.length;sync.stop();events(record(5,'late'));assert.equal(updates.length,count);
});

test('account presence invalidates directory without becoming session content', async () => {
  const handlers = new Map();
  const socket = {
    on(name, callback) { handlers.set(name, callback); },
    connect() {}, disconnect() {}, removeAllListeners() { handlers.clear(); },
  };
  globalThis.__directoryTestSocket = socket;
  const stub = 'data:text/javascript,export const io=()=>globalThis.__directoryTestSocket;';
  const adapted = code.replace(JSON.stringify(import.meta.resolve('socket.io-client')), JSON.stringify(stub));
  const { AccountRealtime } = await import(`data:text/javascript;base64,${Buffer.from(adapted).toString('base64')}`);
  const connection = new AccountRealtime({ url: 'https://relay.example/v/1.0.1', token: 'test' });
  try {
    let directory = 0, content = 0;
    connection.onDeviceDirectoryChanged(() => directory++);
    connection.onUpdate(() => content++);
    handlers.get('ephemeral')({ type: 'device-presence', devices: [{ device_id: 'runtime' }] });
    handlers.get('ephemeral')({ type: 'other' });
    assert.equal(directory, 1); assert.equal(content, 0);
    connection.close();
    assert.equal(handlers.size, 0);
  } finally { connection.close(); delete globalThis.__directoryTestSocket; }
});
