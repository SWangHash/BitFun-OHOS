const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function fixture(){
 const source=fs.readFileSync(path.join(__dirname,'../../entry/src/main/ets/pages/viewmodel/WorkspaceToolsViewModel.ets'),'utf8');const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const exports={};new Function('require','exports',js)(name=>name.endsWith('WorkspaceFileUploadClient')?{WorkspaceFileUploadClient:class{hasPending(){return false;}}}:name.endsWith('Encoding')?{Encoding:{sha256:async value=>'hash:'+value}}:{},exports);
 const state={visible:true,busy:false,dirty:false,editorVisible:false,editing:false,content:'',selectedFile:'',directory:'/project',entries:[],sort:0};const calls=[];const manager={async hostInvoke(command,args){calls.push({command,args});if(command==='read_file_content')return 'original';if(command==='terminal_list')return [];return {children:[],hasMore:false};}};
 const vm=new exports.WorkspaceToolsViewModel(state,manager,()=> 'runtime');vm.owner='runtime';vm.location={path:'/project',remoteConnectionId:'saved-ssh'};return {vm,state,calls};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('viewer opens independently; cancel preserves edits and discard returns to same directory',async()=>{const f=fixture();f.vm.dispatch({type:'read',path:'/project/a'});await tick();assert.equal(f.state.editorVisible,true);assert.equal(f.state.editing,false);f.vm.dispatch({type:'editor-edit'});f.vm.dispatch({type:'edit',text:'changed'});f.vm.dispatch({type:'editor-back'});assert.equal(f.state.confirmDiscard,true);assert.equal(f.state.editorVisible,true);f.vm.dispatch({type:'discard-cancel'});assert.equal(f.state.content,'changed');f.vm.dispatch({type:'editor-back'});f.vm.dispatch({type:'discard-confirm'});assert.equal(f.state.editorVisible,false);assert.equal(f.state.directory,'/project');assert.equal(f.state.content,'original');assert.equal(f.calls.length,1);});
test('server sort is sent with stable SSH workspace identity and resets pagination',async()=>{const f=fixture();for(let sort=0;sort<4;sort++){f.vm.dispatch({type:'sort',text:String(sort)});await tick();const request=f.calls.at(-1).args.request;assert.equal(request.sortBy,sort<2?'name':'modified');assert.equal(request.sortOrder,sort%2?'desc':'asc');assert.equal(request.remoteConnectionId,'saved-ssh');assert.equal(request.offset,0);}});
test('saved runtime folder browsing never changes the active workspace',async()=>{const f=fixture();f.vm.dispatch({type:'browse-workspace',path:'/remote/folder',text:'saved-other'});await tick();assert.deepEqual(f.calls.map(x=>x.command),['get_directory_children_paginated']);assert.equal(f.calls[0].args.request.remoteConnectionId,'saved-other');assert.equal(f.state.directory,'/project');assert.equal(f.state.browsePath,'/remote/folder');});
test('successful save keeps editor open and clears dirty state with expected hash',async()=>{const f=fixture();f.vm.dispatch({type:'read',path:'/project/a'});await tick();f.vm.dispatch({type:'edit',text:'new'});f.vm.dispatch({type:'save'});await tick();assert.equal(f.state.editorVisible,true);assert.equal(f.state.dirty,false);const request=f.calls.find(x=>x.command==='write_file_content').args.request;assert.equal(request.expectedHash,'hash:original');assert.equal(request.content,'new');});

test('workspace menu captures the clicked root and saved connection without consulting global selection',async()=>{const f=fixture();f.vm.dispatch({type:'open',deviceId:'runtime',path:'/other',connectionId:'saved-clicked',tab:1});await tick();assert.equal(f.state.directory,'/other');assert.equal(f.state.initialTab,1);const request=f.calls[0].args.request;assert.equal(request.path,'/other');assert.equal(request.remoteConnectionId,'saved-clicked');assert.equal(f.vm.location.path,'/other');});

test('sidebar final entry hierarchy keeps modes in workspace plus and tools in the footer',()=>{
 const components=path.join(__dirname,'../../entry/src/main/ets/pages/components');
 const group=fs.readFileSync(path.join(components,'SidebarDeviceGroup.ets'),'utf8');
 const menu=group.slice(group.indexOf('private CreateModeMenu()'),group.indexOf('private SessionLoadingRow()'));
 assert.match(menu,/HarnessProfileMenu\(\{ showTitle: false/);
 assert.doesNotMatch(menu,/supportsHarnessProfiles|workspaceTools\.files|workspaceTools\.terminal|openWorkspaceTools/);
 const sidebar=fs.readFileSync(path.join(components,'AppSidebar.ets'),'utf8');
 assert.doesNotMatch(sidebar,/requestChat|sidebar\.newChat|sidebar\.conversations/);
 assert.match(sidebar,/workspaceTools\.title/);
 assert.match(sidebar,/toolsPickerTargetId !== this.controlTargetDeviceId/);
 assert.match(sidebar,/type: 'open-device', deviceId: this.toolsPickerTargetId/);
 for(const host of ['WideConversationHost.ets','AppRootOverlaySurfaces.ets']){
  const source=fs.readFileSync(path.join(components,host),'utf8');
  assert.match(source,/toolLocations: this.remotePageState.savedConnectionsTargetId/);
  assert.match(source,/onWorkspaceTools: this.actions.onWorkspaceTools/);
 }
});
test('device tools local default comes from serving runtime home without reading or changing workspace',async()=>{
 const f=fixture();f.vm.manager.hostInvoke=async(command,args)=>{f.calls.push({command,args});if(command==='get_system_info')return {homeDir:'/runtime-home'};if(command==='terminal_list')return [{id:'other-cwd',initialCwd:'/elsewhere',connectionId:''},{id:'ssh',connectionId:'saved'}];return {children:[],hasMore:false};};
 f.vm.dispatch({type:'open-device',deviceId:'runtime',connectionId:''});await tick();
 assert.equal(f.state.directory,'/runtime-home');assert.deepEqual(f.state.terminals.map(x=>x.id),['other-cwd']);
 assert.deepEqual(f.calls.map(x=>x.command),['get_system_info','get_directory_children_paginated','terminal_list']);
 assert.equal(f.calls[1].args.request.remoteConnectionId,'');
});
test('device tools saved SSH starts at POSIX root independently of runtime selected workspace',async()=>{
 const f=fixture();f.vm.dispatch({type:'open-device',deviceId:'runtime',connectionId:'saved-other'});await tick();
 assert.equal(f.state.directory,'/');assert.equal(f.calls[0].command,'get_directory_children_paginated');assert.equal(f.calls[0].args.request.remoteConnectionId,'saved-other');
 f.vm.dispatch({type:'directory',path:'/etc'});await tick();assert.equal(f.vm.location.path,'/etc');assert.equal(f.vm.location.remoteConnectionId,'saved-other');
});
test('device parent navigation uses serving-runtime syntax for POSIX and Windows roots',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../entry/src/main/ets/pages/policy/RuntimeLocationPolicy.ets'),'utf8');const exports={};
 new Function('exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);
 const parent=exports.RuntimeLocationPolicy.parent;
 assert.equal(parent('/home/user'),'/home');assert.equal(parent('/'),'/');
 assert.equal(parent('C:\\Users\\name'),'C:/Users');assert.equal(parent('C:/'),'C:/');
 assert.equal(parent('\\\\server\\share\\folder'),'//server/share');
});
