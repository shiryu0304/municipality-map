// node --test tests/*.test.cjs
// 県境の強調と地名ラベルの表示設定。外部ネットワークへの接続は行わない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const settle = async () => { for (let i = 0; i < 9; i++) await new Promise(resolve => setImmediate(resolve)); };

function buildApp(borderFails = false) {
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.style = {}; this.children = []; this.disabled = false;
      this.events = {}; this.attributes = {}; this.classList = { add() {}, remove() {} }; }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    add(item) { this.children.push(item); }
    addEventListener(key, cb) { this.events[key] = cb; }
    scrollIntoView() {}
  }
  const elements = new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g), m => [m[1], new Element()]));
  const calls = { fetch: [], layers: [], writes: [], zoom: 5, panes: new Map() };
  const polygon = (name, code) => ({type:'Feature', properties:{N03_001:'東京都',N03_004:name,N03_007:code},
    geometry:{type:'Polygon',coordinates:[[[139.6,35.6],[139.7,35.6],[139.7,35.7],[139.6,35.6]]]}});
  const municipalityData = {type:'FeatureCollection',features:[polygon('千代田区','13101')]};
  const prefectureData = {type:'FeatureCollection', features:Array.from({length:47},(_,i)=>({type:'Feature',properties:{id:i,N03_001:'東京都'},geometry:municipalityData.features[0].geometry}))};
  const catalog = [{pref:'東京都',city:'千代田区',lgcode:'131016'}, ...Array.from({length:1000},(_,i)=>({pref:'北海道',city:`試験${i}市`,lgcode:String(800000+i)}))];
  const map = {
    setView(){return this;}, fitBounds(){return this;}, setMaxBounds(){return this;},
    getZoom(){return calls.zoom;},
    getBounds(){return {pad(){return this;}};},
    createPane(name){const pane={style:{}}; calls.panes.set(name,pane);return pane;},
    getPane(name){return calls.panes.get(name);}, on(){return this;}, removeLayer(){}
  };
  const L = {
    map(){return map;}, tileLayer(){return {addTo(){}};},
    geoJSON(data,opts){
      const layer={data,opts,addTo(){calls.layers.push(this);return this;},setStyle(){},
        getBounds(){return {isValid(){return true;}};},getLayers(){return data.features;}};
      return layer;
    }
  };
  const ctx=vm.createContext({
    document:{getElementById:id=>elements.get(id),createElement:()=>new Element(),body:new Element()},
    window:{L},L,Option:function(text,value){return Object.assign(new Element(),{textContent:text,value});},
    localStorage:{getItem:key=>key==='municipality-conquest-records-v1'?JSON.stringify({'131016':{status:'passed',memo:'車'}}):null,
      setItem:(key,value)=>calls.writes.push({key,value})},
    fetch:async url=>{
      calls.fetch.push(url);
      if(url.includes('prefectures.json')) return borderFails ? {ok:false,status:503} : {ok:true,json:async()=>prefectureData};
      return {ok:true,json:async()=>url.includes('localgovjp')?catalog:municipalityData};
    },
    console:{warn(){},error(){}},setTimeout:()=>1,clearTimeout(){},alert(){},confirm:()=>true,
    Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}}
  });
  vm.runInContext(script,ctx,{filename:'app.js'});
  return {ctx,calls,elements};
}

test('prefecture border is separately fetched and layered above fine municipality lines',async()=>{
  const a=buildApp(); await settle();
  assert.ok(a.calls.fetch.some(url=>url.endsWith('/prefectures.json')));
  // 全国画面は都道府県の図形だけを描く。
  assert.equal(a.calls.layers.length,1);
  const overview=a.calls.layers[0];
  assert.equal(overview.data.features.length,47);
  assert.equal(overview.opts.smoothFactor,0.45);
  a.elements.get('mapPrefectureFilter').value='東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const border=a.calls.layers.find(layer=>layer.opts.style === vm.runInContext('getPrefectureBorderStyle',a.ctx));
  // 県選択時には県境を独立した線として追加する。
  assert.ok(a.calls.layers.some(layer=>layer.opts.interactive===false&&layer.opts.smoothFactor===0.2));
  a.calls.zoom=8;
  assert.equal(vm.runInContext('getPrefectureBorderStyle().weight',a.ctx),4);
  assert.equal(a.calls.writes.length,0);
});

test('failed prefecture border request leaves working municipality map and visit data unchanged', async()=>{
  const a=buildApp(true); await settle();
  assert.equal(a.calls.layers.length,0);
  assert.equal(a.elements.get('mapBadge').textContent,'地図の読み込み失敗');
  assert.equal(a.calls.writes.length,0);
});

test('place names use outlined transparent letters, with changed CSS/JS cache identifiers',()=>{
  assert.match(css,/\.municipality-name-label \{/);
  assert.match(css,/white-space: nowrap; padding: 0; background: transparent/);
  assert.match(css,/text-shadow: -1px -1px 0 #172019/);
  assert.match(css,/\.municipality-name-label--city/);
  assert.doesNotMatch(css,/background: rgba\(255,255,255,\.94\)/);
  assert.match(html,/県境データ：スマートニュース/);
  assert.match(html,/style\.css\?v=map-viewport-performance-20261017/);
  assert.match(html,/app\.js\?v=map-viewport-performance-20261017/);
});
