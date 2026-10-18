'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

test('存在しない maplibregl.supported() を呼び出さず地図を作成する', () => {
  assert.doesNotMatch(app, /if\s*\(\s*!\s*maplibregl\.supported\s*\(/);
  assert.match(app, /new maplibregl\.Map\(/);
  assert.match(app, /catch\s*\(error\)/);
});

test('WebGL初期化エラーを画面上の診断に表示する', () => {
  assert.match(app, /GPUInitializationError/);
  assert.match(app, /MapTrialDiagnostics\?\.fail\(mapBootError\)/);
});
