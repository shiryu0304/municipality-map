/*
 * 市区町村制覇 MapLibre GL JS 試作版
 * ・元アプリのファイルと localStorage を一切書き換えない
 * ・表示に必要な自治体一覧・県境・選択県の詳細境界のみ取得する
 */
(() => {
  'use strict';
  const logic = window.MapTrialLogic;
  const $ = id => document.getElementById(id);
  const DATA_URL = 'https://code4fukui.github.io/localgovjp/localgovjp.json';
  const PREFECTURE_URL = 'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/prefectures.json';
  const DETAIL_BASE_URL = 'https://raw.githubusercontent.com/ricewin/simplify-japan-geojson/main/GeoJson/';
  const STORAGE_KEY = 'municipality-conquest-records-v1';
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const NATION_BOUNDS = [[122, 23], [154, 46]];
  const FETCH_TIMEOUT_MS = 15000;
  window.MapTrialStarted = true;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;

  let map;
  let mapLoaded = false;
  let municipalities = [];
  let municipalityIndex;
  let rawPrefectureData;
  let prefectureData;
  let records = {};
  let selectedPrefecture = '';
  let detailRequestToken = 0;
  let detailController = null;
  let fullscreen = false;
  const detailCache = new Map();
  const dataState = { municipalities: 'idle', borders: 'idle' };
  const dataErrors = { municipalities: '', borders: '' };
  let mapBootError = '';
  const prefCounts = () => logic.prefectureProgress(municipalities, records);

  function status(message, isError = false) {
    $('statusText').textContent = message;
    $('statusText').classList.toggle('error', isError);
  }

  function recordSource(text) {
    $('recordSource').textContent = text;
  }

  function accessibleError(error) {
    console.error('MapLibre試作版:', error);
    status(`読み込みに失敗しました：${error.message || String(error)}。通信状態を確認して、再読み込みしてください。`, true);
  }

  // 取得先が応答しない場合も15秒後に画面から再試行できるようにする。
  async function fetchJSON(url, options = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
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
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  function updateLoadingStatus() {
    if (selectedPrefecture) return;
    const errors = Object.entries(dataErrors).filter(([, message]) => message);
    $('retryButton').hidden = errors.length === 0;
    if (mapBootError) {
      status(mapBootError, true);
      return;
    }
    if (!mapLoaded) {
      status('地図の描画を準備中です…（15秒以上続く場合は再読み込みしてください）');
      return;
    }
    if (errors.length) {
      const subjects = errors.map(([key, message]) =>
        `${key === 'borders' ? '都道府県境界' : '自治体一覧'}：${message}`);
      status(`データ取得に失敗しました。${subjects.join('／')}。「データ再取得」を押してください。`, true);
      return;
    }
    if (!rawPrefectureData) {
      status('地図エンジンは準備できました。都道府県の境界データを取得中です…');
      return;
    }
    if (!municipalities.length) {
      status('都道府県の地図は表示されています。自治体一覧を取得中です…');
      return;
    }
    status('地図の読み込みが完了しました。都道府県を選ぶと市区町村を表示します。');
  }

  function readOnlyExistingRecords() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY); // 読み取りのみ。setItem/removeItem禁止。
      if (!raw) {
        recordSource('このブラウザに保存済みの記録はありません（JSONを選んで確認できます）');
        return {};
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const allowedCodes = new Set(municipalities.map(m => m.code));
      const result = logic.parseRecordBackup(parsed, allowedCodes);
      recordSource(`このブラウザの記録を読み取り専用で表示（${result.count}件）`);
      return result.records;
    } catch (error) {
      console.warn('元アプリの記録を読み取れませんでした。', error);
      recordSource('記録を読み取れません（必要ならJSONを選択してください）');
      return {};
    }
  }

  // 初期表示で外部タイルを待たない。国・都道府県境界は別に読み込む。
  function makeStyle() {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {},
      layers: [
        { id: 'base', type: 'background', paint: { 'background-color': '#dbe6ec' } }
      ]
    };
  }

  // 重い背景タイルは希望した時だけ後から追加し、県境より下に敷く。
  function updateBackground() {
    if (!mapLoaded) return;
    if (!$('oceanToggle').checked) {
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
      map.addLayer({
        id: 'ocean-raster', type: 'raster', source: 'ocean',
        paint: { 'raster-opacity': 0.96 }
      }, 'prefecture-fill');
    }
    showLayer('ocean-raster', true);
  }

  function showLayer(layerId, show) {
    if (map?.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', show ? 'visible' : 'none');
  }

  function setMapLayerModes() {
    const national = !selectedPrefecture;
    showLayer('prefecture-fill', national || !detailCache.has(selectedPrefecture));
    showLayer('prefecture-line', true);
    showLayer('municipality-fill', !national && detailCache.has(selectedPrefecture));
    showLayer('municipality-line', !national && detailCache.has(selectedPrefecture));
    showLayer('municipality-labels', !national && detailCache.has(selectedPrefecture) && $('labelsToggle').checked);
  }

  function makeMapLayers() {
    map.addSource('prefectures', { type: 'geojson', data: EMPTY });
    map.addSource('municipalities', { type: 'geojson', data: EMPTY });
    map.addSource('municipality-labels', { type: 'geojson', data: EMPTY });

    map.addLayer({ id: 'prefecture-fill', type: 'fill', source: 'prefectures',
      paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.76 } });
    map.addLayer({ id: 'prefecture-line', type: 'line', source: 'prefectures',
      paint: { 'line-color': '#244b3d', 'line-width': ['interpolate',['linear'],['zoom'],3,0.8,8,2.6,11,3.3], 'line-opacity': 0.96 } });
    map.addLayer({ id: 'municipality-fill', type: 'fill', source: 'municipalities',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['match', ['get','status'], 'visited','#19865b', 'passed','#f09740', '#f4f8f5'],
        'fill-opacity': ['match', ['get','status'], 'visited',0.70, 'passed',0.77, 0.13]
      }
    });
    map.addLayer({ id: 'municipality-line', type: 'line', source: 'municipalities',
      layout: { visibility: 'none' },
      paint: {
        'line-color': ['match',['get','status'],'visited','#235743','passed','#9c4811','#53685b'],
        'line-width': ['interpolate',['linear'],['zoom'],4,0.25,8,0.8,12,1.2],
        'line-opacity': 0.87
      }
    });
    map.addLayer({ id: 'municipality-labels', type: 'symbol', source: 'municipality-labels',
      minzoom: 6,
      layout: { visibility: 'none', 'text-field': ['get','name'], 'text-font': ['Open Sans Regular'],
        'text-size': ['interpolate',['linear'],['zoom'],6,9,9,12,12,16],
        'text-max-width': 8, 'text-padding': 2, 'text-allow-overlap': false, 'text-ignore-placement': false },
      paint: { 'text-color': '#152d24', 'text-halo-color': 'rgba(255,255,255,.96)', 'text-halo-width': 1.4 }
    });
  }

  function setPrefectureBorderFilter() {
    const filter = selectedPrefecture ? ['==',['get','pref'], selectedPrefecture] : null;
    for (const id of ['prefecture-fill', 'prefecture-line']) {
      if (map.getLayer(id)) map.setFilter(id, filter);
    }
  }

  function buildMunicipalityPopup(props) {
    const area = document.createElement('div');
    area.className = 'popup-body';
    const title = document.createElement('strong');
    title.textContent = String(props.name || '自治体');
    const sub = document.createElement('span');
    const label = { visited:'訪問', passed:'通過', unvisited:'未踏' }[logic.normalizeStatus(props.status)];
    sub.textContent = `${props.pref || ''} · ${label}`;
    const note = document.createElement('small');
    note.textContent = '試作版は閲覧専用です。記録の変更は元のアプリで行ってください。';
    area.append(title, sub, note);
    return area;
  }

  function setupInteractions() {
    map.on('click', 'prefecture-fill', event => {
      if (selectedPrefecture) return;
      const pref = event.features?.[0]?.properties?.pref;
      if (pref) void choosePrefecture(pref);
    });
    map.on('click', 'municipality-fill', event => {
      const props = event.features?.[0]?.properties;
      if (!props || !selectedPrefecture) return;
      new maplibregl.Popup({ closeButton: true, maxWidth: '275px' })
        .setLngLat(event.lngLat).setDOMContent(buildMunicipalityPopup(props)).addTo(map);
    });
    for (const name of ['prefecture-fill', 'municipality-fill']) {
      map.on('mouseenter', name, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', name, () => { map.getCanvas().style.cursor = ''; });
    }
  }

  function fit(bounds, maxZoom = 8) {
    if (!bounds) return;
    const [[west,south],[east,north]] = bounds;
    map.fitBounds([[west,south],[east,north]], {
      padding: window.innerWidth <= 700 ? 22 : 56,
      maxZoom,
      duration: reduceMotion ? 0 : 460,
      essential: !reduceMotion
    });
  }

  function populatePrefectures() {
    const select = $('prefectureSelect');
    select.replaceChildren(new Option('全国', ''));
    for (const region of logic.collectRegions(municipalities)) {
      const group = document.createElement('optgroup');
      group.label = region.name;
      for (const pref of region.prefectures) group.append(new Option(pref, pref));
      select.append(group);
    }
  }

  function refreshProgressColors() {
    if (!mapLoaded || !rawPrefectureData) return;
    // 自治体一覧が遅い場合でも、都道府県の輪郭だけは先に表示。
    prefectureData = municipalities.length
      ? logic.enrichPrefectureFeatures(rawPrefectureData, prefCounts())
      : logic.preparePrefectureOutlines(rawPrefectureData);
    map.getSource('prefectures').setData(prefectureData);
    if (selectedPrefecture && detailCache.has(selectedPrefecture)) displayCachedDetail(selectedPrefecture);
  }

  function displayCachedDetail(prefecture) {
    const cached = detailCache.get(prefecture);
    if (!cached || !mapLoaded) return;
    const prepared = logic.enrichMunicipalityFeatures(cached.raw, prefecture, municipalityIndex, records);
    const labels = cached.labels;
    map.getSource('municipalities').setData(prepared);
    map.getSource('municipality-labels').setData(labels);
    setMapLayerModes();
    $('mapMode').textContent = `${prefecture} · ${new Set(prepared.features.map(f=>f.properties.code)).size}自治体`;
    status('県内の市区町村を表示中です。地図をドラッグ、ホイール操作、または2本指で拡大・縮小できます。');
  }

  async function loadDetails(prefecture, token) {
    if (detailCache.has(prefecture)) {
      if (token === detailRequestToken && selectedPrefecture === prefecture) displayCachedDetail(prefecture);
      return;
    }
    const representative = municipalities.find(m => m.prefecture === prefecture);
    if (!representative) return;
    const prefCode = logic.normalizeMapCode(representative.code).slice(0,2);
    const controller = new AbortController();
    detailController = controller;
    try {
      const json = await fetchJSON(`${DETAIL_BASE_URL}${prefCode}.json`, { signal: controller.signal });
      // 最初の変換で選択県の図形と自治体コードの整合を確かめる。
      const prepared = logic.enrichMunicipalityFeatures(json, prefecture, municipalityIndex, records);
      const labels = logic.makeLabels(prepared.features);
      detailCache.delete(prefecture);
      detailCache.set(prefecture, { raw: json, labels });
      while (detailCache.size > 3) detailCache.delete(detailCache.keys().next().value);
      if (token !== detailRequestToken || selectedPrefecture !== prefecture) return;
      displayCachedDetail(prefecture);
    } catch (error) {
      if (controller.signal.aborted || token !== detailRequestToken) return;
      console.warn('詳細境界の読み込み失敗', error);
      status(`${prefecture}の詳細地図を読み込めませんでした。都道府県を選び直して再試行してください。`, true);
      $('mapMode').textContent = `${prefecture} · 読み込み失敗`;
    } finally {
      if (detailController === controller) detailController = null;
    }
  }

  async function choosePrefecture(prefecture) {
    if (!mapLoaded || !prefectureData) return;
    if (prefecture && !municipalities.some(m => m.prefecture === prefecture)) return;
    detailRequestToken++;
    detailController?.abort();
    detailController = null;
    selectedPrefecture = prefecture;
    $('prefectureSelect').value = prefecture;
    $('nationalButton').disabled = !prefecture;
    $('nationalLegend').hidden = Boolean(prefecture);
    $('statusLegend').hidden = !prefecture;
    $('modeTitle').textContent = prefecture ? `${prefecture}の市区町村` : '全国の都道府県';
    map.getSource('municipalities').setData(EMPTY);
    map.getSource('municipality-labels').setData(EMPTY);
    setPrefectureBorderFilter();
    setMapLayerModes();
    document.querySelector('.maplibregl-popup')?.remove();
    if (!prefecture) {
      $('mapMode').textContent = '全国 · 47都道府県';
      fit(NATION_BOUNDS, 5.4);
      status('都道府県をタップすると詳細な市区町村境界を読み込みます。');
      return;
    }
    const features = prefectureData.features.filter(f => f.properties.pref === prefecture);
    const bound = logic.getGeoJSONBounds(features);
    if (bound) fit([[bound[0],bound[1]],[bound[2],bound[3]]],8);
    $('mapMode').textContent = `${prefecture} · 詳細を読み込み中`;
    status('詳細な市区町村境界を読み込み中です。読み込み中も拡大・縮小や移動ができます。');
    // 地図の場所合わせは県の選択時に一度だけ。データ到着後に再度fitBoundsしない。
    void loadDetails(prefecture, detailRequestToken);
  }

  function setFullscreen(expanded) {
    fullscreen = expanded;
    $('mapPanel').classList.toggle('is-fullscreen', expanded);
    document.body.classList.toggle('map-fullscreen', expanded);
    $('fullscreenButton').textContent = expanded ? '閉じる' : '全画面';
    $('fullscreenButton').setAttribute('aria-pressed', String(expanded));
    // Safariなどでも表示サイズが落ち着いてからMapLibreへ通知する。
    requestAnimationFrame(() => requestAnimationFrame(() => map?.resize()));
  }

  async function loadMunicipalities() {
    if (dataState.municipalities === 'loading') return;
    dataState.municipalities = 'loading';
    dataErrors.municipalities = '';
    updateLoadingStatus();
    try {
      const list = await fetchJSON(DATA_URL);
      const parsed = logic.normalizeMunicipalityData(list);
      if (parsed.length < 1000) throw new Error('全国自治体一覧の件数が不足しています');
      municipalities = parsed;
      municipalityIndex = logic.createMunicipalityIndex(municipalities);
      populatePrefectures();
      records = readOnlyExistingRecords();
      $('dataCount').textContent = `${municipalities.length.toLocaleString('ja-JP')}自治体`;
      dataState.municipalities = 'ready';
      refreshProgressColors();
    } catch (error) {
      dataState.municipalities = 'error';
      dataErrors.municipalities = error.message || String(error);
      console.warn('自治体一覧の取得失敗', error);
      $('dataCount').textContent = '自治体一覧の取得に失敗';
    }
    updateLoadingStatus();
  }

  async function loadBorders() {
    if (dataState.borders === 'loading') return;
    dataState.borders = 'loading';
    dataErrors.borders = '';
    updateLoadingStatus();
    try {
      const geo = await fetchJSON(PREFECTURE_URL);
      // 自治体一覧が届く前でも輪郭を描けるよう独立して検証。
      logic.preparePrefectureOutlines(geo);
      rawPrefectureData = geo;
      dataState.borders = 'ready';
      refreshProgressColors();
      $('mapMode').textContent = '全国 · 都道府県境界';
    } catch (error) {
      dataState.borders = 'error';
      dataErrors.borders = error.message || String(error);
      console.warn('都道府県境界の取得失敗', error);
    }
    updateLoadingStatus();
  }

  function initializeData() {
    // 両方が完了するまで待たない。境界だけ取得できれば先に地図を表示。
    void loadMunicipalities();
    void loadBorders();
  }

  function retryData() {
    if (dataState.municipalities === 'error') void loadMunicipalities();
    if (dataState.borders === 'error') void loadBorders();
  }

  async function handleRecordFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (!municipalities.length) throw new Error('先に全国自治体一覧を読み込んでください');
      const parsed = JSON.parse(await file.text());
      const allowed = new Set(municipalities.map(m => m.code));
      const result = logic.parseRecordBackup(parsed, allowed);
      if (!result.count) throw new Error('照合できる訪問記録がありません');
      records = result.records; // メモリのみに設定。元アプリのlocalStorageには保存しない。
      refreshProgressColors();
      recordSource(`選択したJSONを読み取り専用で表示：${result.count}件${result.ignored ? `（対象外${result.ignored}件は表示なし）` : ''}`);
      status('JSONから色分けを更新しました。元のアプリの記録は変更していません。');
    } catch (error) {
      status(`JSONを表示できません：${error.message}`, true);
    } finally {
      event.target.value = '';
    }
  }

  function setupButtons() {
    $('prefectureSelect').addEventListener('change', e => { void choosePrefecture(e.target.value); });
    $('nationalButton').addEventListener('click', () => { void choosePrefecture(''); });
    $('fullscreenButton').addEventListener('click', () => setFullscreen(!fullscreen));
    $('labelsToggle').addEventListener('change', () => {
      showLayer('municipality-labels', Boolean(selectedPrefecture && detailCache.has(selectedPrefecture) && $('labelsToggle').checked));
    });
    $('oceanToggle').addEventListener('change', updateBackground);
    $('retryButton').addEventListener('click', retryData);
    $('recordFile').addEventListener('change', handleRecordFile);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && fullscreen) setFullscreen(false);
    });
  }

  function initializeMap() {
    if (!window.maplibregl) {
      mapBootError = 'MapLibreを読み込めませんでした。ネット接続と広告ブロックなどの設定を確認してください。';
      status(mapBootError, true);
      return;
    }
    if (!maplibregl.supported()) {
      mapBootError = 'このブラウザでは地図描画用のWebGLを利用できません。別のブラウザまたは端末でお試しください。';
      status(mapBootError, true);
      return;
    }
    try {
      map = new maplibregl.Map({
        container: 'map', style: makeStyle(), center: [138, 36], zoom: 4.5,
        minZoom: 3, maxZoom: 12,
        bearing: 0, pitch: 0, dragRotate: false, touchPitch: false,
        renderWorldCopies: false, attributionControl: true,
        localIdeographFontFamily: 'sans-serif',
        fadeDuration: 80
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('load', () => {
        makeMapLayers();
        setupInteractions();
        mapLoaded = true;
        fit(NATION_BOUNDS, 5.4);
        refreshProgressColors();
        updateBackground();
        updateLoadingStatus();
      });
      map.on('error', event => {
        console.warn('地図描画・タイル取得:', event.error || event);
        if (!mapLoaded) {
          mapBootError = '地図を準備できませんでした。ブラウザでWebGLが使用できるかご確認ください。';
          status(mapBootError, true);
        }
      });
      setTimeout(() => {
        if (!mapLoaded) {
          mapBootError = '地図エンジンの起動に時間がかかっています。ブラウザを再読み込みしてください。';
          status(mapBootError, true);
        }
      }, 15000);
    } catch (error) {
      mapBootError = `地図を開始できませんでした：${error.message || String(error)}`;
      accessibleError(error);
    }
  }

  setupButtons();
  initializeMap();
  initializeData();
})();
