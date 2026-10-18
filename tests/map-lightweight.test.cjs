const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('再選択は県別詳細データをキャッシュし、再取得しない',async()=>{
 const a=createHarness();await a.settle();
 a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
 a.el('resetMapView').click();await a.settle();
 a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
 assert.equal(a.calls.urls.filter(u=>u.endsWith('/GeoJson/13.json')).length,1);
});
test('訪問記録を編集すると、地図の色だけが更新され、再取得は発生しない',async()=>{
 const a=createHarness();await a.settle();
 a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
 const before=a.calls.urls.length;
 a.setRecords({'131016':{status:'passed'}});a.window.MainMapLibre.refreshRecords();
 assert.equal(a.map.getSource('municipalities').data.features[0].properties.status,'passed');
 assert.equal(a.calls.urls.length,before);
});
