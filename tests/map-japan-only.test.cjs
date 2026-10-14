// Run with: node --test tests/*.test.cjs
// Checks the map initialization with a simulated DOM and Leaflet (no live network or browser).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'app.js'), 'utf8');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setImmediate(resolve));
};

function buildApp() {
  const elements = new Map();
  class Element {
    constructor() {
      this.value = '';
      this.textContent = '';
      this.disabled = false;
      this.style = {};
      this.children = [];
      this.events = new Map();
      this.attributes = {};
      this.classList = { add() {}, remove() {} };
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    add(item) { this.children.push(item); }
    addEventListener(key, handler) { this.events.set(key, handler); }
    scrollIntoView() {}
    click() { this.events.get('click')?.(); }
  }
  for (const match of html.matchAll(/<\w+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set(match[1], new Element());
  }
  elements.get('statusFilter').value = 'all';

  const mapCalls = { layers: [], tiles: [], fitted: [], maxBounds: [], pans: [], options: null };
  const map = {
    setView() { return this; },
    fitBounds(bounds, options) { mapCalls.fitted.push({ bounds, options }); return this; },
    setMaxBounds(bounds) { mapCalls.maxBounds.push(bounds); return this; },
    panBy(offset, options) { mapCalls.pans.push({ offset, options }); return this; },
    getBounds() { return { pad(value) { return { displayPadding: value }; } }; },
    removeLayer() {}
  };
  const realBounds = {
    isValid: () => true,
    pad(value) { return { padded: value, original: this, isValid: () => true }; }
  };
  const Leaflet = {
    map(id, options) {
      assert.equal(id, 'japanMap');
      mapCalls.options = options;
      return map;
    },
    tileLayer(url, options) { mapCalls.tiles.push({ url, options }); return { addTo() {} }; },
    geoJSON(data, options) {
      mapCalls.layers.push({ data, options });
      const layers = data.features.map(() => ({
        bindPopup() {},
        on() {},
        bindTooltip() {}
      }));
      return {
        addTo() { return this; },
        getBounds() { return realBounds; },
        getLayers() { return layers; },
        setStyle() {}
      };
    }
  };
  const town = { lgcode: '131016', pref: '東京都', city: '千代田区' };
  const catalog = [town, ...Array.from({ length: 999 }, (_, i) => ({
    lgcode: String(700000 + i), pref: '北海道', city: `テスト${i}市`
  }))];
  const tokyoPolygon = { type: 'Feature', properties: {
    N03_001: '東京都', N03_004: '千代田区', N03_007: '13101'
  }, geometry: { type: 'Polygon', coordinates: [[[139.7, 35.6], [139.8, 35.6], [139.8, 35.7], [139.7, 35.6]]] } };
  const foreignPolygon = { type: 'Feature', properties: {
    N03_001: '外国', N03_004: '海外の地域', N03_007: '99999'
  }, geometry: { type: 'Polygon', coordinates: [[[127, 37], [128, 37], [128, 38], [127, 37]]] } };
  const geojson = { type: 'FeatureCollection', features: [tokyoPolygon, foreignPolygon] };
  const fetches = [];
  const stored = JSON.stringify({ '131016': { status: 'visited', date: '2026-01-01', memo: 'Safe' } });
  const writes = [];
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: () => new Element(), body: new Element() },
    localStorage: {
      getItem: key => key === 'municipality-conquest-records-v1' ? stored : null,
      setItem: (key, value) => writes.push({ key, value })
    },
    fetch: async url => {
      fetches.push(url);
      return { ok: true, json: async () => fetches.length === 1 ? catalog : geojson };
    },
    L: Leaflet,
    window: { L: Leaflet },
    Option: function(text, value) { return Object.assign(new Element(), { textContent: text, value }); },
    console: { warn() {}, error() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    alert() {},
    confirm: () => true,
    Blob,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} }
  });
  vm.runInContext(source, context, { filename: 'app.js' });
  return { mapCalls, elements, writes, fetches, tokyoPolygon };
}

test('shows Japanese municipality boundaries over Japan-only GSI terrain tiles', async () => {
  const app = buildApp();
  await settle();
  assert.equal(app.fetches.length, 2);
  assert.equal(app.mapCalls.tiles.length, 3);
  const urls = app.mapCalls.tiles.map(tile => tile.url);
  assert.deepEqual(urls, [
    'https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png',
    'https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png',
    'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png'
  ], 'map must use Japan coverage tiles, not OSM or global map tiles');
  for (const tile of app.mapCalls.tiles) {
    assert.deepEqual(Array.from(tile.options.bounds[0]), [20, 122]);
    assert.deepEqual(Array.from(tile.options.bounds[1]), [46, 154]);
    assert.equal(tile.options.minNativeZoom, 5);
  }
  assert.match(app.mapCalls.tiles[0].options.attribution, /国土地理院/);
  assert.equal(app.mapCalls.layers.length, 1);
  const features = app.mapCalls.layers[0].data.features;
  assert.equal(features.length, 1, 'non-Japan polygons must not enter the displayed layer');
  assert.equal(features[0].properties.N03_004, '千代田区');
  const polygonSettings = app.mapCalls.layers[0].options;
  assert.equal(polygonSettings.smoothFactor, 0.35, 'boundary simplification must be reduced');
  assert.equal(polygonSettings.style(app.tokyoPolygon).fillColor, '#19865b');
  assert.ok(polygonSettings.style(app.tokyoPolygon).fillOpacity < 0.7);
  assert.equal(app.writes.length, 0, 'map display must not change visit records');
});

test('map stays near Japan and supports prefecture filtering and nationwide reset', async () => {
  const app = buildApp();
  await settle();
  assert.equal(app.mapCalls.options.maxBoundsViscosity, 1);
  assert.equal(app.mapCalls.options.minZoom, 3);
  assert.equal(app.mapCalls.options.maxZoom, 12);
  assert.equal(app.mapCalls.maxBounds.length, 2);
  assert.equal(app.mapCalls.maxBounds[0], null, '古い範囲制限を解除してから位置を変える');
  assert.equal(app.mapCalls.maxBounds[1].displayPadding, 0.12, '中央配置後の表示範囲で移動制限を再設定');
  assert.equal(app.mapCalls.pans.length, 0, '日本列島を強制的に下へ移動しない');
  assert.equal(app.mapCalls.fitted.length, 1);
  assert.deepEqual(Array.from(app.mapCalls.fitted[0].options.padding), [32, 32], '上下左右均等な余白で中央表示する');
  assert.equal(app.mapCalls.fitted[0].options.maxZoom, 5);
  assert.equal(app.elements.get('mapBadge').textContent, '全国 · 1 区域');

  const filter = app.elements.get('mapPrefectureFilter');
  filter.value = '東京都';
  filter.events.get('change')();
  assert.equal(app.mapCalls.layers.length, 2);
  assert.equal(app.mapCalls.layers[1].data.features.length, 1);
  assert.equal(app.mapCalls.fitted[1].options.maxZoom, 8);
  assert.deepEqual(Array.from(app.mapCalls.fitted[1].options.padding), [24, 24]);
  assert.equal(app.mapCalls.maxBounds.length, 2, 'prefecture selection preserves Japan bounds');
  assert.equal(app.mapCalls.pans.length, 0, '都道府県表示でも強制移動は行わない');

  app.elements.get('resetMapView').click();
  assert.equal(filter.value, '');
  assert.equal(app.mapCalls.layers.length, 3);
  assert.equal(app.mapCalls.fitted[2].options.maxZoom, 5);
  assert.deepEqual(Array.from(app.mapCalls.fitted[2].options.padding), [32, 32], '全国表示に戻しても中央に配置する');
  assert.equal(app.mapCalls.maxBounds.length, 4);
  assert.equal(app.mapCalls.maxBounds[2], null);
  assert.equal(app.mapCalls.maxBounds[3].displayPadding, 0.12);
  assert.equal(app.mapCalls.pans.length, 0, '全国表示へ戻すときも強制移動を行わない');
  assert.equal(app.writes.length, 0);
});


test('terrain and place labels are documented in the HTML and CSS', () => {
  const css = readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(html, /地形の陰影・市区町村名/);
  assert.match(css, /#japanMap.*background: #314f78/);
  assert.match(css, /japan-name-tiles.*mix-blend-mode: multiply/s);
});

// 地図だけの高さを変えており、訪問記録や他のUIには影響させない。
test('desktop and mobile map heights leave enough room for Japan', () => {
  const css = readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /#japanMap \{ height: 650px; background: #f5f8f6; \}/);
  assert.match(css, /@media \(max-width: 650px\) \{ #japanMap \{ height: 530px; \}/);
});
