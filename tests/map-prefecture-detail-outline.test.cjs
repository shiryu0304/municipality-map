const {test} = require('node:test');
const assert = require('node:assert/strict');
const {logic, createHarness} = require('./support/maplibre-harness.cjs');

function polygon(pref, rings, name = '検証市') {
  return {type:'Feature',properties:{N03_001:pref,N03_004:name},
    geometry:{type:'Polygon',coordinates:rings}};
}
function rect(x1,y1,x2,y2) {
  return [[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]];
}
function edgesOf(outline) {
  const result=[];
  for(const f of outline.features){
    const line=f.geometry.coordinates;
    for(let i=1;i<line.length;i++) {
      const a=line[i-1], b=line[i];
      result.push([`${a[0]},${a[1]}`,`${b[0]},${b[1]}`].sort().join('|'));
    }
  }
  return result;
}

test('県内で共有する辺は除去し、外周線だけを市区町村の頂点から作る',()=>{
  const data={type:'FeatureCollection',features:[
    polygon('検証県',[rect(0,0,1,1)]),
    polygon('検証県',[rect(1,0,2,1)]),
    polygon('隣県',[rect(2,0,3,1)])
  ]};
  const outline=logic.createDetailedPrefectureOutline(data,'検証県');
  const result=edgesOf(outline);
  assert.equal(result.length,6); // 4+4-2（共有辺）
  assert.ok(!result.includes('1,0|1,1'), '県内の共有辺を県境と誤認しない');
  assert.ok(result.includes('2,0|2,1'), '隣県との境界は残す');
  assert.ok(outline.features.every(f=>f.properties.pref==='検証県'));
  assert.deepEqual(outline.features[0].geometry.coordinates[0],
    outline.features[0].geometry.coordinates.at(-1), '県境が閉じた線になる');
});

test('飛び地と穴のある多角形でも、元の座標を変えずに境界を残す',()=>{
  const outer=rect(0,0,4,4), hole=rect(1,1,2,2), island=rect(6,6,7,7);
  const input={type:'FeatureCollection',features:[{type:'Feature',
    properties:{N03_001:'島県'},geometry:{type:'MultiPolygon',coordinates:[[outer,hole], [island]]}}]};
  const outline=logic.createDetailedPrefectureOutline(input,'島県');
  assert.equal(outline.features.length,3);
  assert.equal(edgesOf(outline).length,12);
  const rawPoints=new Set([outer,hole,island].flatMap(r=>r.map(p=>p.join(','))));
  for(const feature of outline.features) for(const p of feature.geometry.coordinates) {
    assert.ok(rawPoints.has(p.join(',')), '元の市区町村境界以外の座標を作らない');
  }
});

test('県を選択したら粗い県境を隠し、詳細な県境を表示。全国に戻したら逆にする',async()=>{
  const a=createHarness();await a.settle();
  assert.notEqual(a.map.getLayer('prefecture-line').layout?.visibility,'none');
  assert.equal(a.map.getLayer('prefecture-detail-line').layout.visibility,'none');
  a.el('mapPrefectureFilter').value='東京都';a.el('mapPrefectureFilter').dispatch('change');await a.settle();
  assert.equal(a.map.getLayer('prefecture-line').layout.visibility,'none');
  assert.equal(a.map.getLayer('prefecture-detail-line').layout.visibility,'visible');
  const detailed=a.map.getSource('prefecture-detail-outline').data;
  assert.ok(detailed.features.length>0);
  assert.equal(detailed.features[0].properties.pref,'東京都');
  assert.equal(a.map.getSource('municipalities').data.features[0].properties.status,'visited');
  a.el('resetMapView').click();await a.settle();
  assert.notEqual(a.map.getLayer('prefecture-line').layout?.visibility,'none');
  assert.equal(a.map.getLayer('prefecture-detail-line').layout.visibility,'none');
  assert.equal(a.map.getSource('prefecture-detail-outline').data.features.length,0);
});

test('県を再選択しても詳細境界の追加通信はなく、県同士の境界データは混ざらない',async()=>{
  const a=createHarness();await a.settle();
  function pick(pref){a.el('mapPrefectureFilter').value=pref;a.el('mapPrefectureFilter').dispatch('change');}
  pick('東京都');await a.settle();
  const tokyo=a.map.getSource('prefecture-detail-outline').data;
  pick('大阪府');await a.settle();
  const osaka=a.map.getSource('prefecture-detail-outline').data;
  assert.ok(osaka.features.every(f=>f.properties.pref==='大阪府'));
  assert.notDeepEqual(osaka,tokyo);
  const count=a.calls.urls.length;
  pick('東京都');await a.settle();
  assert.equal(a.calls.urls.length,count);
  assert.deepEqual(a.map.getSource('prefecture-detail-outline').data,tokyo);
});
