const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHarness,logic,root,borders}=require('./support/maplibre-harness.cjs');

test('perfect (100%) is gold, 99.9% remains green and OFF restores the old palette', () => {
  assert.equal(logic.progressBand(0),'#eef2ef');
  assert.equal(logic.progressBand(99.9),'#19865b');
  assert.equal(logic.progressBand(100),'#d9a43b');
  assert.equal(logic.progressBand(100,false),'#19865b');
  assert.equal(logic.progressBand(101,false),'#19865b');
  const counts=new Map([['東京都',{percent:100}],['大阪府',{percent:75}]]);
  const on=logic.enrichPrefectureFeatures(borders,counts,true);
  const off=logic.enrichPrefectureFeatures(borders,counts,false);
  assert.equal(on.features[0].properties.fill,'#d9a43b');
  assert.equal(on.features[1].properties.fill,'#19865b');
  assert.equal(off.features[0].properties.fill,'#19865b');
});

test('map refresh toggles special color without reloading boundaries or mutating records', async () => {
  const records={'131016':{status:'visited',date:'2026-07-03',memo:'safe'},'272117':{status:'passed'}};
  const setting={value:true};
  const a=createHarness({records,highlightCompleted:setting}); await a.settle();
  const src=a.map.getSource('prefectures');
  const color=pref=>src.data.features.find(x=>x.properties.pref===pref)?.properties.fill;
  assert.equal(color('東京都'),'#d9a43b');
  assert.equal(color('大阪府'),'#eef2ef');
  const urlCount=a.calls.urls.length;
  setting.value=false; a.window.MainMapLibre.refreshRecords();
  assert.equal(color('東京都'),'#19865b');
  assert.equal(a.calls.urls.length,urlCount);
  setting.value=true; a.window.MainMapLibre.refreshRecords();
  assert.equal(color('東京都'),'#d9a43b');
  assert.deepEqual(a.getRecords(),records);
});

test('mobile map navigation uses a Japan silhouette SVG; map legend has a special color', () => {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
  const svg=fs.readFileSync(path.join(root,'japan-map-nav.svg'),'utf8');
  assert.match(html, /href="#mapPanel"[^>]*><span[^>]*mobile-nav-map[^>]*><img src="japan-map-nav\.svg"/);
  assert.match(svg, /<svg/);
  assert.match(svg, /<path/);
  assert.match(html,/id="highlightCompletedToggle" checked/);
  assert.match(html,/id="mapPerfectLegendItem"/);
  assert.match(css,/\.legend-dot\.progress-perfect/);
  assert.doesNotMatch(html,/aria-hidden="true">▧<\/span>/);
});
