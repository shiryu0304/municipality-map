const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('v5の地名の重なり許容と配色を維持する',async()=>{
 const a=createHarness();await a.settle();const layers=a.map.layers;
 assert.equal(layers.get('municipality-labels').layout['text-allow-overlap'],true);
 assert.equal(layers.get('municipality-labels').layout['text-ignore-placement'],true);
 assert.ok(JSON.stringify(layers.get('municipality-fill').paint).includes('#f09740'));
});
test('県を表示したら地名データを生成して表示',async()=>{
 const a=createHarness();await a.settle();
 a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
 const labels=a.map.getSource('municipality-labels').data.features;
 assert.equal(labels.length,1);assert.equal(labels[0].properties.name,'千代田区');
});
