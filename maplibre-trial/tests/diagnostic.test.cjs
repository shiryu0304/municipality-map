'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const bootstrap = fs.readFileSync(path.join(root,'bootstrap.js'),'utf8');

function flush(){return new Promise(resolve=>setImmediate(resolve));}

test('v4: HTMLにスクリプト依存のない独立した診断欄とバージョンがある',()=>{
 assert.match(html,/試作版 v4・診断付き/);
 assert.match(html,/id="diagnosticText"/);
 assert.match(html,/MapTrialDiagnostics/);
 assert.match(html,/!mapReady && !fault/);
 assert.match(html,/bootstrap\.js\?v=4/);
 assert.doesNotMatch(html,/<script defer src="app\.js/);
});

test('v4: 地図ライブラリの第一配信元が不調なら第二を試してからアプリを起動する',async()=>{
 const scriptUrls=[];
 const statuses=[];
 const fakeWindow={MapTrialLogic:{},maplibregl:undefined,MapTrialStarted:false,
   MapTrialDiagnostics:{mark:x=>statuses.push(x),fail:x=>statuses.push('ERR:'+x)}};
 const head={appendChild(el){
   scriptUrls.push(el.src);
   // First CDN fails, backup CDN succeeds, app.js succeeds.
   if(scriptUrls.length===1) queueMicrotask(()=>el.onerror());
   else queueMicrotask(()=>{
     if (scriptUrls.length===2) fakeWindow.maplibregl={};
     if (scriptUrls.length===3) fakeWindow.MapTrialStarted=true;
     el.onload();
   });
 }};
 const ctx={window:fakeWindow,document:{head,createElement(){return {remove(){}};}},
   setTimeout:()=>1,clearTimeout(){},Promise,console};
 vm.runInNewContext(bootstrap,ctx,{filename:'bootstrap.js'});
 for(let i=0;i<5;i++)await flush();
 assert.equal(scriptUrls.length,3);
 assert.match(scriptUrls[0],/jsdelivr/);
 assert.match(scriptUrls[1],/unpkg/);
 assert.equal(scriptUrls[2],'app.js?v=4');
 assert.ok(!statuses.some(x=>x.startsWith('ERR:')));
});

test('v4: 両方の配信元が失敗すれば画面の診断へ通知する',async()=>{
 const reports=[];
 const fakeWindow={MapTrialLogic:{},MapTrialDiagnostics:{mark(){},fail:x=>reports.push(x)}};
 const ctx={window:fakeWindow,document:{head:{appendChild(el){queueMicrotask(()=>el.onerror());}},createElement(){return {remove(){}};}},
 setTimeout:()=>1,clearTimeout(){},Promise,console};
 vm.runInNewContext(bootstrap,ctx,{filename:'bootstrap.js'});
 for(let i=0;i<5;i++)await flush();
 assert.match(reports.join(' '),/2つの配信先/);
});
