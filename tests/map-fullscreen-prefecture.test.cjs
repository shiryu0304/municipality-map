// node --test tests/*.test.cjs
// 新しい県別表示とページ内全画面表示を、通信せずに検証する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const settle = async () => {for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));};

function create() {
  function classList() {const names = new Set();return {names,add(n){names.add(n);},remove(n){names.delete(n);},contains(n){return names.has(n);}};}
  class Element {
    constructor() {this.value='';this.textContent='';this.style={};this.events={};this.attributes={};this.children=[];this.disabled=false;this.classList=classList();}
    setAttribute(key,v){this.attributes[key]=v;}
    addEventListener(name,fn){this.events[name]=fn;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    add(item){this.children.push(item);}
    scrollIntoView(){}
    click(){this.events.click?.();}
  }
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const body=new Element();
  const documentEvents={};
  const polygon=(pref,name,code,lon,lat)=>({type:'Feature',properties:{N03_001:pref,N03_004:name,N03_007:code},
    geometry:{type:'Polygon',coordinates:[[[lon,lat],[lon+.4,lat],[lon+.4,lat+.4],[lon,lat]]]}});
  const tokyo=polygon('東京都','千代田区','13101',139.6,35.7);
  const kyoto=polygon('京都府','京都市','26100',135.6,35.0);
  const coast={type:'FeatureCollection',features:[tokyo,kyoto]};
  const boundaries={type:'FeatureCollection',features:[tokyo,kyoto]};
  const catalog=[{lgcode:'131016',pref:'東京都',city:'千代田区'},{lgcode:'261009',pref:'京都府',city:'京都市'},
    ...Array.from({length:1000},(_,i)=>({lgcode:String(700000+i),pref:'北海道',city:`テスト${i}市`}))];
  const calls={layers:[],removed:[],writes:[],detailUrls:[],invalidation:0,zoom:5,keydown:documentEvents};
  const map={setView(){return this;},setMaxBounds(){return this;},fitBounds(){return this;},
    getBounds(){return {pad(){return this;},contains(){return true;}};},
    getZoom(){return calls.zoom;}, getCenter(){return {lat:35.5,lng:138.2};},
    latLngToContainerPoint(){return {x:120,y:120};},
    invalidateSize(){calls.invalidation++;return this;},on(){return this;},
    removeLayer(layer){calls.removed.push(layer);}};
  const leaflet={
    map(){return map;},tileLayer(){return {addTo(){}};},
    geoJSON(data,options){
      const shapes=data.features.map(feature=>{
        const layer={events:{},bindPopup(fn){this.popup=fn;},bindTooltip(){},on(type,fn){this.events[type]=fn;}};
        options.onEachFeature?.(feature,layer);return layer;
      });
      const layer={data,options,shapes,addTo(){calls.layers.push(this);return this;},
        getLayers(){return shapes;},getBounds(){return {isValid(){return true;}};},setStyle(){},bringToFront(){}};
      return layer;
    },
    layerGroup(){return {addTo(){return this;},clearLayers(){},addLayer(){}};},
    marker(latlon,options){return {latlon,options};},divIcon(options){return options;}
  };
  const context=vm.createContext({
    document:{getElementById:id=>elements.get(id),createElement:()=>new Element(),body,
      addEventListener(type,fn){documentEvents[type]=fn;}},
    window:{L:leaflet,requestAnimationFrame:callback=>callback()},L:leaflet,
    Option:function(text,value){return Object.assign(new Element(),{textContent:text,value});},
    localStorage:{getItem:key=>key==='municipality-conquest-records-v1' ?
      JSON.stringify({'131016':{status:'passed',date:'2026-10-16',memo:'kept'}}):null,
      setItem:(key,value)=>calls.writes.push({key,value})},
    fetch:async url=>{
      if(url.includes('localgovjp'))return {ok:true,json:async()=>catalog};
      if(url.includes('/GeoJson/')) {calls.detailUrls.push(url);return {ok:true,json:async()=>
        url.endsWith('/13.json')?{type:'FeatureCollection',features:[tokyo]}:{type:'FeatureCollection',features:[kyoto]}};}
      if(url.includes('prefectures.json'))return {ok:true,json:async()=>boundaries};
      return {ok:true,json:async()=>coast};
    },
    console:{warn(){},error(){}},setTimeout:()=>1,clearTimeout(){},
    Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},confirm(){return true;},alert(){}
  });
  vm.runInContext(code,context,{filename:'app.js'});
  return {elements,body,context,calls,map,documentEvents,tokyo,kyoto};
}

test('prefecture selection renders only selected municipality and removes other detailed layers',async()=>{
  const a=create();await settle();
  assert.equal(a.calls.layers.find(layer=>layer.options.onEachFeature).data.features.length,2);
  assert.equal(a.calls.detailUrls.length,0,'全国表示では詳細境界を読み込まない');
  const select=a.elements.get('mapPrefectureFilter');
  select.value='東京都';select.events.change();await settle();
  let shape=a.calls.layers.filter(layer=>layer.options.onEachFeature).at(-2);
  assert.equal(shape.data.features.length,1);
  assert.equal(shape.data.features[0].properties.N03_001,'東京都');
  assert.equal(a.calls.detailUrls.length,1);
  select.value='京都府';select.events.change();await settle();
  shape=a.calls.layers.filter(layer=>layer.options.onEachFeature).at(-2);
  assert.equal(shape.data.features.length,1);
  assert.equal(shape.data.features[0].properties.N03_001,'京都府');
  assert.equal(a.calls.detailUrls.length,2);
  assert.ok(a.calls.removed.length>=2);
  assert.equal(a.calls.writes.length,0);
});

test('tapping an administrative area shows its prefecture-only action without losing record edit',async()=>{
  const a=create();await settle();
  const base=a.calls.layers.find(layer=>layer.options.onEachFeature);
  const popup=base.shapes[0];
  assert.match(popup.popup(),/記録を編集/);
  assert.match(popup.popup(),/この都道府県を表示/);
  const edit=new ElementStub();const focus=new ElementStub();
  popup.events.popupopen({popup:{getElement(){return {querySelector(selector){return selector==='[data-map-code]'?edit:focus;}};}}});
  focus.events.click();await settle();
  assert.equal(a.elements.get('mapPrefectureFilter').value,'東京都');
  assert.equal(a.calls.writes.length,0);
});
function ElementStub(){this.events={};this.addEventListener=(type,fn)=>{this.events[type]=fn;};}

test('viewport fullscreen toggles and refreshes Leaflet size without saving records',async()=>{
  const a=create();await settle();
  const toggle=a.elements.get('toggleMapFullscreen');
  const panel=a.elements.get('mapPanel');
  toggle.click();
  assert.equal(panel.classList.contains('is-map-fullscreen'),true);
  assert.equal(a.body.classList.contains('map-fullscreen-active'),true);
  assert.equal(toggle.attributes['aria-pressed'],'true');
  assert.equal(a.calls.invalidation,1);
  a.documentEvents.keydown({key:'Escape'});
  assert.equal(panel.classList.contains('is-map-fullscreen'),false);
  assert.equal(toggle.textContent,'全画面表示');
  assert.equal(a.calls.invalidation,2);
  assert.equal(a.calls.writes.length,0);
});

test('fullscreen has phone-safe viewport sizing, and the original map styling remains',()=>{
  assert.match(html,/id="toggleMapFullscreen"/);
  assert.match(html,/id="mapPanel"/);
  assert.match(css,/\.map-panel\.is-map-fullscreen \{/);
  assert.match(css,/height: 100dvh/);
  assert.match(css,/\.map-panel\.is-map-fullscreen #japanMap/);
  assert.match(css,/\.municipality-name-label--city/);
  assert.match(css,/\.legend-dot\.passed \{ background: #f09740/);
});
