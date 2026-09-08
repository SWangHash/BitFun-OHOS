import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

type Event = {type:'ready'|'resync'} | {type:'input';data:string} | {type:'resize';cols:number;rows:number};
type Frame = {epoch:string;revision:number;reset:boolean;data:string;theme?:{background:string;foreground:string;cursor?:string}};
declare global { interface Window {
  BitFunTerminalHost?:{postMessage:(message:string)=>void};
  webkit?:{messageHandlers?:{bitfunTerminal?:{postMessage:(event:Event)=>void}}};
  BitFunTerminal:{connect:()=>void;accept:(frame:Frame)=>void};
} }
const terminal = new Terminal({cursorBlink:true,scrollback:5000,convertEol:false,fontSize:14});
const fit = new FitAddon();terminal.loadAddon(fit);terminal.open(document.getElementById('terminal')!);
let epoch='';let revision=-1;
const pending: Frame[]=[];let writing=false;
function drain(){
  if(writing||!pending.length)return;
  const frame=pending.shift()!;writing=true;
  if(frame.reset)terminal.reset();if(frame.theme)terminal.options.theme=frame.theme;
  terminal.write(frame.data,()=>{writing=false;drain();});
}
function send(event:Event) {
  if(window.BitFunTerminalHost)window.BitFunTerminalHost.postMessage(JSON.stringify(event));
  else window.webkit?.messageHandlers?.bitfunTerminal?.postMessage(event);
}
terminal.onData(data=>send({type:'input',data}));
terminal.onResize(({cols,rows})=>send({type:'resize',cols,rows}));
new ResizeObserver(()=>fit.fit()).observe(document.getElementById('terminal')!);
window.BitFunTerminal={
  connect(){fit.fit();send({type:'ready'});send({type:'resize',cols:terminal.cols,rows:terminal.rows});},
  accept(frame){
    if(typeof frame.epoch!=='string'||!Number.isSafeInteger(frame.revision)||typeof frame.data!=='string')return;
    if(frame.epoch!==epoch){if(!frame.reset){send({type:'resync'});return;}epoch=frame.epoch;revision=-1;}
    if(frame.revision<=revision)return;
    if(!frame.reset&&frame.revision!==revision+1){send({type:'resync'});return;}
    pending.push(frame);revision=frame.revision;drain();
  },
};
window.BitFunTerminal.connect();
