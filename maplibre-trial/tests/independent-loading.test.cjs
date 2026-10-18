'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const logic = require('../map-logic.js');

function waitTick() { return new Promise(resolve => setImmediate(resolve)); }

function makeEnv() {
  const items = new Map();
  const elem = id => {
    if (!items.has(id)) items.set(id, {
      checked: false, hidden: true, disabled: false, value:'',
      textContent:'', classList:{ toggle() {}, add() {}, remove() {} },
      addEventListener() {}, setAttribute() {},
      replaceChildren() {}, append() {},
    });
    return items.get(id);
  };
  const added = [], geoSources = new Map();
  class FakeMap {
    constructor(opts) { this.opts = opts; this.events = new Map(); FakeMap.instance = this; }
    on(type, handler) { this.events.set(type, handler); }
    touchZoomRotate = {disableRotation() {}};
    addControl() {}
    addSource(id, src) {
      added.push(['source',id]);
      geoSources.set(id, {data:src.data, setData(data) {this.data=data;}});
    }
    addLayer(layer) {added.push(['layer',layer.id]);}
    moveLayer(id) {added.push(['move-layer',id]);}
    getSource(id) {return geoSources.get(id);}
    getLayer(id) { return added.some(([type,name])=>type==='layer'&&name===id) ? {} : undefined; }
    setLayoutProperty() {}
    fitBounds() {}
  }
  const waits={};
  const fetch = url => new Promise(resolve=>{ waits[url]=resolve; });
  const window = {
    MapTrialLogic:logic, maplibregl:null, innerWidth:1000,
    matchMedia:()=>({matches:false}), localStorage:{getItem:()=>null},
  };
  const sandbox={window, document:{getElementById:elem,addEventListener(){},querySelector(){return null;}},
    maplibregl:{Map:FakeMap,NavigationControl:class{}},
    Option:class{constructor(text,value){this.text=text;this.value=value;}},
    fetch, setTimeout:()=>1, clearTimeout() {}, AbortController,
    console,};
  window.maplibregl = sandbox.maplibregl;
  vm.runInNewContext(code,sandbox,{filename:'app.js'});
  return {FakeMap,elem,added,geoSources,waits,window};
}

test('初期地図は外部タイルを待たず読み込みイベントに進む', async () => {
  const {FakeMap,elem,added,window} = makeEnv();
  assert.equal(window.maplibregl.supported, undefined, 'MapLibre v5ではsupported()は存在しない');
  assert.deepEqual(Object.keys(FakeMap.instance.opts.style.sources), []);
  FakeMap.instance.events.get('load')();
  assert.ok(added.some(([kind,name])=>kind==='layer' && name==='prefecture-fill'));
  assert.ok(!added.some(([kind,name])=>name==='ocean-raster'));
  assert.match(elem('statusText').textContent,/都道府県の境界データを取得中/);
});

test('自治体一覧が通信待ちでも、取得できた境界は地図に描画する', async () => {
  const {FakeMap,elem,geoSources,waits} = makeEnv();
  FakeMap.instance.events.get('load')();
  const borderUrl = Object.keys(waits).find(url=>url.includes('prefectures.json'));
  assert.ok(borderUrl);
  waits[borderUrl]({ok:true,json:async()=>({type:'FeatureCollection',features:[{
    type:'Feature', properties:{N03_001:'東京都'},
    geometry:{type:'Polygon',coordinates:[[[139,35],[140,35],[140,36],[139,35]]]}
  }]})});
  await waitTick(); await waitTick();
  const geo = geoSources.get('prefectures').data;
  assert.equal(geo.features.length,1);
  assert.equal(geo.features[0].properties.pref,'東京都');
  assert.match(elem('statusText').textContent,/自治体一覧を取得中/);
});
