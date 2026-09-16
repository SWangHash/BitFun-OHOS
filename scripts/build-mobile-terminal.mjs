import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(path.join(root,'src/mobile-web/package.json'));
const {build}=createRequire(require.resolve('vite'))('esbuild');
const output=path.join(root,'src/shared/terminal/webview/generated');
await mkdir(output,{recursive:true});
await build({entryPoints:[path.join(root,'src/shared/terminal/webview/index.ts')],outfile:path.join(output,'terminal.js'),bundle:true,minify:true,format:'iife',platform:'browser',target:'es2020',legalComments:'inline',nodePaths:[path.join(root,'src/mobile-web/node_modules')]});
await writeFile(path.join(output,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'"><link rel="stylesheet" href="terminal.css"><style>html,body,#terminal{height:100%;width:100%;margin:0;overflow:hidden}</style></head><body><div id="terminal"></div><script src="terminal.js"></script></body></html>`);
if(process.argv.includes('--harmony')){
 const dest=path.join(root,'src/apps/mobile/harmonyos/entry/src/main/resources/rawfile/terminal');await mkdir(dest,{recursive:true});
 for(const name of ['index.html','terminal.js','terminal.css'])await copyFile(path.join(output,name),path.join(dest,name));
}
console.log('Built shared native terminal assets.');
