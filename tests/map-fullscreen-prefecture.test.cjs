const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('全画面表示は元アプリの画面構造とボタンを使用する',async()=>{
 const a=createHarness();await a.settle();a.el('toggleMapFullscreen').click();
 assert.equal(a.el('toggleMapFullscreen').textContent,'閉じる');
 assert.equal(a.el('mapPanel').classList.contains('is-map-fullscreen'),true);
 assert.ok(a.map.resized>=1);
 a.el('toggleMapFullscreen').click();assert.equal(a.el('toggleMapFullscreen').textContent,'全画面表示');
});
test('市区町村をタップすると既存の記録編集ダイアログが開く',async()=>{
 const a=createHarness();await a.settle();
 a.map.emit('click','prefecture-fill',{features:[{properties:{pref:'東京都'}}]});await a.settle();
 a.map.emit('click','municipality-fill',{features:[{properties:{code:'131016'}}],lngLat:{lng:139.7,lat:35.7}});
 assert.equal(a.calls.popups.length,1);assert.equal(a.calls.popups[0].content.children[2].textContent,'記録を編集');
 a.calls.popups[0].content.children[2].click();
 assert.equal(a.calls.dialogs[0].code,'131016');
});
