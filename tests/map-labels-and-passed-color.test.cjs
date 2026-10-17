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
    markers: [], clearCount: 0,
    addTo() { return this; },
    clearLayers() { this.markers = []; this.clearCount++; },
    removeLayer(marker) { this.markers = this.markers.filter(m => m !== marker); },
    addLayer(marker) { this.markers.push(marker); }
  };
  const calls = { zoom: 5, writes: [], layers: [], fetch: [], mapOptions: null, viewportVisible: true };
  const mapBounds = { contains([lat, lon]) { return calls.viewportVisible && lat > 35 && lat < 37 && lon > 139 && lon < 141; }, pad() { return this; } };
  const map = {
    setView() { return this; }, fitBounds() { return this; }, setMaxBounds() { return this; },
    getZoom() { return calls.zoom; }, getBounds() { return mapBounds; },
    getCenter() { return {lat: 35.7, lng:139.7}; }, on() { return this; },
    removeLayer() {},
    latLngToContainerPoint([lat, lon]) { return { x: (lon - 139) * 900, y: (lat - 35) * 900 }; }
  };
  const L = {
    map: (_id, options) => { calls.mapOptions = options; return map; },
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
  const passed = vm.runInContext('getMapStatusColor({properties:{N03_001:"東京都",N03_004:"千代田区",N03_007:"13101"}})', a.ctx);
  const visited = vm.runInContext('getMapStatusColor({properties:{N03_001:"東京都",N03_004:"新宿区",N03_007:"13104"}})', a.ctx);
  assert.equal(passed.fillColor, '#f09740');
  assert.equal(passed.color, '#9c4811');
  assert.ok(passed.fillOpacity >= 0.7);
  assert.equal(visited.fillColor, '#19865b');
  assert.match(css, /\.legend-dot\.passed \{ background: #f09740/);
  assert.match(css, /\.status-passed \{ color: #92430f/);
  assert.equal(a.calls.writes.length, 0);
});

test('every municipality name is placed once and stays visible at small zoom', async () => {
  const a = createApp(); await settle();
  assert.equal(a.layerGroup.markers.length, 0, '全国表示はラベル非表示');
  a.calls.zoom = 8;
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const labels = a.layerGroup.markers.map(marker => marker.options.icon.html);
  assert.equal(labels.length, 2, '分割領域でも自治体名を二重表示しない');
  assert.ok(labels.some(text => text.includes('千代田区')));
  assert.ok(labels.some(text => text.includes('新宿区')));
  assert.ok(labels.every(text => text.includes('--label-fit-z8:')),
    '区域の広さに応じた文字サイズを設定');
  assert.ok(a.calls.fetch.some(url => url.endsWith('GeoJson/13.json')),
    '詳細境界へ切り替わってもラベルを維持する');
  assert.ok(a.layerGroup.markers.every(marker => marker.options.interactive === false));
  assert.equal(a.calls.writes.length, 0);
  a.calls.zoom = 5;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.equal(a.layerGroup.markers.length, 2, '縮小しても県内の地名は省略しない');
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
  assert.match(css, /-webkit-text-stroke: 2px #172019/);
  assert.match(css, /white-space: nowrap; padding: 0; background: transparent/);
  assert.match(css, /pointer-events: none/);
  assert.match(html, /県内で地域をタップすると記録を編集/);
});


test('pinch zoom keeps marker animation enabled and reuses visible name markers', async () => {
  const a = createApp(); await settle();
  assert.equal(a.calls.mapOptions.markerZoomAnimation, true,
    '拡大縮小中もLeafletのマーカーをアニメーションに追従させる');
  a.calls.zoom = 8;
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const before = [...a.layerGroup.markers];
  assert.equal(before.length, 2);
  const clearsBefore = a.layerGroup.clearCount;
  a.calls.zoom = 9;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.equal(a.layerGroup.clearCount, clearsBefore,
    '倍率が変わるたびに地名を全消去しない');
  assert.equal(a.layerGroup.markers.length, 2);
  for (const marker of before) assert.ok(a.layerGroup.markers.includes(marker),
    '見え続ける地名は元のマーカーのまま保持する');
  assert.equal(a.calls.writes.length, 0, '地名操作で訪問記録を書き換えない');
});


test('panning offscreen and back retains the same municipality label DOM markers', async () => {
  const a = createApp(); await settle();
  a.calls.zoom = 8;
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const first = [...a.layerGroup.markers];
  const previousClears = a.layerGroup.clearCount;
  assert.equal(first.length, 2);
  a.calls.viewportVisible = false;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.equal(a.layerGroup.markers.length, 2, '画面外に出ただけでは地名を削除しない');
  a.calls.viewportVisible = true;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.equal(a.layerGroup.markers.length, 2);
  for (const marker of first) assert.ok(a.layerGroup.markers.includes(marker),
    '戻した地名が同一のマーカーである');
  assert.equal(a.layerGroup.clearCount, previousClears, '往復時に地名全消去を行わない');
  assert.equal(a.calls.writes.length, 0);
});

// 小さい町村も表示し、縦長の行政区域は縦書きで収める。
test('all names including narrow towns are retained without collision filtering or hard limits', async () => {
  const a = createApp(); await settle();
  a.calls.zoom = 5;
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  assert.equal(a.layerGroup.markers.length, 2);
  const layout = vm.runInContext(`getMunicipalityLabelLayout({
    municipality:{name:'細長い町',type:'町'},lat:35,
    widthDegrees:0.018,heightDegrees:0.45
  })`, a.ctx);
  assert.equal(layout.vertical, true);
  assert.ok(layout.maxSize < 16);
  assert.match(css, /municipality-name-label--vertical/);
  assert.match(css, /font-size: clamp\(7px/);
  assert.ok(!script.includes('const limit = zoom >= 10'), 'old count limits removed');
  assert.equal(a.calls.writes.length, 0);
});

test('zoom updates only one CSS variable without re-adding markers', async () => {
  const a = createApp(); await settle();
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const before = [...a.layerGroup.markers];
  const clears = a.layerGroup.clearCount;
  a.calls.zoom = 10;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.deepEqual(a.layerGroup.markers, before);
  assert.equal(a.layerGroup.clearCount, clears);
  assert.equal(a.elements.get('japanMap').style['--label-zoom-scale'], '4');
});

test('dense prefecture adds every available municipality label once and keeps them while panning', async () => {
  const a = createApp(); await settle();
  a.elements.get('mapPrefectureFilter').value = '東京都';
  a.elements.get('mapPrefectureFilter').events.change();
  await settle();
  const labels = new Map(Array.from({length: 210}, (_, i) => {
    const code = String(500000 + i);
    return [code, {lat:35.3+i*0.0003,lon:139.2+i*0.0004,
      area:0.00001,widthDegrees:0.002,heightDegrees:0.003,
      municipality:{code,name:`検証村${i}`,prefecture:'東京都',type:'村'}}];
  }));
  const entry = vm.runInContext('detailedMapLayers.get("東京都")', a.ctx);
  entry.labels = labels;
  vm.runInContext('updateMapLabels()', a.ctx);
  assert.equal(a.layerGroup.markers.length,210,
    '町村が密集していても全件を配置し、固定件数の上限を使わない');
  const created = [...a.layerGroup.markers];
  const clearCount = a.layerGroup.clearCount;
  for(let i=0;i<40;i++) {
    a.calls.viewportVisible = Boolean(i%2);
    a.calls.zoom = i%2 ? 7 : 10;
    vm.runInContext('updateMapLabels()', a.ctx);
  }
  assert.equal(a.layerGroup.clearCount,clearCount);
  assert.deepEqual(a.layerGroup.markers,created);
  assert.equal(a.calls.writes.length,0);
});
