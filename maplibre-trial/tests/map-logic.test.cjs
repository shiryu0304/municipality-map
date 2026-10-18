const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../map-logic.js');
const source = [
  {city:'千代田区', pref:'東京都', lgcode:'131016'},
  {city:'新宿区', pref:'東京都', lgcode:'131041'},
  {city:'大阪市', pref:'大阪府', lgcode:'271004'},
  {city:'北区', pref:'大阪府', lgcode:'271276'}, // 政令指定都市の行政区は含めない
  {city:'下北山村', pref:'奈良県', lgcode:'294501'},
  {city:'大阪市', pref:'大阪府', lgcode:'271004'}
];
const municipalities = L.normalizeMunicipalityData(source);
const index = L.createMunicipalityIndex(municipalities);
const geometry = {type:'Polygon', coordinates:[[[135,34],[135.1,34],[135.1,34.1],[135,34.1],[135,34]]]};
function feature(code, pref, name, geog = geometry) { return {type:'Feature', properties:{N03_007:code, N03_001:pref, N03_004:name}, geometry:geog}; }

test('自治体一覧: 東京23区は含め、政令指定都市の行政区・重複は除外', () => {
  assert.equal(municipalities.length, 4);
  assert.equal(municipalities.find(m => m.name==='千代田区').type,'特別区');
  assert.ok(!municipalities.some(m => m.name==='北区'));
});
test('自治体コード: 6桁の自治体コードと地図の5桁コードを照合', () => {
  assert.equal(L.normalizeMapCode('131016'),'13101');
  assert.equal(L.normalizeMapCode('013016'),'01301');
  assert.equal(L.findMunicipality(feature('13101','東京都','千代田区'),index).name,'千代田区');
});
test('自治体コード不一致でも都道府県＋名前で照合', () => {
  assert.equal(L.findMunicipality(feature('99999','大阪府','大阪市'),index).code,'271004');
  assert.equal(L.findMunicipality(feature('99999','大阪府','存在しない市'),index),null);
});
test('訪問記録の読み取り: 元アプリのバックアップ形式と旧wantをサポート', () => {
  const allowed = new Set(municipalities.map(m => m.code));
  const parsed = L.parseRecordBackup({app:'municipality-conquest',version:1,records:{
    131016:{status:'visited', memo:'秘密のメモ'},
    131041:{status:'want'},
    999999:{status:'visited'}
  }}, allowed);
  assert.equal(parsed.count,2);
  assert.equal(parsed.ignored,1);
  assert.equal(parsed.records['131016'].status,'visited');
  assert.equal(parsed.records['131041'].status,'unvisited');
  assert.equal(parsed.records['131016'].memo,undefined);
});
test('訪問記録の異常形式は拒否', () => {
  assert.throws(() => L.parseRecordBackup([],new Set()));
  assert.throws(() => L.parseRecordBackup({records:[]},new Set()));
});
test('都道府県制覇率: 訪問だけを分子にする', () => {
  const progress = L.prefectureProgress(municipalities,{
    131016:{status:'visited'},131041:{status:'passed'}
  });
  assert.equal(progress.get('東京都').total,2);
  assert.equal(progress.get('東京都').visited,1);
  assert.equal(progress.get('東京都').percent,50);
  assert.equal(progress.get('大阪府').percent,0);
});
test('制覇率の色の境界は元アプリと同じ', () => {
  assert.equal(L.progressBand(0),'#eef2ef');
  assert.equal(L.progressBand(24.99),'#c4e7d2');
  assert.equal(L.progressBand(25),'#87cfa8');
  assert.equal(L.progressBand(50),'#45ad7d');
  assert.equal(L.progressBand(75),'#19865b');
});
test('地域グループ: 都道府県の並びが日本地理の順序', () => {
  const regions = L.collectRegions(municipalities);
  assert.deepEqual(regions.map(r=>r.name),['関東','近畿']);
  assert.deepEqual(regions[0].prefectures,['東京都']);
  assert.deepEqual(regions[1].prefectures,['大阪府','奈良県']);
});
test('都道府県の境界GeoJSONを制覇率の色で変換', () => {
  const geo = {type:'FeatureCollection',features:[feature('13101','東京都','千代田区'),feature('11111','無関係県','その他')]};
  const enriched = L.enrichPrefectureFeatures(geo, L.prefectureProgress(municipalities,{'131016':{status:'visited'}}));
  assert.equal(enriched.features.length,1);
  assert.equal(enriched.features[0].properties.pref,'東京都');
  assert.equal(enriched.features[0].properties.fill,'#45ad7d');
});
test('都道府県GeoJSONが異常・一致なしの場合はエラー', () => {
  assert.throws(() => L.enrichPrefectureFeatures({},new Map()));
  assert.throws(() => L.enrichPrefectureFeatures({type:'FeatureCollection',features:[]},new Map()));
});
test('詳細地図: 当該都道府県に属する自治体のみ色分けする', () => {
  const geo = {type:'FeatureCollection',features:[feature('13101','東京都','千代田区'),feature('27100','大阪府','大阪市')]};
  const result = L.enrichMunicipalityFeatures(geo,'東京都',index,{'131016':{status:'visited'}});
  assert.equal(result.features.length,1);
  assert.equal(result.features[0].properties.code,'131016');
  assert.equal(result.features[0].properties.status,'visited');
});
test('地図の境界位置と地名の代表点を算出できる', () => {
  const list = [feature('13101','東京都','千代田区')];
  assert.deepEqual(L.getGeoJSONBounds(list),[135,34,135.1,34.1]);
  const center = L.findLabelCenter(geometry);
  assert.ok(center.lat>34 && center.lat<34.1);
  assert.ok(center.lon>135 && center.lon<135.1);
  const detailed = L.enrichMunicipalityFeatures({type:'FeatureCollection',features:list},'東京都',index,{});
  const labels = L.makeLabels(detailed.features);
  assert.equal(labels.features.length,1);
  assert.equal(labels.features[0].properties.name,'千代田区');
});
