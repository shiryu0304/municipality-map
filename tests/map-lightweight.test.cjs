// node --test tests/*.test.cjs
// 地図の軽量化によって訪問記録や表示機能が変わらないことを、通信しない模擬環境で確認。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

function simulate() {
  class Element {
    constructor() {
      this.value = ''; this.textContent = ''; this.style = {}; this.children = [];
      this.disabled = false; this.events = {}; this.classList = {add() {}, remove() {}};
    }
    append(...elements) { this.children.push(...elements); }
    replaceChildren(...elements) { this.children = elements; }
    add(element) { this.children.push(element); }
    addEventListener(type, cb) { this.events[type] = cb; }
    setAttribute() {}
    scrollIntoView() {}
  }
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const geo = (code='13101') => ({type:'Feature', properties:{N03_001:'東京都',N03_004:'千代田区',N03_007:code},
    geometry:{type:'Polygon',coordinates:[[[139.6,35.6],[139.9,35.6],[139.9,35.9],[139.6,35.9],[139.6,35.6]]]}});
  const collection = {type:'FeatureCollection',features:[geo()]};
  const municipalities = [{lgcode:'131016',pref:'東京都',city:'千代田区'},
    ...Array.from({length:1000},(_,i)=>({lgcode:String(800000+i),pref:'北海道',city:`模擬${i}市`}))];
  const calls = {zoom:5, clearLabels:0, addLabels:0, redraws:0, writes:[], downloads:[], detail:0};
  const labels = {
    markers: [], addTo(){return this;},
    clearLayers(){calls.clearLabels++;this.markers=[];},
    addLayer(marker){calls.addLabels++;this.markers.push(marker);}
  };
  const map = {
    setView(){return this;}, fitBounds(){return this;}, setMaxBounds(){return this;}, on(){return this;},
    getZoom(){return calls.zoom;},getCenter(){return {lat:35.75,lng:139.75};},
    getBounds(){return {pad(){return this;}, contains(){return true;},intersects(){return true;}};},
    removeLayer(){},latLngToContainerPoint(){return {x:75,y:75};}
  };
  const leaflet = {
    map(){return map;}, tileLayer(){return {addTo(){}};},
    latLngBounds(){return {name:'東京都'};},
    layerGroup(){return labels;},
    marker(coords,opts){return {coords,opts};},divIcon(options){return options;},
    geoJSON(data,opts){
      const layer={data,opts,addTo(){return this;}, getLayers(){return data.features;},
        setStyle(style){calls.redraws++;this.lastStyle=style;},
        getBounds(){return {isValid(){return true;}};},bringToFront(){}};
      for (const feature of data.features) opts.onEachFeature?.(feature,{
        bindPopup(){},bindTooltip(){},on(){}});
      return layer;
    }
  };
  const ctx = vm.createContext({
    document:{getElementById:id=>elements.get(id),createElement:()=>new Element(),body:new Element()},
    window:{L:leaflet}, L:leaflet, Option:function(text,value){return Object.assign(new Element(),{textContent:text,value});},
    localStorage:{getItem:key=>key==='municipality-conquest-records-v1' ? JSON.stringify({
      '131016':{status:'passed', date:'2026-10-15', memo:'通過記録を維持'}}):null,
      setItem:(key,value)=>calls.writes.push([key,value])},
    fetch:async url=>{
      if (url.includes('localgovjp')) return {ok:true,json:async()=>municipalities};
      if (url.includes('/GeoJson/')) {calls.detail++;return {ok:true,json:async()=>collection};}
      return {ok:true,json:async()=>collection};
    },
    console:{warn(){},error(){}},setTimeout:()=>1,clearTimeout(){},
    alert(){},confirm:()=>true,Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}}
  });
  vm.runInContext(js,ctx,{filename:'app.js'});
  return {ctx,elements,calls,labels,map,geo};
}

test('moving without changing labels avoids recreating label DOM elements',async()=>{
  const a=simulate();await settle();
  a.calls.zoom=8;
  vm.runInContext('updateMapLabels()',a.ctx);
  assert.equal(a.labels.markers.length,1);
  const previous={clears:a.calls.clearLabels, adds:a.calls.addLabels};
  vm.runInContext('updateMapLabels()',a.ctx);
  assert.equal(a.calls.clearLabels,previous.clears,'same labels should not be erased');
  assert.equal(a.calls.addLabels,previous.adds,'same labels should not be recreated');
  a.calls.zoom=5;
  vm.runInContext('updateMapLabels()',a.ctx);
  assert.equal(a.labels.markers.length,0);
  const hiddenClears=a.calls.clearLabels;
  vm.runInContext('updateMapLabels()',a.ctx);
  assert.equal(a.calls.clearLabels,hiddenClears,'hidden labels should not be cleared repeatedly');
  assert.equal(a.calls.writes.length,0);
});

test('stable detailed boundaries do not trigger nationwide style redraws repeatedly',async()=>{
  const a=simulate();await settle();
  const picker=a.elements.get('mapPrefectureFilter');
  picker.value='東京都';picker.events.change();await settle();
  assert.equal(a.calls.detail,1,'prefecture detail is loaded once');
  assert.equal(vm.runInContext('detailedMapLayers.size',a.ctx),1);
  const before=a.calls.redraws;
  await vm.runInContext('refreshDetailedBoundaries()',a.ctx);
  await vm.runInContext('refreshDetailedBoundaries()',a.ctx);
  assert.equal(a.calls.detail,1,'no repeated network download');
  assert.equal(a.calls.redraws,before,'do not redraw unchanged boundaries');
  assert.equal(a.calls.writes.length,0);
});

test('name-based municipality matching remains available when map code differs',async()=>{
  const a=simulate();await settle();
  const code=vm.runInContext(`findMunicipalityForFeature({properties:{
    N03_001:'東京都',N03_004:'千代田区',N03_007:'99999'
  }})?.code`,a.ctx);
  assert.equal(code,'131016');
  const status=vm.runInContext('getRecord("131016").status',a.ctx);
  assert.equal(status,'passed');
  assert.equal(a.calls.writes.length,0,'initialization and map rendering never overwrite visit records');
});
