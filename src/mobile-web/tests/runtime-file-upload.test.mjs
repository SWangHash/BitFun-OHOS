import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {sha256} from '@noble/hashes/sha2.js';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../src/services/RuntimeFileUpload.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace('@noble/hashes/sha2.js',pathToFileURL(require.resolve('@noble/hashes/sha2.js')).href);
const {uploadRuntimeFile}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('large upload reads bounded chunks and resolves lost append/finish acknowledgements by cursor',async()=>{
 const data=Buffer.alloc(10*1024*1024+17,29);let maxRead=0;
 const file={size:data.length,slice:(start,end)=>{maxRead=Math.max(maxRead,end-start);return new Blob([data.subarray(start,end)])}};
 let offset=0,completed=false,lostAppend=false,lostFinish=false;const chunks=[];let expectedHash;
 const invoke=async request=>{
  assert.equal(request.workspacePath,"/runtime");assert.equal(request.remoteConnectionId,"saved-profile");
  if(request.action==='begin')expectedHash=request.sha256;
  if(request.action==='append'){
   assert.equal(request.offset,offset);const chunk=Buffer.from(request.contentBase64,'base64');chunks.push(chunk);offset+=chunk.length;
   if(!lostAppend){lostAppend=true;throw Error('ACK lost');}
  }
  if(request.action==='finish'){completed=true;if(!lostFinish){lostFinish=true;throw Error('ACK lost');}}
  return{transferId:'test',totalBytes:data.length,nextOffset:offset,completed};
 };
 await uploadRuntimeFile(file,{path:'/runtime/new',workspacePath:'/runtime',remoteConnectionId:'saved-profile'},'test',invoke,()=>true,()=>{});
 assert.deepEqual(Buffer.concat(chunks),data);assert.equal(expectedHash,Buffer.from(sha256(data)).toString('hex'));
 assert.ok(maxRead<=3*1024*1024);assert.equal(completed,true);
});
test('changing the controlled runtime stops all subsequent upload requests',async()=>{
 let current=true;const actions=[];
 await assert.rejects(uploadRuntimeFile(new Blob(['bytes']),{path:'/runtime/new',workspacePath:'/runtime',remoteConnectionId:'saved-profile'},'test',async request=>{
  actions.push(request.action);current=false;return{transferId:'test',totalBytes:5,nextOffset:0,completed:false};
 },()=>current,()=>{}),/target changed/);
 assert.deepEqual(actions,['begin']);
});

test('captures upload provider identity before asynchronous work',async()=>{
 const target={path:'/original/file',workspacePath:'/original',remoteConnectionId:'saved-profile'};
 const seen=[];let offset=0;
 await uploadRuntimeFile(new Blob(['bytes']),target,'test',async request=>{
  seen.push(request);target.workspacePath='/other';target.remoteConnectionId='other-profile';
  if(request.action==='append')offset=5;
  return{transferId:'test',totalBytes:5,nextOffset:offset,completed:request.action==='finish'};
 },()=>true,()=>{});
 for(const request of seen){assert.equal(request.workspacePath,'/original');assert.equal(request.remoteConnectionId,'saved-profile');}
});
