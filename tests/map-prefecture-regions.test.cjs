const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('地図の都道府県選択は地域ごとに整理される',async()=>{
 const a=createHarness();await a.settle();
 const children=a.el('mapPrefectureFilter').children;
 assert.equal(children[0].value,'');
 assert.deepEqual(children.slice(1).map(group=>group.label),['関東','近畿']);
 assert.deepEqual(children.slice(1).flatMap(group=>group.children.map(item=>item.value)),['東京都','大阪府']);
});
