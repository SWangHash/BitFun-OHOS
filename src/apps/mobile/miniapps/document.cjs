// Native hosts expose only the local storage/clipboard adapter to this trusted wrapper.
function build(html, locale) {
  const language = JSON.stringify(locale).replace(/</g, '\\u003c');
  const source = JSON.stringify(html.replace('<head>', `<head><script>window.__miniappLocale=${language};</script>`)).replace(/</g, '\\u003c');
  const timeout = JSON.stringify(locale === 'zh-CN' ? '操作超时，请重试' : 'Operation timed out. Try again.');
  const unsupported = JSON.stringify(locale === 'zh-CN' ? '此功能暂不支持' : 'This capability is unavailable.');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src blob:; base-uri 'none'; form-action 'none'">
<style>:root{color-scheme:light dark}html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}</style>
</head><body><iframe sandbox="allow-scripts" title="MiniApp"></iframe><script>
(()=>{
const frame=document.querySelector('iframe');
const pending=new Map();
window.__miniappReply=(reply)=>{if(!pending.has(reply.id))return;clearTimeout(pending.get(reply.id));pending.delete(reply.id);frame.contentWindow.postMessage(reply,'*');};
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow)return;
 const data=event.data;
 if(!data||typeof data!=='object')return;
 if(data.method==='openbitfun/request-locale'){
   frame.contentWindow.postMessage({type:'openbitfun:event',event:'localeChange',payload:{locale:${language},unsupported:${unsupported}}},'*');return;
 }
 if(typeof data.id!=='string'||typeof data.method!=='string'||pending.has(data.id))return;
 const replyError=message=>window.__miniappReply({jsonrpc:'2.0',id:data.id,error:{message}});
 pending.set(data.id,setTimeout(()=>replyError(${timeout}),10000));
 if(!['storage.get','storage.set','clipboard.writeText'].includes(data.method)){replyError(${unsupported});return;}
 try{const request=JSON.stringify({id:data.id,method:data.method,params:data.params});
 if(window.webkit?.messageHandlers?.miniappNative)window.webkit.messageHandlers.miniappNative.postMessage(request);
 else miniappNative.request(request);}
 catch(error){replyError(String(error));}
});
const url=URL.createObjectURL(new Blob([${source}],{type:'text/html'}));
frame.src=url;
frame.addEventListener('load',()=>{frame.dataset.loaded='true';frame.contentWindow.postMessage({type:'openbitfun:event',event:'activate',payload:{}},'*');});
})();
</script></body></html>`;
}
module.exports = { build };
