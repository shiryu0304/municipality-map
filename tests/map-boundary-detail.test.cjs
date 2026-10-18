const {test}=require('node:test'); const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('県を選択したときだけ境界を取得し、自治体コードで結びつける',async()=>{
 const a=createHarness();await a.settle();assert.equal(a.calls.urls.filter(u=>u.includes('/GeoJson/')).length,0);
 a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
 assert.ok(a.calls.urls.some(u=>u.endsWith('/GeoJson/13.json')));
 assert.equal(a.map.getSource('municipalities').data.features[0].properties.code,'131016');
 assert.equal(a.map.getSource('municipalities').data.features[0].properties.status,'visited');
});
test('データの閲覧だけで記録は変更されない',async()=>{
 const records={'131016':{status:'visited',memo:'keep'}};const before=JSON.stringify(records);
 const a=createHarness({records});await a.settle();await a.window.MainMapLibre.refreshRecords();
 assert.equal(JSON.stringify(records),before);
});
