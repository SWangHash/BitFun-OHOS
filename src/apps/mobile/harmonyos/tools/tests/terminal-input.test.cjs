const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function fixture() {
  const source=fs.readFileSync(path.join(__dirname,'../../entry/src/main/ets/pages/viewmodel/WorkspaceToolsViewModel.ets'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exported={};
  new Function('require','exports',compiled)(name=>name.endsWith('WorkspaceFileUploadClient')?{WorkspaceFileUploadClient:class{}}:{},exported);
  const state={visible:true,busy:true,terminalId:'terminal',output:'',error:''};
  const writes=[]; let release;
  const first=new Promise(resolve=>{release=resolve;});
  const manager={async hostInvoke(command,args){writes.push({command,args});if(writes.length===1)await first;return {};}};
  const vm=new exported.WorkspaceToolsViewModel(state,manager,()=> 'runtime');vm.owner='runtime';
  return {vm,state,writes,release};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
test('native terminal input is coalesced and ordered while unrelated file UI is busy',async()=>{
 const f=fixture();f.vm.dispatch({type:'terminal-write',text:'a'});f.vm.dispatch({type:'terminal-write',text:'b'});f.vm.dispatch({type:'terminal-write',text:'c'});
 await pause(); assert.equal(f.writes.length,1);assert.equal(f.writes[0].args.request.data,'abc');
 f.vm.dispatch({type:'terminal-write',text:'de'});f.vm.dispatch({type:'terminal-write',text:'f'});await pause();assert.equal(f.writes.length,1);
 f.release();await pause();assert.equal(f.writes.length,2);assert.equal(f.writes[1].args.request.data,'def');
});
test('closing the terminal controller drops unsent input without replaying an uncertain mutation',async()=>{
 const f=fixture();f.vm.dispatch({type:'terminal-write',text:'first'});await pause();f.vm.dispatch({type:'terminal-write',text:'unsent'});f.vm.dispatch({type:'close'});f.release();await pause();assert.equal(f.writes.length,1);
});
