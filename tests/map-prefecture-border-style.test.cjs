const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('県境を市区町村の境界線より前に表示し、選択時は太くする',async()=>{
 const a=createHarness();await a.settle();
 a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
 const width=a.map.layers.get('prefecture-line').paint['line-width'];
 assert.equal(width[0],'step');assert.equal(width[3],8);assert.equal(width[4],4);
 assert.ok(a.map.layers.has('municipality-line'));
});
