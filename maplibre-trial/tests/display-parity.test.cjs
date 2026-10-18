
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../map-logic.js');
const app = fs.readFileSync(path.join(__dirname, '../app.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'),'utf8');
function feature(code,name,points,type='町') {
  return {type:'Feature', properties:{code,name,type}, geometry:{type:'Polygon',coordinates:[points]}};
}

test('元アプリと同じ県境/訪問/通過/未踏のスタイルを維持',()=>{
  assert.match(app, /'visited',0\.64, 'passed',0\.78, 0\.05/);
  assert.match(app, /'visited','#19865b', 'passed','#f09740'/);
  assert.match(app, /'#1b251e'/);
});
test('県境は自治体境界より手前、地名より奥にある',()=>{
  const order = [app.indexOf("id: 'municipality-line'"),app.indexOf("map.moveLayer('prefecture-line')"),app.indexOf("id: 'municipality-labels'")];
  assert.ok(order.every(n=>n>0));
  assert.ok(order[0]<order[1] && order[1]<order[2]);
});
test('全自治体名の表示を優先し、文字は移動中に再配置しない',()=>{
  assert.match(app, /'text-allow-overlap': true/);
  assert.match(app, /'text-field': \['get', 'displayName'\]/);
  assert.match(app, /'fontSizeAtZoom8'/);
});
test('縦長の自治体名は縦方向に並べる',()=>{
  const item = {name:'縦長町',type:'町',lat:35,widthDegrees:0.01,heightDegrees:0.14};
  const layout = L.getLabelLayout(item);
  assert.equal(layout.vertical,true);
  assert.ok(layout.fontSizeAtZoom8>=8);
  const ring=[[135,35],[135.01,35],[135.01,35.14],[135,35.14],[135,35]];
  const labels=L.makeLabels([feature('123','縦長町',ring)]);
  assert.equal(labels.features.length,1);
  assert.equal(labels.features[0].properties.displayName,'縦\n長\n町');
});
test('一自治体に複数の島があっても地名は1個',()=>{
  const a=[[135,35],[135.01,35],[135.01,35.01],[135,35.01],[135,35]];
  const b=[[135.1,35.1],[135.3,35.1],[135.3,35.3],[135.1,35.3],[135.1,35.1]];
  const labels=L.makeLabels([feature('123','島町',a), feature('123','島町',b)]);
  assert.equal(labels.features.length,1);
  assert.ok(labels.features[0].geometry.coordinates[0]>135.1);
});
test('元アプリは上書きしないv5のみ更新',()=>{
  assert.match(html,/診断 v5/);
  assert.match(html,/map-logic\.js\?v=5/);
  assert.match(html,/bootstrap\.js\?v=5/);
});
