const {test}=require('node:test');const assert=require('node:assert/strict');
const {createHarness}=require('./support/maplibre-harness.cjs');
test('全画面表示は元アプリの画面構造とボタンを使用する',async()=>{
 const a=createHarness();await a.settle();a.el('toggleMapFullscreen').click();
 assert.equal(a.el('toggleMapFullscreen').textContent,'閉じる');
 assert.equal(a.el('mapPanel').classList.contains('is-map-fullscreen'),true);
 assert.ok(a.map.resized>=1);
 a.el('toggleMapFullscreen').click();assert.equal(a.el('toggleMapFullscreen').textContent,'全画面表示');
});
test('市区町村をタップすると既存の記録編集ダイアログが開く',async()=>{
 const a=createHarness();await a.settle();
 a.map.emit('click','prefecture-fill',{features:[{properties:{pref:'東京都'}}]});await a.settle();
 a.map.emit('click','municipality-fill',{features:[{properties:{code:'131016'}}],lngLat:{lng:139.7,lat:35.7}});
 assert.equal(a.calls.popups.length,1);assert.equal(a.calls.popups[0].content.children[2].textContent,'記録を編集');
 a.calls.popups[0].content.children[2].click();
 assert.equal(a.calls.dialogs[0].code,'131016');
});

// 元の「地図をタップ→編集」の流れを維持して、ふりがなだけ追加表示する。
test('市区町村名の上に元データのひらがなを表示する',async()=>{
 const a=createHarness();await a.settle();
 a.map.emit('click','prefecture-fill',{features:[{properties:{pref:'大阪府'}}]});await a.settle();
 a.map.emit('click','municipality-fill',{features:[{properties:{code:'272117'}}],lngLat:{lng:135.5,lat:34.8}});
 const popup=a.calls.popups.at(-1).content;
 const title=popup.children[0];
 assert.equal(title.tagName,'STRONG');
 assert.equal(title.children[0].tagName,'RUBY');
 assert.equal(title.children[0].textContent,'茨木市');
 assert.equal(title.children[0].children[0].tagName,'RT');
 assert.equal(title.children[0].children[0].textContent,'いばらきし');
 assert.match(popup.children[1].textContent,/大阪府/);
 popup.children[2].click();
 assert.equal(a.calls.dialogs.at(-1).name,'茨木市');
});

test('ふりがなが空欄なら地図ポップアップは名前だけ表示する',async()=>{
 const a=createHarness();await a.settle();
 a.municipalities[0].kana='';
 a.map.emit('click','prefecture-fill',{features:[{properties:{pref:'東京都'}}]});await a.settle();
 a.map.emit('click','municipality-fill',{features:[{properties:{code:'131016'}}],lngLat:{lng:139.7,lat:35.7}});
 const title=a.calls.popups.at(-1).content.children[0];
 assert.equal(title.textContent,'千代田区');
 assert.equal(title.children.length,0);
});
