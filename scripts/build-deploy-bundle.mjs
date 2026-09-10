import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const dist=path.join(root,'dist');
await fs.rm(dist,{recursive:true,force:true}); await fs.mkdir(path.join(dist,'api'),{recursive:true});
const read=rel=>fs.readFile(path.join(root,rel),'utf8');
const stripImports=s=>s.replace(/^import[^;]+;\s*$/gm,'');
const stripExports=s=>s.replace(/\bexport\s+(?=(?:const|let|var|function|class)\b)/g,'');
const geometry=stripExports(await read('lib/geometry.js'));
const schedule=stripExports(await read('lib/schedule.js'));
const engine=stripExports(stripImports(await read('lib/engine.js')));
const sources=stripExports(await read('lib/sources.js'));
const liveApi=stripImports(await read('api/live.js'));
const historyApi=stripImports(await read('api/history.js'));
await fs.writeFile(path.join(dist,'api/live.js'),[geometry,schedule,engine,sources,liveApi].join('\n\n'));
await fs.writeFile(path.join(dist,'api/history.js'),[schedule,historyApi].join('\n\n'));
await fs.copyFile(path.join(root,'api/health.js'),path.join(dist,'api/health.js'));
const html=await read('index.html'); const css=await read('styles.css'); const app=stripImports(await read('app.js'));
const inlined=html
 .replace('<link rel="stylesheet" href="/styles.css" />',`<style>${css}</style>`)
 .replace('<script type="module" src="/app.js"></script>',`<script type="module">${geometry}\n${app}</script>`);
await fs.writeFile(path.join(dist,'index.html'),inlined);
await fs.writeFile(path.join(dist,'package.json'),JSON.stringify({name:'gauley-release-live',private:true,type:'module',engines:{node:'22.x'}},null,2));
await fs.copyFile(path.join(root,'vercel.json'),path.join(dist,'vercel.json'));
console.log('Built',dist);
