// node --test tests/*.test.cjs
// This suite verifies detail-mode transitions without changing the user's localStorage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function setup({ failDetail = false, holdDetail = false } = {}) {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.disabled = false; this.style = {}; this.events = {}; this.children = []; this.classList = {add(){},remove(){}}; }
    addEventListener(type, cb) { this.events[type] = cb; }
    setAttribute() {}
    append(...items) { this.children.push(...items); }
    add(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    scrollIntoView() {}
  }
  const elements = new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => [match[1], new Element()]));
  elements.get('statusFilter').value = 'all';
  const feature = (pref, name, code, lon, lat) => ({
    type: 'Feature', properties: {N03_001:pref,N03_004:name,N03_007:code},
    geometry: {type:'Polygon',coordinates:[[[lon,lat],[lon+0.1,lat],[lon+0.1,lat+0.1],[lon,lat]]]}
  });
  const tokyo = feature('東京都','千代田区','13101',139.7,35.6);
  const osaka = feature('大阪府','大阪市','27100',135.5,34.7);
  const broad = {type:'FeatureCollection', features:[tokyo, osaka]};
  const detailedTokyo = {type:'FeatureCollection', features:[feature('東京都','千代田区','13101',139.71,35.61)]};
  const detailedOsaka = {type:'FeatureCollection', features:[feature('大阪府','大阪市','27100',135.51,34.71)]};
  const catalog = [
    {lgcode:'131016',pref:'東京都',city:'千代田区'},
    {lgcode:'271004',pref:'大阪府',city:'大阪市'},
    ...Array.from({length:999},(_,i)=>({lgcode:String(800000+i),pref:'北海道',city:`試験${i}市`}))
  ];
  const calls = { fetch:[], layers:[], removed:[], writes:[], callbacks:{}, currentZoom:5, currentCenter:{lat:35.65,lng:139.75} };
  let releaseDetail;
  const map = {
    setView(){return this;}, setMaxBounds(){return this;}, fitBounds(){return this;},
    panBy(){return this;},
    getZoom(){return calls.currentZoom;}, getCenter(){return calls.currentCenter;},
    getBounds(){return {intersects: candidate => candidate.name === '東京都', pad(){return this;}};},
    on(type,cb){calls.callbacks[type]=cb;return this;},
    removeLayer(layer){calls.removed.push(layer);}
  };
  const Leaflet = {
    map(){return map;}, tileLayer(){return {addTo(){}};},
    latLngBounds(a){return {name: a[0][1] > 138 ? '東京都' : '大阪府'};},
    geoJSON(data, opts){
      const layer = {data,opts,setStyle(cb){this.style=cb;},addTo(){calls.layers.push(this);return this;},
        getBounds(){return {isValid(){return true;},pad(){return this;}};},
        getLayers(){return data.features;}};
      return layer;
    }
  };
  const fetch = async url => {
    calls.fetch.push(url);
    if (url.includes('/GeoJson/')) {
      if (holdDetail) return await new Promise(resolve => {releaseDetail = () => resolve({ok:true,json:async()=>url.endsWith('13.json')?detailedTokyo:detailedOsaka});});
      if (failDetail) return {ok:false,status:503};
      return {ok:true,json:async()=>url.endsWith('13.json')?detailedTokyo:detailedOsaka};
    }
    return {ok:true,json:async()=>url.includes('localgovjp')?catalog:broad};
  };
  const ctx = vm.createContext({
    document:{getElementById:id=>elements.get(id),createElement:()=>new Element(),body:new Element()},
    localStorage:{getItem:key=>key==='municipality-conquest-records-v1'?JSON.stringify({'131016':{status:'visited',date:'2026-01-01',memo:'unchanged'}}):null,
      setItem:(key,value)=>calls.writes.push({key,value})},
    fetch,L:Leaflet,window:{L:Leaflet},
    Option:function(text,value){return Object.assign(new Element(),{textContent:text,value});},
    console:{warn(){},error(){}},setTimeout:()=>1,clearTimeout(){},
    alert(){},confirm:()=>true,Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}}
  });
  vm.runInContext(appSource,ctx);
  return {calls,elements,ctx,get releaseDetail(){return releaseDetail;},broad};
}

test('selecting a prefecture loads a distinct 2026 more detailed boundary and keeps records unchanged',async()=>{
  const a=setup(); await settle();
  assert.equal(a.calls.layers.length,1);
  a.elements.get('mapPrefectureFilter').value='東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  assert.ok(a.calls.fetch.some(url=>url.endsWith('/GeoJson/13.json')));
  const detail=a.calls.layers.at(-1);
  assert.equal(detail.data.features[0].geometry.coordinates[0][0][0],139.71);
  assert.equal(detail.opts.smoothFactor,0.15);
  assert.equal(detail.opts.style(detail.data.features[0]).fillColor,'#19865b');
  const base=a.calls.layers[1];
  assert.equal(base.style(a.broad.features[0]).fillOpacity,0,'hide replaced polygon');
  assert.equal(a.calls.writes.length,0,'render must never overwrite records');
  assert.match(a.elements.get('mapDetailStatus').textContent,/詳細境界を表示中/);
});

test('failed detailed fetch preserves original coarse polygons',async()=>{
  const a=setup({failDetail:true}); await settle();
  a.elements.get('mapPrefectureFilter').value='東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const base=a.calls.layers.at(-1);
  assert.equal(base.opts.style(a.broad.features[0]).fillColor,'#19865b');
  assert.match(a.elements.get('mapDetailStatus').textContent,/取得に失敗/);
  assert.equal(a.calls.writes.length,0);
});

test('late detail response is ignored after user changes prefecture',async()=>{
  const a=setup({holdDetail:true}); await settle();
  const field=a.elements.get('mapPrefectureFilter');
  field.value='東京都'; field.events.change();
  await settle();
  assert.equal(typeof a.releaseDetail,'function');
  field.value=''; field.events.change();
  a.releaseDetail(); await settle();
  assert.equal(a.calls.layers.length,3,'only nationwide, selected and nationwide coarse layers are created');
  assert.equal(a.calls.writes.length,0);
});

test('zooming to 8 or beyond triggers detail search for visible prefecture',async()=>{
  const a=setup(); await settle();
  a.calls.currentZoom=8;
  // Directly exercise the zoom target selection, independently of timing.
  const names=vm.runInContext('getDetailedMapTargets()',a.ctx);
  assert.deepEqual(Array.from(names),['東京都']);
  assert.equal(a.calls.writes.length,0);
});
