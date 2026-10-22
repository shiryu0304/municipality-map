// Run with: node --test tests/*.test.cjs
// Verify native, accessible folding without changing map or visit logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'style.css'), 'utf8');

test('prefecture progress starts folded and toggles with native details/summary', () => {
  const section = html.match(/<section class="panel prefecture-progress-panel">([\s\S]*?)<\/section>/);
  assert.ok(section, '都道府県別制覇率のセクションがある');
  assert.match(section[1], /<details class="prefecture-progress-details">/, 'open属性を付けず初期状態は閉じている');
  assert.match(section[1], /<summary class="prefecture-progress-toggle">/, '見出しで開閉できる');
  assert.match(section[1], /<h2>都道府県別の制覇率<\/h2>/);
  assert.match(section[1], /<span class="badge" id="prefectureProgressBadge">47都道府県<\/span>/);
  assert.match(section[1], /<div id="prefectureProgressList" class="prefecture-progress-list"><\/div>/);
  assert.ok(section[1].indexOf('<summary') < section[1].indexOf('</summary>'));
  assert.ok(section[1].indexOf('</summary>') < section[1].indexOf('id="prefectureProgressList"'), '47都道府県の内容が折りたたみの内部にある');
  assert.match(section[1], /<\/details>/);
});

test('expand indicator, keyboard focus and responsive progress grid remain styled', () => {
  assert.match(css, /\.prefecture-progress-toggle:focus-visible/);
  assert.match(css, /\.prefecture-progress-details\[open\] \.prefecture-progress-chevron/);
  assert.match(css, /\.prefecture-progress-toggle::-webkit-details-marker/);
  assert.match(css, /\.prefecture-progress-list \{ display: grid; grid-template-columns: repeat\(3/);
  assert.match(css, /\.prefecture-progress-list \{ grid-template-columns: repeat\(2/);
  assert.match(html, /style\.css\?v=perfect-gold-japan-icon-20261022/, '変更後のCSSを読み込む');
});
