// node --test tests/*.test.cjs
// 境界と自治体名の表示・色変更を模擬したLeafletで確認する。実際の地図配信には接続しない。
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

function createApp() {
  class Element {
    constructor() {
      this.value = ''; this.textContent = ''; this.style = {};
      this.events = {}; this.children = []; this.disabled = false;
      this.classList = { add() {}, remove() {} };
    }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    add(child) { this.children.push(child); }
    addEventListener(event, cb) { this.events[event] = cb; }
    scrollIntoView() {}
  }
  const elements = new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g), m => [m[1], new Element()]));
  const feature = (name, code, lon, lat, span = .2) => ({
    type: 'Feature',
    properties: { N03_001: '東京都', N03_004: name, N03_007: code },
    geometry: { type: 'Polygon', coordinates: [[
      [lon, lat], [lon + span, lat], [lon + span, lat + span], [lon, lat + span], [lon, lat]
    ]] }
  });
  const sourceFeatures = [
    feature('千代田区', '13101', 139.55, 35.55),
    feature('千代田区', '13101', 139.6, 35.6, .025), // 同じ自治体の分割領域
    feature('新宿区', '13104', 139.9, 35.9)
  ];
  const catalog = [
    { lgcode: '131016', pref: '東京都', city: '千代田区' },
    { lgcode: '131041', pref: '東京都', city: '新宿区' },
    ...Array.from({length: 1000}, (_, i) => ({ lgcode: String(800000 + i), pref: '北海道', city: `模擬${i}市` }))
  ];
  const layerGroup = {
    markers: [],
    addTo() { return this; },
    clearLayers() { this.markers = []; },
    addLayer(marker) { this.markers.push(marker); }
  };
  const calls = { zoom: 5, writes: [], layers: [], fetch: [] };
  const mapBounds = { contains([lat, lon]) { return lat > 35 && lat < 37 && lon > 139 && lon < 141; }, pad() { return this; } };
  const map = {
    setView() { return this; }, fitBounds() { return this; }, setMaxBounds() { return this; },
    getZoom() { return calls.zoom; }, getBounds() { return mapBounds; },
    getCenter() { return {lat: 35.7, lng:139.7}; }, on() { return this; },
    removeLayer() {},
    latLngToContainerPoint([lat, lon]) { return { x: (lon - 139) * 900, y: (lat - 35) * 900 }; }
  };
  const L = {
    map: () => map,
    tileLayer: () => ({ addTo() {} }),
    layerGroup: () => layerGroup,
    marker: (coordinate, options) => ({ coordinate, options }),
    divIcon: options => options,
    geoJSON(data, options) {
      for (const ft of data.features) options.onEachFeature?.(ft, {
        bindPopup() {}, bindTooltip() {}, on() {}
      });
      const layer = {data, options, addTo() { calls.layers.push(this); return this; },
        setStyle() {}, getLayers() { return data.features; },
        getBounds() { return {isValid() {return true;}}; }};
      return layer;
    }
  };
  const ctx = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: () => new Element(), body: new Element() },
    window: { L }, L,
    Option: function(text, value) { return Object.assign(new Element(), {textContent:text, value}); },
    localStorage: {
      getItem: key => key === 'municipality-conquest-records-v1' ? JSON.stringify({
        '131016': {status:'passed', date:'2026-10-14', memo:'車'},
        '131041': {status:'visited', date:'2026-10-14', memo:'散策'}
      }) : null,
      setItem: (key, value) => calls.writes.push({key, value})
    },
    fetch: async url => {
      calls.fetch.push(url);
      return {ok: true, json: async () => url.includes('localgovjp') ? catalog :
        {type:'FeatureCollection', features: sourceFeatures} };
    },
    console: {warn() {}, error() {}}, setTimeout: () => 1, clearTimeout() {},
    alert() {}, confirm: () => true, Blob, URL: {createObjectURL: () => '', revokeObjectURL() {}}
  });
  vm.runInContext(script, ctx, {filename:'app.js'});
  return {elements, calls, ctx, layerGroup, sourceFeatures};
}

test('passed municipalities use orange fill, amber UI legend, and visible darker outlines', async () => {
  const a = createApp(); await settle();
  const passed = vm.runInContext('getMapStatusColor(mapGeoJSON.features[0])', a.ctx);
  const visited = vm.runInContext('getMapStatusColor(mapGeoJSON.features[2])', a.ctx);
  assert.equal(passed.fillColor, '#f09740');
  assert.equal(passed.color, '#9c4811');
  assert.ok(passed.fillOpacity >= 0.7);
  assert.equal(visited.fillColor, '#19865b');
  assert.match(css, /\.legend-dot\.passed \{ background: #f09740/);
  assert.match(css, /\.status-passed \{ color: #92430f/);
  assert.equal(a.calls.writes.length, 0);
});

test('municipality name labels only show on zoom 8 and above, and only once per municipality', async () => {
  const a = createApp(); await settle();
  assert.equal(a.layerGroup.markers.length, 0, '全国表示はラベル非表示');
  a.calls.zoom = 8;
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  assert.deepEqual(a.layerGroup.markers.map(marker => marker.options.icon.html).sort(),
    ['<span class="municipality-name-label municipality-name-label--town">千代田区</span>', '<span class="municipality-name-label municipality-name-label--town">新宿区</span>'].sort());
  assert.ok(a.calls.fetch.some(url => url.endsWith('GeoJson/13.json')),
    '詳細境界へ切り替わってもラベルを維持する');
  assert.ok(a.layerGroup.markers.every(marker => marker.options.interactive === false));
  assert.equal(a.calls.writes.length, 0);
  a.calls.zoom = 5;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.equal(a.layerGroup.markers.length, 0, '縮小するとラベルを消す');
});

test('label positioning handles islands, and styles remain readable on phone', () => {
  const a = createApp();
  const position = vm.runInContext(`getMunicipalityLabelPosition({
    type:'MultiPolygon',coordinates:[
      [[ [130,30], [130.1,30], [130.1,30.1], [130,30.1], [130,30] ]],
      [[ [139,35], [140,35], [140,36], [139,36], [139,35] ]]
    ]
  })`, a.ctx);
  assert.ok(Math.abs(position.lat - 35.5) < .001);
  assert.ok(Math.abs(position.lon - 139.5) < .001);
  assert.match(css, /\.municipality-name-label \{/);
  assert.match(css, /text-shadow: -1px -1px 0 #172019/);
  assert.match(css, /white-space: nowrap; padding: 0; background: transparent/);
  assert.match(css, /pointer-events: none/);
  assert.match(html, /地図を拡大すると、市名を大きな白文字/);
});
