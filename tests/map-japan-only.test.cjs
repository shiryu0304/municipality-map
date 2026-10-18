const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('背景タイルは初期表示で通信せず、地図の起動を妨げない',async()=>{
 const a=createHarness();await a.settle();
 assert.equal(a.map.options.style.layers[0].type,'background');
 assert.equal(a.map.getSource('ocean'),undefined);
 assert.equal(a.calls.urls.some(u=>u.includes('World_Ocean_Base')),false);
});
test('全都道府県境界は最初に表示され、全国で詳細境界をダウンロードしない',async()=>{
 const a=createHarness();await a.settle();
 assert.equal(a.map.getSource('prefectures').data.features.length,2);
 assert.equal(a.calls.urls.filter(u=>u.includes('GeoJson')).length,0);
});
