/*
 * MapLibre版・本体の地図。表示は試作v5を引き継ぐ。
 * 記録の保存・削除は行わず、本体app.jsから提供された記録を参照する。
 * 地図上の「記録を編集」は既存の編集ダイアログを開く。
 */
(function () {
  'use strict';

  const logic = window.MapTrialLogic;
  const $ = id => document.getElementById(id);
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const PREFECTURE_URL = 'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/prefectures.json';
  const DETAIL_BASE_URL = 'https://raw.githubusercontent.com/ricewin/simplify-japan-geojson/main/GeoJson/';
  const NATION_BOUNDS = [[122, 23], [154, 46]];
  const FETCH_TIMEOUT_MS = 15000;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;

  let map;
  let mapLoaded = false;
  let app;
  let index;
  let rawPrefectureData;
  let prefectureData;
  let borderError = '';
  let selectedPrefecture = '';
  let detailToken = 0;
  let detailController = null;
  let isFullscreen = false;
  const detailCache = new Map();

  function setStatus(message, error = false) {
    const el = $('mapDetailStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('map-error', error);
  }

  function setBadge(message) {
    const el = $('mapBadge');
    if (el) el.textContent = message;
  }

  function showLayer(id, visible) {
    if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }

  function loadScript(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let finished = false;
      const timer = setTimeout(() => finish(new Error('時間切れ')), timeoutMs);
      function finish(error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      }
      script.onload = () => finish();
      script.onerror = () => finish(new Error('取得に失敗しました'));
      script.src = url;
      document.head.appendChild(script);
    });
  }

  // v5と同じMapLibre 5.12.0を使用し、CDNが一方で失敗したときだけもう一方を試す。
  async function ensureMapLibre() {
    if (window.maplibregl) return;
    const urls = [
      'https://cdn.jsdelivr.net/npm/maplibre-gl@5.12.0/dist/maplibre-gl.js',
      'https://unpkg.com/maplibre-gl@5.12.0/dist/maplibre-gl.js'
    ];
    for (const url of urls) {
      try { await loadScript(url, 8500); }
      catch (error) { console.warn('MapLibreの取得に失敗しました', url, error); }
      if (window.maplibregl) return;
    }
    throw new Error('MapLibreライブラリを取得できませんでした。通信を確認して再読み込みしてください。');
  }

  // 自治体一覧の読み込み中に、MapLibre本体も並行して取得しておく。
  // 接続に失敗しても未処理のエラーにしない（地図の初期化時に画面表示する）。
  const libraryReady = ensureMapLibre().then(() => ({ ok: true }), error => ({ ok: false, error }));

  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (timedOut) throw new Error('通信が15秒以内に完了しませんでした');
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  function makeStyle() {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {},
      layers: [{ id: 'base', type: 'background', paint: { 'background-color': '#dbe6ec' } }]
    };
  }

  function createLayers() {
    map.addSource('prefectures', { type: 'geojson', data: EMPTY });
    map.addSource('municipalities', { type: 'geojson', data: EMPTY });
    map.addSource('municipality-labels', { type: 'geojson', data: EMPTY });
    // 選択した県だけ、市区町村と同じ座標から組み立てた境界線を使う。
    map.addSource('prefecture-detail-outline', { type: 'geojson', data: EMPTY });

    map.addLayer({ id: 'prefecture-fill', type: 'fill', source: 'prefectures',
      paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.76 } });
    map.addLayer({ id: 'prefecture-line', type: 'line', source: 'prefectures',
      paint: { 'line-color': '#264638', 'line-width': 1.4, 'line-opacity': 0.95 } });
    map.addLayer({ id: 'municipality-fill', type: 'fill', source: 'municipalities',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['match', ['get', 'status'], 'visited', '#19865b', 'passed', '#f09740', '#f4f8f5'],
        'fill-opacity': ['match', ['get', 'status'], 'visited', 0.64, 'passed', 0.78, 0.05]
      }
    });
    map.addLayer({ id: 'municipality-line', type: 'line', source: 'municipalities',
      layout: { visibility: 'none' },
      paint: {
        'line-color': ['match', ['get', 'status'], 'visited', '#235743', 'passed', '#9c4811', '#53685b'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 8, 0.65, 12, 1.15],
        'line-opacity': 0.87
      }
    });
    map.moveLayer('prefecture-line'); // 全国表示と詳細データ読み込み中に使う県境
    map.addLayer({ id: 'prefecture-detail-line', type: 'line', source: 'prefecture-detail-outline',
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#1b251e', 'line-width': ['step', ['zoom'], 2.5, 8, 4], 'line-opacity': 0.95 } });
    map.addLayer({ id: 'municipality-labels', type: 'symbol', source: 'municipality-labels',
      minzoom: 4,
      layout: {
        visibility: 'none',
        'text-field': ['get', 'displayName'],
        'text-font': ['Open Sans Regular'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-padding': 0,
        'text-anchor': 'center',
        'text-line-height': 0.95,
        'text-max-width': 20,
        'text-size': ['interpolate', ['linear'], ['zoom'],
          5, 7, 8, ['get', 'fontSizeAtZoom8'],
          11, ['min', 22, ['*', ['get', 'fontSizeAtZoom8'], 1.8]]]
      },
      paint: { 'text-color': '#152d24', 'text-halo-color': 'rgba(255,255,255,.97)', 'text-halo-width': 1.2 }
    });
  }

  function applyBorderFilter() {
    const filter = selectedPrefecture ? ['==', ['get', 'pref'], selectedPrefecture] : null;
    for (const id of ['prefecture-fill', 'prefecture-line']) {
      if (map?.getLayer(id)) map.setFilter(id, filter);
    }
    if (map?.getLayer('prefecture-line')) {
      map.setPaintProperty('prefecture-line', 'line-color', selectedPrefecture ? '#1b251e' : '#264638');
      map.setPaintProperty('prefecture-line', 'line-width', selectedPrefecture
        ? ['step', ['zoom'], 2.5, 8, 4] : 1.4);
    }
  }

  function updateLayerModes() {
    const national = !selectedPrefecture;
    const ready = !national && detailCache.has(selectedPrefecture);
    showLayer('prefecture-fill', national || !ready);
    // 粗い全国の県境と詳細な県境を重ねない（ずれ・二重線を防止）。
    showLayer('prefecture-line', national || !ready);
    showLayer('prefecture-detail-line', ready);
    showLayer('municipality-fill', ready);
    showLayer('municipality-line', ready);
    showLayer('municipality-labels', ready && $('mapLabelsToggle')?.checked);
  }

  // 選択された時だけ背景タイルを読み込む。OFFが試作v5と同じ初期値。
  function updateBackground() {
    if (!mapLoaded) return;
    if (!$('mapOceanToggle').checked) {
      showLayer('ocean-raster', false);
      return;
    }
    if (!map.getSource('ocean')) {
      map.addSource('ocean', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, minzoom: 0, maxzoom: 9,
        attribution: 'Esri, Garmin, GEBCO, NOAA NGDC ほか'
      });
      map.addLayer({ id: 'ocean-raster', type: 'raster', source: 'ocean',
        paint: { 'raster-opacity': 0.96 } }, 'prefecture-fill');
    }
    showLayer('ocean-raster', true);
  }

  function fit(bounds, maxZoom = 8) {
    if (!map || !bounds) return;
    const [[west, south], [east, north]] = bounds;
    map.fitBounds([[west, south], [east, north]], {
      padding: window.innerWidth <= 700 ? 22 : 56,
      maxZoom,
      duration: reducedMotion ? 0 : 460,
      essential: !reducedMotion
    });
  }

  function showPopup(properties, lngLat) {
    if (!properties?.code || !selectedPrefecture) return;
    const municipality = app.municipalitiesByCode.get(properties.code);
    if (!municipality) return;
    const records = app.getRecords();
    const status = logic.normalizeStatus(records[municipality.code]?.status);
    const content = document.createElement('div');
    content.className = 'maplibre-record-popup';
    const title = document.createElement('strong');
    title.textContent = municipality.name;
    const description = document.createElement('p');
    const statusLabel = { visited: '訪問', passed: '通過', unvisited: '未踏' }[status];
    description.textContent = `${municipality.prefecture} · ${statusLabel}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'button primary';
    edit.textContent = '記録を編集';
    edit.addEventListener('click', () => {
      maplibreglPopup?.remove();
      app.openRecordDialog(municipality);
    });
    content.append(title, description, edit);
    maplibreglPopup?.remove();
    maplibreglPopup = new maplibregl.Popup({ closeButton: true, maxWidth: '275px' })
      .setLngLat(lngLat).setDOMContent(content).addTo(map);
  }
  let maplibreglPopup = null;

  function setupInteractions() {
    map.on('click', 'prefecture-fill', event => {
      if (selectedPrefecture) return;
      const pref = event.features?.[0]?.properties?.pref;
      if (pref) void choosePrefecture(pref);
    });
    map.on('click', 'municipality-fill', event => {
      const props = event.features?.[0]?.properties;
      if (props) showPopup(props, event.lngLat);
    });
    for (const layer of ['prefecture-fill', 'municipality-fill']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
  }

  function refreshRecords() {
    if (!mapLoaded || !rawPrefectureData || !app) return;
    const counts = logic.prefectureProgress(app.municipalities, app.getRecords());
    prefectureData = logic.enrichPrefectureFeatures(rawPrefectureData, counts);
    map.getSource('prefectures').setData(prefectureData);
    if (selectedPrefecture && detailCache.has(selectedPrefecture)) displayCachedDetail(selectedPrefecture);
  }

  function displayCachedDetail(prefecture) {
    if (!mapLoaded || !app || selectedPrefecture !== prefecture) return;
    const cached = detailCache.get(prefecture);
    if (!cached) return;
    const processed = logic.enrichMunicipalityFeatures(cached.raw, prefecture, index, app.getRecords());
    map.getSource('municipalities').setData(processed);
    map.getSource('municipality-labels').setData(cached.labels);
    map.getSource('prefecture-detail-outline').setData(cached.outline);
    updateLayerModes();
    const count = new Set(processed.features.map(feature => feature.properties.code)).size;
    setBadge(`${prefecture} · ${count}自治体`);
    setStatus('市区町村を表示中です。地域をタップすると訪問記録を編集できます。');
  }

  async function loadDetail(prefecture, token) {
    if (detailCache.has(prefecture)) {
      if (token === detailToken && selectedPrefecture === prefecture) displayCachedDetail(prefecture);
      return;
    }
    const representative = app.municipalities.find(m => m.prefecture === prefecture);
    if (!representative) return;
    const code = logic.normalizeMapCode(representative.code).slice(0, 2);
    const controller = new AbortController();
    detailController = controller;
    try {
      const data = await fetchJSON(`${DETAIL_BASE_URL}${code}.json`, { signal: controller.signal });
      const processed = logic.enrichMunicipalityFeatures(data, prefecture, index, app.getRecords());
      const labels = logic.makeLabels(processed.features);
      // 元の市区町村GeoJSONから、共有する内部境界だけを除いた県の外周線を生成。
      const outline = logic.createDetailedPrefectureOutline(data, prefecture);
      detailCache.delete(prefecture);
      detailCache.set(prefecture, { raw: data, labels, outline });
      while (detailCache.size > 3) detailCache.delete(detailCache.keys().next().value);
      if (token !== detailToken || selectedPrefecture !== prefecture) return;
      displayCachedDetail(prefecture);
    } catch (error) {
      if (controller.signal.aborted || token !== detailToken) return;
      console.warn('市区町村データの読み込みに失敗', prefecture, error);
      setBadge(`${prefecture} · 読み込み失敗`);
      setStatus(`${prefecture}の詳細地図を読み込めませんでした：${error.message}。別の県に切り替えてから再度お試しください。`, true);
    } finally {
      if (detailController === controller) detailController = null;
    }
  }

  async function choosePrefecture(prefecture) {
    if (!mapLoaded || !prefectureData) return;
    if (prefecture && !app.municipalitiesByPrefecture.has(prefecture)) return;
    detailToken++;
    detailController?.abort();
    detailController = null;
    selectedPrefecture = prefecture;
    $('mapPrefectureFilter').value = prefecture;
    $('resetMapView').disabled = !prefecture;
    $('mapPanel').classList.toggle('is-national-mode', !prefecture);
    $('mapModeTitle').textContent = prefecture ? `${prefecture}の市区町村マップ` : '全国から都道府県を選択';
    $('mapOverviewLegend').hidden = Boolean(prefecture);
    $('mapMunicipalityLegend').hidden = !prefecture;
    maplibreglPopup?.remove();
    map.getSource('municipalities').setData(EMPTY);
    map.getSource('municipality-labels').setData(EMPTY);
    map.getSource('prefecture-detail-outline').setData(EMPTY);
    applyBorderFilter();
    updateLayerModes();
    if (!prefecture) {
      setBadge(`全国 · ${app.municipalitiesByPrefecture.size}都道府県`);
      setStatus('地図の都道府県をタップすると、その県の市区町村を読み込みます。');
      fit(NATION_BOUNDS, 5.4);
      return;
    }
    const features = prefectureData.features.filter(f => f.properties.pref === prefecture);
    const bounds = logic.getGeoJSONBounds(features);
    if (bounds) fit([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], 8);
    setBadge(`${prefecture} · 読み込み中`);
    setStatus('詳細な市区町村境界を読み込み中です。読み込み中も地図を動かせます。');
    void loadDetail(prefecture, detailToken);
  }

  function populateMapPrefectures() {
    const select = $('mapPrefectureFilter');
    select.replaceChildren(new Option('全国', ''));
    const allowed = new Set(app.municipalities.map(m => m.prefecture));
    for (const region of app.regions) {
      const present = region.prefectures.filter(pref => allowed.has(pref));
      if (!present.length) continue;
      const group = document.createElement('optgroup');
      group.label = region.name;
      for (const pref of present) group.append(new Option(pref, pref));
      select.append(group);
    }
    const grouped = new Set(app.regions.flatMap(region => region.prefectures));
    const others = [...allowed].filter(pref => !grouped.has(pref)).sort((a,b) => a.localeCompare(b,'ja'));
    if (others.length) {
      const group = document.createElement('optgroup');
      group.label = 'その他';
      for (const pref of others) group.append(new Option(pref, pref));
      select.append(group);
    }
  }

  async function loadBorders() {
    try {
      const geo = await fetchJSON(PREFECTURE_URL);
      logic.preparePrefectureOutlines(geo);
      rawPrefectureData = geo;
      borderError = '';
      if (mapLoaded) {
        refreshRecords();
        setStatus('地図の都道府県をタップすると、その県の市区町村を読み込みます。');
      }
    } catch (error) {
      console.warn('県境の取得に失敗', error);
      borderError = error.message || String(error);
      setBadge('地図の読み込み失敗');
      setStatus(`県境データを読み込めませんでした：${error.message}。ページを再読み込みしてください。`, true);
    }
  }

  function setFullscreen(expanded) {
    isFullscreen = expanded;
    $('mapPanel').classList.toggle('is-map-fullscreen', expanded);
    document.body.classList.toggle('map-fullscreen-active', expanded);
    $('toggleMapFullscreen').textContent = expanded ? '閉じる' : '全画面表示';
    $('resetMapView').textContent = expanded ? '全国へ' : '全国表示に戻す';
    $('toggleMapFullscreen').setAttribute('aria-pressed', String(expanded));
    $('toggleMapFullscreen').setAttribute('aria-label', expanded ? '地図の全画面表示を終了' : '地図を全画面で表示');
    requestAnimationFrame(() => requestAnimationFrame(() => map?.resize()));
  }

  function setupButtons() {
    $('mapPrefectureFilter').addEventListener('change', event => { void choosePrefecture(event.target.value); });
    $('resetMapView').addEventListener('click', () => { void choosePrefecture(''); });
    $('toggleMapFullscreen').addEventListener('click', () => setFullscreen(!isFullscreen));
    $('mapLabelsToggle').addEventListener('change', () => updateLayerModes());
    $('mapOceanToggle').addEventListener('change', updateBackground);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isFullscreen && !document.querySelector('#recordDialog[open]')) setFullscreen(false);
    });
  }

  async function initialize({ municipalities, getRecords, openRecordDialog, regions }) {
    app = {
      municipalities, getRecords, openRecordDialog, regions,
      municipalitiesByCode: new Map(municipalities.map(m => [m.code, m])),
      municipalitiesByPrefecture: new Set(municipalities.map(m => m.prefecture))
    };
    if (!logic) {
      setBadge('地図の読み込み失敗');
      setStatus('maplibre-map-logic.jsが見つかりません。ファイルを確認してください。', true);
      return;
    }
    index = logic.createMunicipalityIndex(municipalities);
    populateMapPrefectures();
    setupButtons();
    setStatus('MapLibreの準備中です…');
    // 地図ライブラリと県境データを並行して準備し、ネットワーク待ちを減らす。
    void loadBorders();
    try {
      const ready = await libraryReady;
      if (!ready.ok) throw ready.error;
      map = new maplibregl.Map({
        container: 'japanMap', style: makeStyle(), center: [138,36], zoom: 4.5,
        minZoom: 3, maxZoom: 12,
        bearing: 0, pitch: 0, dragRotate: false, touchPitch: false,
        renderWorldCopies: false, attributionControl: true,
        localIdeographFontFamily: 'sans-serif', fadeDuration: 80
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('load', () => {
        try {
          createLayers();
          setupInteractions();
          mapLoaded = true;
          fit(NATION_BOUNDS, 5.4);
          updateBackground();
          if (rawPrefectureData) {
            refreshRecords();
            setStatus('地図の都道府県をタップすると、その県の市区町村を読み込みます。');
          } else if (borderError) {
            setStatus(`県境データの読み込みに失敗しました：${borderError}`, true);
          } else {
            setStatus('地図を準備しました。都道府県境界を読み込み中です…');
          }
        } catch (error) {
          setBadge('地図の初期化に失敗');
          setStatus(`地図の初期化に失敗しました：${error.message}`, true);
          console.error(error);
        }
      });
      map.on('error', event => {
        console.warn('地図の描画・外部データでエラー', event.error || event);
        if (!mapLoaded) setStatus('地図の描画を開始できませんでした。WebGLの設定と通信状態を確認してください。', true);
      });
    } catch (error) {
      setBadge('地図の起動に失敗');
      setStatus(`地図を起動できませんでした：${error.message}`, true);
      console.error('MapLibre起動エラー', error);
    }
  }

  window.MainMapLibre = { initialize, refreshRecords };
})();
