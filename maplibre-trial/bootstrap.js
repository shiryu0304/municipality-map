/* MapLibre試作版 v3。2つの配信先を順番に試し、失敗箇所を診断欄に出します。 */
(function () {
  'use strict';
  var diag = window.MapTrialDiagnostics;
  if (!window.MapTrialLogic) {
    diag && diag.fail('map-logic.js が見つかりません。フォルダ内のファイルを確認してください。');
    return;
  }
  function loadScript(url, ms) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      var finished = false;
      var timer = setTimeout(function () { finish(new Error('時間切れ')); }, ms);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        el.onload = null;
        el.onerror = null;
        if (error) { el.remove(); reject(error); }
        else resolve();
      }
      el.onload = function () { finish(); };
      el.onerror = function () { finish(new Error('ダウンロード失敗')); };
      el.src = url;
      document.head.appendChild(el);
    });
  }
  async function start() {
    var libraryURLs = [
      'https://cdn.jsdelivr.net/npm/maplibre-gl@5.12.0/dist/maplibre-gl.js',
      'https://unpkg.com/maplibre-gl@5.12.0/dist/maplibre-gl.js'
    ];
    for (var i = 0; i < libraryURLs.length && !window.maplibregl; i++) {
      diag && diag.mark('地図ライブラリを取得中（接続先 ' + (i + 1) + '/2）');
      try { await loadScript(libraryURLs[i], 7500); }
      catch (error) {
        diag && diag.mark('接続先 ' + (i + 1) + ' が失敗。' + (i + 1 < libraryURLs.length ? '別の接続先を確認します。' : '代替先も失敗しました。'));
      }
    }
    if (!window.maplibregl) {
      diag && diag.fail('地図ライブラリを2つの配信先のどちらからも取得できませんでした。');
      return;
    }
    diag && diag.mark('MapLibre取得成功。アプリの地図処理を開始しています。');
    try { await loadScript('app.js?v=3', 5000); }
    catch (error) { diag && diag.fail('app.js を読み込めませんでした：' + error.message); return; }
    if (!window.MapTrialStarted) diag && diag.fail('app.js は取得できましたが起動処理に入れませんでした。');
  }
  start().catch(function (error) { diag && diag.fail('初期化エラー：' + (error.message || String(error))); });
})();
