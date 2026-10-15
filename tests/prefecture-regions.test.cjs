// Run with: node --test tests/*.test.cjs
// The regional headings and ordering are UI-only; saved visit records must not change.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const begin = source.indexOf('const PREFECTURE_REGIONS = ');
const end = source.indexOf('\nfunction renderAll()', begin);
assert.ok(begin !== -1 && end > begin, 'regional rendering code is present');
const regionalRenderer = source.slice(begin, end);

function setup({ unknown = false } = {}) {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.textContent = ''; this.children = []; this.events = {}; this.style = {}; this.className = ''; this.attributes = {}; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(type, cb) { this.events[type] = cb; }
    scrollIntoView() { this.scrolled = true; }
  }
  const nodes = {
    prefectureProgressList: new Element(),
    prefectureProgressBadge: new Element(),
    municipalityList: new Element()
  };
  const prefectureFilter = {value: ''};
  const municipalities = [];
  const records = new Map();
  let renderCount = 0;
  const ctx = vm.createContext({
    document: {createElement: tag => new Element(tag)},
    municipalities,
    prefectureFilter,
    getRecord: code => ({status: records.get(code) || 'unvisited'}),
    $: id => nodes[id],
    renderAll: () => {renderCount++;}
  });
  vm.runInContext(regionalRenderer, ctx);
  const groups = vm.runInContext('PREFECTURE_REGIONS', ctx);
  groups.flatMap(group => group.prefectures).forEach((prefecture, index) => {
    municipalities.push({code: `test${index}`, prefecture});
  });
  records.set('test0', 'visited');
  records.set('test1', 'passed');
  if (unknown) municipalities.push({code: 'extra', prefecture: '架空県'});
  vm.runInContext('renderPrefectureProgress()', ctx);
  return {nodes, prefectureFilter, groups, municipalities, records, get renderCount(){ return renderCount; }, ctx};
}

test('all 47 prefectures appear exactly once in north-to-south regional order', () => {
  const a = setup();
  const headings = a.nodes.prefectureProgressList.children.filter(el => el.tag === 'h3');
  const buttons = a.nodes.prefectureProgressList.children.filter(el => el.tag === 'button');
  assert.deepEqual(headings.map(el => el.textContent),
    ['北海道','東北','関東','中部','近畿','中国','四国','九州・沖縄']);
  const flattened = Array.from(a.groups.flatMap(g => g.prefectures));
  assert.equal(flattened.length, 47);
  assert.equal(new Set(flattened).size, 47, 'no duplicate prefectures');
  assert.deepEqual(buttons.map(el => el.children[0].children[0].textContent), flattened);
  assert.equal(a.nodes.prefectureProgressBadge.textContent, '47都道府県');
});

test('prefecture cards keep progress numbers and selection behavior', () => {
  const a = setup();
  const buttons = a.nodes.prefectureProgressList.children.filter(el => el.tag === 'button');
  assert.equal(buttons[0].children[0].children[1].textContent,'1 / 1');
  assert.equal(buttons[0].children[2].textContent,'100.0% 制覇');
  assert.equal(buttons[1].children[0].children[1].textContent,'0 / 1', 'passed does not count as visited');
  const tokyo = buttons.find(el => el.children[0].children[0].textContent === '東京都');
  assert.ok(tokyo);
  tokyo.events.click();
  assert.equal(a.prefectureFilter.value, '東京都');
  assert.equal(a.renderCount, 1);
  assert.equal(a.nodes.municipalityList.scrolled, true);
  tokyo.events.click();
  assert.equal(a.prefectureFilter.value, '');
  assert.equal(a.renderCount, 2);
  assert.equal(a.records.get('test0'), 'visited', 'rendering never writes to records');
});

test('unknown prefectures appear in an Other group instead of disappearing', () => {
  const a = setup({unknown:true});
  const nodes = a.nodes.prefectureProgressList.children;
  assert.equal(nodes.filter(el => el.tag === 'button').length, 48);
  assert.equal(nodes.filter(el => el.tag === 'h3').at(-1).textContent, 'その他');
  assert.equal(nodes.at(-1).children[0].children[0].textContent, '架空県');
  assert.equal(a.nodes.prefectureProgressBadge.textContent, '48都道府県');
});

test('regional headings span responsive columns and cache keys refresh changed CSS and JS', () => {
  assert.match(css, /\.prefecture-region-heading\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
  assert.match(css, /\.prefecture-progress-list \{ grid-template-columns: repeat\(2/);
  assert.match(html, /style\.css\?v=pref-regions-20261015/);
  assert.match(html, /app\.js\?v=pref-regions-20261015/);
  assert.match(html, /<details class="prefecture-progress-details">/, 'existing collapse behavior is retained');
});
