/*
 * MapLibre試作版のデータ処理。元アプリの自治体コード・保存形式と互換。
 * このファイルは localStorage の読み書きを行わない。
 */
(function (root) {
  'use strict';
  const REGIONS = [
    ['北海道', ['北海道']],
    ['東北', ['青森県','岩手県','宮城県','秋田県','山形県','福島県']],
    ['関東', ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県']],
    ['中部', ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県']],
    ['近畿', ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県']],
    ['中国', ['鳥取県','島根県','岡山県','広島県','山口県']],
    ['四国', ['徳島県','香川県','愛媛県','高知県']],
    ['九州・沖縄', ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']]
  ];

  function normalizeStatus(status) {
    return status === 'visited' || status === 'passed' ? status : 'unvisited';
  }

  function normalizeMapCode(value) {
    return String(value ?? '').trim().replace(/\D/g, '').slice(0, 5).padStart(5, '0');
  }

  function normalizeMunicipalityData(data) {
    if (!Array.isArray(data)) throw new Error('自治体一覧の形式が正しくありません');
    const seen = new Set();
    return data.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.city || item.name || '').trim();
      const prefecture = String(item.pref || item.prefecture || '').trim();
      const code = String(item.lgcode || item.code || item.cid || '').trim();
      if (!name || !prefecture || !code) return null;
      const tokyoWard = prefecture === '東京都' && name.endsWith('区');
      if (!tokyoWard && !/(市|町|村)$/.test(name)) return null;
      const type = tokyoWard ? '特別区' : name.endsWith('市') ? '市' : name.endsWith('町') ? '町' : '村';
      return { code, prefecture, name, type };
    }).filter(item => {
      if (!item || seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    }).sort((a, b) => a.prefecture.localeCompare(b.prefecture, 'ja') || a.name.localeCompare(b.name, 'ja'));
  }

  function createMunicipalityIndex(municipalities) {
    const byCode = new Map();
    const byName = new Map();
    for (const m of municipalities) {
      byCode.set(normalizeMapCode(m.code), m);
      byName.set(`${m.prefecture}\u0000${m.name}`, m);
    }
    return { byCode, byName };
  }

  function findMunicipality(feature, index) {
    const props = feature?.properties || {};
    const coded = index.byCode.get(normalizeMapCode(props.N03_007));
    if (coded) return coded;
    const pref = String(props.N03_001 || '').trim();
    for (const name of [props.N03_004, props.N03_003]) {
      const found = index.byName.get(`${pref}\u0000${String(name || '').trim()}`);
      if (found) return found;
    }
    return null;
  }

  function collectRegions(municipalities) {
    const available = new Set(municipalities.map(m => m.prefecture));
    const known = new Set(REGIONS.flatMap(region => region[1]));
    const regions = REGIONS.map(([name, prefs]) => ({ name, prefectures: prefs.filter(p => available.has(p)) }))
      .filter(region => region.prefectures.length);
    const others = [...available].filter(pref => !known.has(pref)).sort((a, b) => a.localeCompare(b, 'ja'));
    if (others.length) regions.push({ name: 'その他', prefectures: others });
    return regions;
  }

  function parseRecordBackup(parsed, allowedCodes) {
    const raw = parsed && Object.prototype.hasOwnProperty.call(parsed, 'records') ? parsed.records : parsed;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('訪問記録の形式が正しくありません');
    const records = {};
    let ignored = 0;
    for (const [code, item] of Object.entries(raw)) {
      if (!allowedCodes.has(code) || !item || typeof item !== 'object' || Array.isArray(item) ||
          !['visited','passed','unvisited','want'].includes(item.status)) {
        ignored++;
        continue;
      }
      records[code] = { status: normalizeStatus(item.status) };
    }
    return { records, count: Object.keys(records).length, ignored };
  }

  function prefectureProgress(municipalities, records) {
    const byPref = new Map();
    for (const m of municipalities) {
      const state = byPref.get(m.prefecture) || { visited: 0, total: 0, percent: 0 };
      state.total++;
      if (normalizeStatus(records[m.code]?.status) === 'visited') state.visited++;
      byPref.set(m.prefecture, state);
    }
    for (const counts of byPref.values()) counts.percent = counts.total ? counts.visited / counts.total * 100 : 0;
    return byPref;
  }

  function progressBand(percent) {
    if (percent === 0) return '#eef2ef';
    if (percent < 25) return '#c4e7d2';
    if (percent < 50) return '#87cfa8';
    if (percent < 75) return '#45ad7d';
    return '#19865b';
  }

  function preparePrefectureOutlines(data) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('都道府県境界データの形式が正しくありません');
    }
    const features = data.features.filter(f => f?.geometry && String(f.properties?.N03_001 || '').trim())
      .map(f => ({ ...f, properties: {
        ...f.properties, pref: String(f.properties.N03_001).trim(), fill: '#eef2ef'
      }}));
    if (!features.length) throw new Error('都道府県の境界が見つかりません');
    return { type: 'FeatureCollection', features };
  }

  function enrichPrefectureFeatures(data, progress) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('都道府県境界データの形式が正しくありません');
    }
    const features = data.features.filter(f => f?.geometry && progress.has(String(f.properties?.N03_001 || '').trim()))
      .map(f => {
        const pref = String(f.properties.N03_001).trim();
        const info = progress.get(pref);
        return { ...f, properties: { ...f.properties, pref, progress: info.percent, fill: progressBand(info.percent) } };
      });
    if (!features.length) throw new Error('都道府県境界が見つかりません');
    return { type: 'FeatureCollection', features };
  }

  function enrichMunicipalityFeatures(data, prefecture, index, records) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('市区町村境界データの形式が正しくありません');
    }
    const features = data.features.map(f => {
      const municipality = findMunicipality(f, index);
      if (!municipality || municipality.prefecture !== prefecture || !f.geometry) return null;
      return { ...f, properties: {
        ...f.properties, pref: municipality.prefecture, name: municipality.name,
        code: municipality.code, type: municipality.type, status: normalizeStatus(records[municipality.code]?.status)
      }};
    }).filter(Boolean);
    if (!features.length) throw new Error(`${prefecture}の境界と自治体一覧を対応付けられません`);
    return { type: 'FeatureCollection', features };
  }

  // 選択した県の外周を「市区町村と全く同じ座標」から求める。
  // 隣り合う自治体が共有する辺は2回登場するので除去し、外側の辺だけ残す。
  // 加工前の県内全フィーチャーを対象にし、訪問記録との対応有無で外周が欠けないようにする。
  // GeoJSONとして返す線は同じ座標をつなぎ直すだけで、補間・座標の丸めは行わない。
  function createDetailedPrefectureOutline(data, prefecture) {
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('県境を構成する市区町村境界データの形式が正しくありません');
    }
    const edges = new Map();
    const points = new Map();
    let polygonCount = 0;
    function vertexKey(point) { return `${point[0]},${point[1]}`; }
    function addEdge(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b) ||
          ![a[0], a[1], b[0], b[1]].every(Number.isFinite)) return;
      const ak = vertexKey(a), bk = vertexKey(b);
      if (ak === bk) return;
      points.set(ak, [a[0], a[1]]);
      points.set(bk, [b[0], b[1]]);
      const key = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
      // 偶数回現れる辺（県内の隣接境界）は県の外周ではない。
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, [ak, bk]);
    }
    function addPolygon(polygon) {
      if (!Array.isArray(polygon)) return;
      polygonCount++;
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        for (let i = 1; i < ring.length; i++) addEdge(ring[i - 1], ring[i]);
        addEdge(ring[ring.length - 1], ring[0]);
      }
    }
    for (const feature of data.features) {
      if (String(feature?.properties?.N03_001 || '').trim() !== prefecture) continue;
      const geometry = feature?.geometry;
      if (geometry?.type === 'Polygon') addPolygon(geometry.coordinates);
      if (geometry?.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates || []) addPolygon(polygon);
      }
    }
    if (!polygonCount || !edges.size) throw new Error(`${prefecture}の詳細な県境を作成できませんでした`);

    // 小さな辺を一続きの線にすることで、描画する地物の数を抑える。
    const segments = [...edges.values()];
    const connected = new Map();
    function connect(key, index) {
      if (!connected.has(key)) connected.set(key, []);
      connected.get(key).push(index);
    }
    segments.forEach(([a, b], i) => { connect(a, i); connect(b, i); });
    const used = new Uint8Array(segments.length);
    function trace(start) {
      const coordinates = [points.get(start)];
      let current = start;
      while (true) {
        const next = connected.get(current)?.find(i => !used[i]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segments[next];
        current = a === current ? b : a;
        coordinates.push(points.get(current));
        if (current === start || connected.get(current).length !== 2) break;
      }
      return coordinates;
    }
    const lines = [];
    for (const [key, attached] of connected) {
      if (attached.length === 2) continue;
      for (const i of attached) {
        if (!used[i]) lines.push(trace(key));
      }
    }
    for (let i = 0; i < segments.length; i++) {
      if (!used[i]) lines.push(trace(segments[i][0]));
    }
    return { type: 'FeatureCollection', features: lines.filter(line => line.length >= 2)
      .map(coordinates => ({ type: 'Feature', properties: { pref: prefecture },
        geometry: { type: 'LineString', coordinates } })) };
  }

  function getGeoJSONBounds(features) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity]; // west,south,east,north
    function traverse(coords) {
      if (!Array.isArray(coords)) return;
      if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
        bounds[0] = Math.min(bounds[0], coords[0]);
        bounds[1] = Math.min(bounds[1], coords[1]);
        bounds[2] = Math.max(bounds[2], coords[0]);
        bounds[3] = Math.max(bounds[3], coords[1]);
      } else for (const nested of coords) traverse(nested);
    }
    for (const feature of features) traverse(feature?.geometry?.coordinates);
    return bounds.every(Number.isFinite) ? bounds : null;
  }

  // 大きな島・飛び地を優先して地名の位置を一度だけ求める。描画中の再計算は行わない。
  function findLabelCenter(geometry) {
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] :
      geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    let best = null;
    for (const polygon of polygons) {
      const ring = polygon?.[0];
      if (!Array.isArray(ring) || ring.length < 4) continue;
      let twiceArea = 0, weightedX = 0, weightedY = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        if (![x1,y1,x2,y2].every(Number.isFinite)) continue;
        const cross = x1 * y2 - x2 * y1;
        twiceArea += cross;
        weightedX += (x1+x2)*cross;
        weightedY += (y1+y2)*cross;
      }
      const area = Math.abs(twiceArea) / 2;
      if (!area || (best && best.area >= area)) continue;
      let lon = weightedX / (3*twiceArea);
      let lat = weightedY / (3*twiceArea);
      // 凹形・湾曲した区域で代表点が区域外となった場合、中央付近を探す。
      function inside(x, y) {
        let result = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi,yi] = ring[i], [xj,yj] = ring[j];
          if ((yi > y) !== (yj > y) && x < (xj - xi)*(y - yi)/(yj - yi)+xi) result = !result;
        }
        return result;
      }
      if (!inside(lon, lat)) {
        let south = Infinity, north = -Infinity;
        for (const point of ring) {
          if (Number.isFinite(point?.[1])) {
            south = Math.min(south, point[1]);
            north = Math.max(north, point[1]);
          }
        }
        if (!Number.isFinite(south) || !Number.isFinite(north)) continue;
        for (const y of [0.5,0.35,0.65].map(ratio => south+(north-south)*ratio)) {
          const xs = [];
          for (let i = 0; i < ring.length - 1; i++) {
            const [ax,ay] = ring[i], [bx,by] = ring[i+1];
            if ((ay>y)!==(by>y)) xs.push(ax+(bx-ax)*(y-ay)/(by-ay));
          }
          xs.sort((a,b) => a-b);
          let widest = 0;
          for (let i=0; i+1<xs.length; i+=2) {
            if (xs[i+1]-xs[i]>widest) { widest=xs[i+1]-xs[i]; lon=(xs[i+1]+xs[i])/2; lat=y; }
          }
          if (widest) break;
        }
      }
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        for (const point of ring) {
          if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) continue;
          west = Math.min(west, point[0]); east = Math.max(east, point[0]);
          south = Math.min(south, point[1]); north = Math.max(north, point[1]);
        }
        best = { lon, lat, area, widthDegrees: east - west, heightDegrees: north - south };
      }
    }
    return best;
  }


  // 元アプリ同様、長細い自治体では縦に並べた地名を使う。
  // 描画中はこれを再計算しないので、滑らかなズーム・移動を妨げない。
  function getLabelLayout(item) {
    const nameLength = Math.max(1, [...String(item.name || '')].length);
    const lonPixelsAtZoom8 = 256 * 2 ** 8 / 360;
    const latitudeScale = 1 / Math.max(0.2, Math.cos(item.lat * Math.PI / 180));
    const horizontalPixels = Math.max(0, item.widthDegrees || 0) * lonPixelsAtZoom8 * 0.84;
    const verticalPixels = Math.max(0, item.heightDegrees || 0) * lonPixelsAtZoom8 * latitudeScale * 0.82;
    const horizontalFit = horizontalPixels / nameLength;
    const verticalFit = Math.min(horizontalPixels, verticalPixels / nameLength);
    const vertical = verticalFit > horizontalFit * 1.38 && verticalPixels > horizontalPixels * 1.5;
    const limit = item.type === '市' ? 16 : 13;
    // 地図をズームアウトした時も読める最小サイズを確保（重なりは許容）。
    const fontSizeAtZoom8 = Math.max(8, Math.min(limit, vertical ? verticalFit : horizontalFit));
    return { vertical, fontSizeAtZoom8 };
  }

  function makeLabels(features) {
    const byCode = new Map();
    for (const feature of features) {
      const center = findLabelCenter(feature.geometry);
      const code = feature.properties.code;
      if (!center) continue;
      const previous = byCode.get(code);
      if (!previous || center.area > previous.area) {
        byCode.set(code, { ...center, code, name: feature.properties.name,
          type: feature.properties.type || '市' });
      }
    }
    return { type:'FeatureCollection', features:[...byCode.values()].map(label => {
      const layout = getLabelLayout(label);
      return { type:'Feature', properties:{ name:label.name, code:label.code,
        displayName: layout.vertical ? [...label.name].join('\n') : label.name,
        vertical:layout.vertical, fontSizeAtZoom8:layout.fontSizeAtZoom8 },
        geometry:{ type:'Point', coordinates:[label.lon,label.lat] } };
    }) };
  }

  const exported = {
    normalizeStatus, normalizeMapCode, normalizeMunicipalityData, createMunicipalityIndex,
    findMunicipality, collectRegions, parseRecordBackup, prefectureProgress, progressBand,
    preparePrefectureOutlines, enrichPrefectureFeatures, enrichMunicipalityFeatures, createDetailedPrefectureOutline,
    getGeoJSONBounds, findLabelCenter, getLabelLayout, makeLabels
  };
  root.MapTrialLogic = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
