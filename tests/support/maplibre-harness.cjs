const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const logic = require(path.join(root, 'maplibre-map-logic.js'));
const TOKYO = { code: '131016', prefecture: '東京都', name: '千代田区', type: '特別区' };
const OSAKA = { code: '272117', prefecture: '大阪府', name: '茨木市', type: '市' };
const municipalities = [TOKYO, OSAKA];
const regions = [ { name: '関東', prefectures: ['東京都'] }, { name: '近畿', prefectures: ['大阪府'] } ];
function shape(pref, name, code, lon, lat) {
  return { type: 'Feature', properties: {N03_001:pref, N03_004:name, N03_007:code}, geometry: {
    type:'Polygon', coordinates: [[[lon,lat],[lon+.3,lat],[lon+.3,lat+.3],[lon,lat+.3],[lon,lat]]]
  } };
}
const borders = { type:'FeatureCollection', features: [shape('東京都','千代田区','13101',139.6,35.5),shape('大阪府','茨木市','27211',135.3,34.7)] };
const details = { '13': {type:'FeatureCollection', features:[borders.features[0]]}, '27':{type:'FeatureCollection', features:[borders.features[1]]} };

class FakeElement {
  constructor(tagName='div') {
    this.tagName=tagName.toUpperCase(); this.children=[]; this.listeners={}; this.textContent=''; this.checked=false;
    this.value=''; this.disabled=false; this.hidden=false; this.style={}; this.attributes={};
    const classSet = new Set();
    this.classList={toggle:(name,enable)=>{if(enable)classSet.add(name);else classSet.delete(name);},
      add:(name)=>classSet.add(name),remove:(name)=>classSet.delete(name),contains:(name)=>classSet.has(name)};
  }
  append(...children){this.children.push(...children);}
  appendChild(child){this.append(child);return child;}
  remove(){}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  dispatch(type,evt={}){for(const fn of this.listeners[type]||[]) fn({...evt,target:this});}
  click(){this.dispatch('click');}
}

function createHarness({records:givenRecords}={}) {
  let records=givenRecords || { '131016':{status:'visited',date:'2026-09-01',memo:'visit'}, '272117':{status:'passed',date:'2026-09-02',memo:'pass'} };
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id,new FakeElement()); return elements.get(id); };
  const calls={urls:[], dialogs:[], popups:[], fits:[], maps:[], writes:[]};
  class FakeSource {constructor(data){this.data=data;} setData(data){this.data=data;}}
  class FakeMap {
    constructor(options) {
      this.options=options;this.sources=new Map();this.layers=new Map();this.events=new Map();this.filters=new Map();calls.maps.push(this);
      this.touchZoomRotate={ disableRotation(){} };
    }
    addSource(id,config){this.sources.set(id,new FakeSource(config.data));}
    getSource(id){return this.sources.get(id);}
    addLayer(layer, before){this.layers.set(layer.id,layer);}
    moveLayer(id){}
    getLayer(id){return this.layers.get(id);}
    setLayoutProperty(id,key,value){this.layers.get(id).layout??={};this.layers.get(id).layout[key]=value;}
    setPaintProperty(id,key,value){this.layers.get(id).paint[key]=value;}
    setFilter(id,filter){this.filters.set(id,filter);}
    fitBounds(bounds, opts){calls.fits.push({bounds, opts});}
    resize(){this.resized=(this.resized||0)+1;}
    addControl(){}
    on(event, arg, fn) {
      if (typeof arg === 'function') fn=arg;
      else event = event+':'+arg;
      this.events.set(event,fn);
      if(event==='load') queueMicrotask(fn);
    }
    getCanvas(){return {style:{}};}
    emit(type,layer,payload={}) { const key=layer?`${type}:${layer}`:type; const fn=this.events.get(key); if(fn) return fn(payload); }
  }
  class FakePopup {
    setLngLat(coords){this.coords=coords;return this;}
    setDOMContent(content){this.content=content;return this;}
    addTo(){calls.popups.push(this);return this;}
    remove(){this.removed=true;}
  }
  const maplibregl={Map:FakeMap, Popup:FakePopup, NavigationControl:class{}};
  const document={
    getElementById:el,
    createElement:(tag)=>new FakeElement(tag),
    addEventListener(){},
    querySelector(){return null;},
    body:new FakeElement('body'),head:new FakeElement('head')
  };
  const window={MapTrialLogic:logic,maplibregl,matchMedia:()=>({matches:false}),innerWidth:1100};
  const context=vm.createContext({window,document,maplibregl,console,Option:function Option(text,value){this.textContent=text;this.value=value;},
    setTimeout,clearTimeout,AbortController,requestAnimationFrame:callback=>callback(),
    fetch:async(url)=>{calls.urls.push(url);const key=/GeoJson\/(\d+)\.json/.exec(url)?.[1];const json=key?details[key]:borders;
      return {ok:true,json:async()=>json};}
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'maplibre-main.js'), 'utf8'), context);
  const setup = window.MainMapLibre.initialize({ municipalities,getRecords:()=>records,
    openRecordDialog:(m)=>calls.dialogs.push(m),regions });
  const settle = async()=>{ await setup; for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };
  return {window,document,el,calls,get map(){return calls.maps[0];}, settle,
    setRecords(value){records=value;},getRecords:()=>records,municipalities};
}
module.exports={ createHarness, shape, borders, details, municipalities, TOKYO, OSAKA, logic, root };
