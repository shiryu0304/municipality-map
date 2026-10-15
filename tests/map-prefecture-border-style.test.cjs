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
  const prefectureData = {type:'FeatureCollection', features:Array.from({length:47},(_,i)=>({type:'Feature',properties:{id:i},geometry:municipalityData.features[0].geometry}))};
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
  assert.equal(a.calls.layers.length,2);
  const border=a.calls.layers[1];
  assert.equal(border.data.features.length,47);
  assert.equal(border.opts.pane,'prefectureBorderPane');
  assert.equal(border.opts.interactive,false);
  assert.equal(border.opts.style().fill,false);
  assert.equal(border.opts.style().weight,2.4);
  assert.equal(a.calls.panes.get('prefectureBorderPane').style.zIndex,'450');
  a.calls.zoom=8;
  assert.equal(vm.runInContext('getPrefectureBorderStyle().weight',a.ctx),3.4);
  assert.equal(a.calls.writes.length,0);
});

test('failed prefecture border request leaves working municipality map and visit data unchanged', async()=>{
  const a=buildApp(true); await settle();
  assert.equal(a.calls.layers.length,1);
  assert.equal(a.elements.get('mapBadge').textContent,'全国 · 1 区域');
  assert.equal(a.calls.writes.length,0);
});

test('place names use outlined transparent letters, with changed CSS/JS cache identifiers',()=>{
  assert.match(css,/\.municipality-name-label \{/);
  assert.match(css,/white-space: nowrap; background: transparent; border: 0/);
  assert.match(css,/-webkit-text-stroke: 2\.5px #1b231e/);
  assert.match(css,/\.municipality-label-size-18/);
  assert.doesNotMatch(css,/background: rgba\(255,255,255,\.94\)/);
  assert.match(html,/県境データ：国土交通省/);
  assert.match(html,/style\.css\?v=readable-place-names-pref-border-20261014/);
  assert.match(html,/app\.js\?v=readable-place-names-pref-border-20261014/);
});
