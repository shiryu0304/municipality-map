// 地図の「都道府県を選択」が、既存の地域区分と同じ順序になるかを確認。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const regionStart = source.indexOf('const PREFECTURE_REGIONS = ');
const regionEnd = source.indexOf('\nfunction renderPrefectureProgress()', regionStart);
const functionStart = source.indexOf('function populateMapPrefectures()');
const functionEnd = source.indexOf('\n// 一度だけ全国の境界データ', functionStart);
assert.ok(regionStart >= 0 && regionEnd > regionStart && functionStart >= 0 && functionEnd > functionStart,
  'region definition and map picker function exist');

function createPicker({subset = false, unknown = false} = {}) {
  class Element {
    constructor(tag = 'option') { this.tag = tag; this.label = ''; this.value = ''; this.textContent = ''; this.children = []; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const mapPrefectureFilter = new Element('select');
  const context = vm.createContext({
    municipalities: [],
    mapPrefectureFilter,
    document: {createElement: tag => new Element(tag)},
    Option: function (name, value) {const option = new Element(); option.textContent = name; option.value = value; return option;}
  });
  vm.runInContext(`${source.slice(regionStart,regionEnd)}\n${source.slice(functionStart,functionEnd)}`, context);
  const regions = vm.runInContext('PREFECTURE_REGIONS',context);
  const all = Array.from(regions.flatMap(group => group.prefectures));
  const names = subset ? ['愛知県', '北海道', '東京都'] : all;
  for (const prefecture of names) context.municipalities.push({prefecture});
  if (unknown) context.municipalities.push({prefecture: '架空県'});
  vm.runInContext('populateMapPrefectures()',context);
  return {mapPrefectureFilter, regions, all, municipalities: context.municipalities, context};
}

test('map selector shows all 47 in eight optgroups in north-to-south order', () => {
  const {mapPrefectureFilter: picker, regions, all} = createPicker();
  assert.equal(all.length, 47);
  assert.equal(new Set(all).size, 47);
  const [nationwide, ...groups] = picker.children;
  assert.equal(nationwide.value, '');
  assert.equal(nationwide.textContent, '全国');
  assert.deepEqual(groups.map(group => group.tag), Array(8).fill('optgroup'));
  assert.deepEqual(groups.map(group => group.label), Array.from(regions, group => group.name));
  assert.deepEqual(groups.flatMap(group => group.children.map(el => el.value)), all);
  assert.equal(groups[0].children[0].value,'北海道');
  assert.equal(groups.at(-1).children.at(-1).value,'沖縄県');
});

test('map selector shows available regions only and retains unknown region fallback', () => {
  const {mapPrefectureFilter: picker} = createPicker({subset:true,unknown:true});
  const groups = picker.children.slice(1);
  assert.deepEqual(groups.map(group => group.label),['北海道','関東','中部','その他']);
  assert.deepEqual(groups.flatMap(group=>group.children.map(el=>el.value)),
    ['北海道','東京都','愛知県','架空県']);
});

test('map selector retains prefecture values, keeps the nationwide option and does not change records', () => {
  const {mapPrefectureFilter: picker, context, municipalities} = createPicker();
  const tokyo = picker.children.flatMap(group=>group.children).find(item=>item.value==='東京都');
  assert.ok(tokyo);
  picker.value = tokyo.value;
  assert.equal(picker.value, '東京都');
  assert.equal(municipalities.length, 47);
  vm.runInContext('populateMapPrefectures()',context);
  assert.equal(picker.children.length, 9,'repeated population does not duplicate entries');
  assert.equal(picker.children[0].value, '');
  assert.match(html, /<select id="mapPrefectureFilter"><option value="">全国<\/option><\/select>/);
  assert.match(html, /app\.js\?v=map-all-labels-20261017-region-groups-20261018/);
});
