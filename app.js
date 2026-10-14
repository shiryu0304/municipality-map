/*
 * 全国市町村制覇 v0.5
 * この試作品はサンプル自治体のみを収録しています。
 * 本格運用前に data/municipalities.json を全国の自治体データに置き換えてください。
 */
const SAMPLE_MUNICIPALITIES = [
  { code: "131016", prefecture: "東京都", name: "千代田区", type: "特別区" },
  { code: "131041", prefecture: "東京都", name: "新宿区", type: "特別区" },
  { code: "271004", prefecture: "大阪府", name: "大阪市", type: "市" },
  { code: "272117", prefecture: "大阪府", name: "茨木市", type: "市" },
  { code: "272132", prefecture: "大阪府", name: "八尾市", type: "市" },
  { code: "282014", prefecture: "兵庫県", name: "姫路市", type: "市" },
  { code: "312011", prefecture: "鳥取県", name: "鳥取市", type: "市" },
  { code: "312029", prefecture: "鳥取県", name: "米子市", type: "市" },
  { code: "332038", prefecture: "岡山県", name: "津山市", type: "市" },
  { code: "401005", prefecture: "福岡県", name: "北九州市", type: "市" }
];

const STORAGE_KEY = "municipality-conquest-records-v1";
// 直前のJSONインポート前の記録。通常の訪問記録とは別の保存場所に置く。
const BEFORE_IMPORT_KEY = "municipality-conquest-before-import-v1";
let municipalities = [...SAMPLE_MUNICIPALITIES];
let municipalitiesReady = false;
let records = loadRecords();
let toastTimer;
let map;
let municipalityGeoLayer;
const municipalityByMapCode = new Map();

const $ = (id) => document.getElementById(id);
const prefectureFilter = $("prefectureFilter");
const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const municipalityList = $("municipalityList");
const dialog = $("recordDialog");

function setImportAvailability(ready, message) {
  municipalitiesReady = ready;
  $("importInput").disabled = !ready;
  $("importLabel").setAttribute("aria-disabled", String(!ready));
  $("importStatus").textContent = message;
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("保存データを読み込めませんでした。", error);
    return {};
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    $("saveStatus").textContent = `この端末に保存済み · 最終保存 ${new Date().toLocaleString("ja-JP")}`;
    return true;
  } catch (error) {
    console.error("訪問記録を保存できませんでした。", error);
    $("saveStatus").textContent = "保存できませんでした。JSONバックアップをお試しください。";
    showToast("保存に失敗しました。");
    return false;
  }
}

// 保存された元データを文字列のまま保管することで、一覧外の自治体や未知の項目も残す。
function getBeforeImportBackup() {
  try {
    const raw = localStorage.getItem(BEFORE_IMPORT_KEY);
    if (!raw) return null;
    const backup = JSON.parse(raw);
    if (backup?.version !== 1 || typeof backup.savedAt !== "string" || typeof backup.recordsRaw !== "string") return null;
    const restored = JSON.parse(backup.recordsRaw);
    if (!restored || typeof restored !== "object" || Array.isArray(restored)) return null;
    return { savedAt: backup.savedAt, records: restored, recordsRaw: backup.recordsRaw };
  } catch (error) {
    console.warn("読み込み前のバックアップを確認できませんでした。", error);
    return null;
  }
}

function updateRestoreAvailability() {
  const backup = getBeforeImportBackup();
  $("restoreBeforeImportButton").disabled = !backup;
  $("restoreBeforeImportStatus").textContent = backup
    ? `読み込み前の記録を保存済み：${new Date(backup.savedAt).toLocaleString("ja-JP")}（${Object.keys(backup.records).length}件）。次の読み込みで更新されます。`
    : "復元できる読み込み前の記録は、まだありません。";
}

// これに失敗した場合は、JSONの読み込みによる上書き自体を行わない。
function saveBeforeImportBackup() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(records);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("現在の保存データを確認できませんでした");
  }
  localStorage.setItem(BEFORE_IMPORT_KEY, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    recordsRaw: raw
  }));
  updateRestoreAvailability();
}

function getRecord(code) {
  return records[code] || { status: "unvisited", date: "", memo: "" };
}

function getStatusLabel(status) {
  return ({ visited: "訪問済み", want: "行きたい", unvisited: "未訪問" })[status] || "未訪問";
}

function getFilteredMunicipalities() {
  const pref = prefectureFilter.value;
  const query = searchInput.value.trim().toLocaleLowerCase("ja");
  const status = statusFilter.value;

  return municipalities.filter((m) => {
    const record = getRecord(m.code);
    const matchesPref = !pref || m.prefecture === pref;
    const matchesQuery = !query || `${m.name} ${m.prefecture} ${m.code}`.toLocaleLowerCase("ja").includes(query);
    const matchesStatus = status === "all" || record.status === status;
    return matchesPref && matchesQuery && matchesStatus;
  });
}

function renderStats() {
  const total = municipalities.length;
  const visited = municipalities.filter((m) => getRecord(m.code).status === "visited").length;
  const want = municipalities.filter((m) => getRecord(m.code).status === "want").length;
  const unvisited = total - visited - want;
  const percent = total ? visited / total * 100 : 0;

  $("overallPercent").textContent = `${percent.toFixed(1)}%`;
  $("overallBar").style.width = `${percent}%`;
  $("overallCount").textContent = `${visited} / ${total} 自治体`;
  $("visitedCount").textContent = visited;
  $("wantCount").textContent = want;
  $("unvisitedCount").textContent = unvisited;
}

function renderList() {
  const list = getFilteredMunicipalities();
  municipalityList.replaceChildren();
  $("resultSummary").textContent = `${list.length} 件を表示中`;

  list.forEach((m) => {
    const record = getRecord(m.code);
    const card = document.createElement("article");
    card.className = "municipality-card";

    const info = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = m.name;
    const subtitle = document.createElement("p");
    subtitle.textContent = `${m.prefecture} · ${m.type} · コード ${m.code}`;
    info.append(title, subtitle);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const pill = document.createElement("span");
    pill.className = `status-pill status-${record.status}`;
    pill.textContent = getStatusLabel(record.status);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary";
    button.textContent = "編集";
    button.addEventListener("click", () => openRecordDialog(m));
    actions.append(pill, button);
    card.append(info, actions);
    municipalityList.append(card);
  });

  $("emptyState").hidden = list.length !== 0;
}

function renderPrefectureProgress() {
  const host = $("prefectureProgressList");
  if (!host) return;
  host.replaceChildren();
  const prefectures = [...new Set(municipalities.map(m => m.prefecture))]
    .sort((a, b) => a.localeCompare(b, "ja"));
  $("prefectureProgressBadge").textContent = `${prefectures.length}都道府県`;

  prefectures.forEach(prefecture => {
    const items = municipalities.filter(m => m.prefecture === prefecture);
    const visited = items.filter(m => getRecord(m.code).status === "visited").length;
    const percent = items.length ? visited / items.length * 100 : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `prefecture-progress-item${prefectureFilter.value === prefecture ? " is-active" : ""}`;
    button.setAttribute("aria-label", `${prefecture}、${visited} / ${items.length}自治体、制覇率${percent.toFixed(1)}パーセント。一覧をこの都道府県に絞り込む`);

    const top = document.createElement("span");
    top.className = "prefecture-progress-top";
    const name = document.createElement("strong");
    name.textContent = prefecture;
    const count = document.createElement("span");
    count.textContent = `${visited} / ${items.length}`;
    top.append(name, count);

    const track = document.createElement("span");
    track.className = "prefecture-progress-track";
    const fill = document.createElement("span");
    fill.className = "prefecture-progress-fill";
    fill.style.width = `${percent}%`;
    track.append(fill);

    const bottom = document.createElement("span");
    bottom.className = "prefecture-progress-bottom";
    bottom.textContent = `${percent.toFixed(1)}% 制覇`;
    button.append(top, track, bottom);
    button.addEventListener("click", () => {
      prefectureFilter.value = prefectureFilter.value === prefecture ? "" : prefecture;
      renderAll();
      $("municipalityList").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    host.append(button);
  });
}

function renderAll() {
  renderStats();
  renderPrefectureProgress();
  renderList();
  refreshMapStyles();
}

function populatePrefectures() {
  const prefectures = [...new Set(municipalities.map((m) => m.prefecture))].sort((a, b) => a.localeCompare(b, "ja"));
  prefectures.forEach((pref) => {
    const option = document.createElement("option");
    option.value = pref;
    option.textContent = pref;
    prefectureFilter.append(option);
  });
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function openRecordDialog(municipality) {
  const record = getRecord(municipality.code);
  $("recordCode").value = municipality.code;
  $("dialogTitle").textContent = `${municipality.name}の記録`;
  $("recordStatus").value = record.status;
  $("recordDate").value = record.date || (record.status === "visited" ? getLocalDateString() : "");
  $("recordMemo").value = record.memo || "";
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
}

$("recordForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = $("recordCode").value;
  const status = $("recordStatus").value;
  const previousRecord = records[code];
  records[code] = {
    status,
    date: status === "visited" ? $("recordDate").value : "",
    memo: $("recordMemo").value.trim()
  };
  if (!saveRecords()) {
    if (previousRecord === undefined) delete records[code];
    else records[code] = previousRecord;
    return;
  }
  closeDialog();
  renderAll();
  showToast("訪問記録を保存しました。");
});

$("closeDialog").addEventListener("click", closeDialog);
$("cancelDialog").addEventListener("click", closeDialog);
prefectureFilter.addEventListener("change", renderAll);
searchInput.addEventListener("input", renderList);
statusFilter.addEventListener("change", renderList);

$("exportButton").addEventListener("click", () => {
  const backup = {
    app: "municipality-conquest",
    version: 1,
    exportedAt: new Date().toISOString(),
    records
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `municipality-conquest-backup-${getLocalDateString()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("バックアップを書き出しました。");
});

$("importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    // サンプル一覧で記録を絞り込むと、一覧外の記録が失われるため取り込まない。
    if (!municipalitiesReady) {
      alert("全国の自治体一覧を正常に読み込めていないため、バックアップは読み込めません。通信状態を確認して、ページを再読み込みしてください。現在の記録は変更していません。");
      return;
    }
    const parsed = JSON.parse(await file.text());
    const imported = parsed.records && typeof parsed.records === "object" ? parsed.records : parsed;
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
      throw new Error("形式が正しくありません");
    }
    const allowed = new Set(municipalities.map((m) => m.code));
    const cleaned = {};
    for (const [code, value] of Object.entries(imported)) {
      if (allowed.has(code) && value && ["visited", "want", "unvisited"].includes(value.status)) {
        cleaned[code] = {
          status: value.status,
          date: typeof value.date === "string" ? value.date : "",
          memo: typeof value.memo === "string" ? value.memo.slice(0, 5000) : ""
        };
      }
    }
    // 不正なデータや現在の自治体一覧と一致しない記録がある場合、
    // その記録を黙って削除しないため、インポートを中止する。
    const importedCount = Object.keys(cleaned).length;
    const sourceCount = Object.keys(imported).length;
    if (importedCount === 0) {
      alert("読み込める訪問記録が0件でした。現在の記録を守るため、読み込みを中止しました。JSONファイルをご確認ください。");
      return;
    }
    if (importedCount !== sourceCount) {
      alert(`バックアップ内の ${sourceCount} 件のうち、${sourceCount - importedCount} 件が読み込めません。記録の消失を防ぐため、読み込みを中止しました。現在の記録は変更していません。`);
      return;
    }
    if (!confirm(`${importedCount} 件の記録を読み込みます。現在の記録 ${Object.keys(records).length} 件は読み込んだ内容で置き換わります。読み込み前の記録を自動保存しますが、念のためJSONも書き出しましたか？`)) return;
    // 元データの退避に失敗した場合は、上書きを絶対に始めない。
    try {
      saveBeforeImportBackup();
    } catch (error) {
      console.error("読み込み前のバックアップ作成に失敗しました。", error);
      alert("読み込み前の記録を自動保存できなかったため、JSONの読み込みを中止しました。現在の記録は変更していません。ブラウザの保存容量や設定を確認してください。");
      return;
    }
    const previousRecords = records;
    records = cleaned;
    if (!saveRecords()) {
      records = previousRecords;
      alert("新しい記録を保存できなかったため、読み込みを中止しました。現在の記録は変更していません。");
      return;
    }
    renderAll();
    showToast("バックアップを読み込みました。読み込み前の記録も保存しました。");
  } catch (error) {
    alert("ファイルを読み込めませんでした。アプリのJSONバックアップを選んでください。");
  } finally {
    event.target.value = "";
  }
});

$("restoreBeforeImportButton").addEventListener("click", () => {
  const backup = getBeforeImportBackup();
  if (!backup) {
    updateRestoreAvailability();
    alert("復元できる読み込み前の記録がありません。");
    return;
  }
  const count = Object.keys(backup.records).length;
  if (!confirm(`読み込み前の記録 ${count} 件に戻します。現在の記録 ${Object.keys(records).length} 件は置き換えられ、読み込み後に追加・変更した記録も失われます。現在の記録をJSONに書き出しましたか？`)) return;
  const previousRecords = records;
  records = backup.records;
  if (!saveRecords()) {
    records = previousRecords;
    alert("復元した記録を保存できませんでした。現在の記録は変更していません。");
    return;
  }
  renderAll();
  showToast("読み込み前の記録に戻しました。");
});

$("resetButton").addEventListener("click", () => {
  if (!confirm("このブラウザに保存されている訪問記録をすべて削除します。事前にバックアップしましたか？")) return;
  const previousRecords = records;
  records = {};
  if (!saveRecords()) {
    records = previousRecords;
    return;
  }
  renderAll();
  showToast("記録をリセットしました。");
});

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

const DATA_URL = "https://code4fukui.github.io/localgovjp/localgovjp.json";

function normalizeMunicipalityData(data) {
  if (!Array.isArray(data)) throw new Error("データ形式が配列ではありません");
  const seen = new Set();
  return data.map((item) => {
    const name = String(item.city || item.name || "").trim();
    const prefecture = String(item.pref || item.prefecture || "").trim();
    const code = String(item.lgcode || item.code || item.cid || "").trim();
    if (!name || !prefecture || !code) return null;
    // 市・町・村に加え、東京都の特別区23区を対象に含める。
    // 政令指定都市の行政区（例：大阪市北区）は対象外。
    const isTokyoSpecialWard = prefecture === "東京都" && name.endsWith("区");
    if (!isTokyoSpecialWard && !/(市|町|村)$/.test(name)) return null;
    const type = isTokyoSpecialWard ? "特別区" : name.endsWith("市") ? "市" : name.endsWith("町") ? "町" : "村";
    return { code, prefecture, name, type };
  }).filter((m) => {
    if (!m || seen.has(m.code)) return false;
    seen.add(m.code);
    return true;
  }).sort((a, b) => a.prefecture.localeCompare(b.prefecture, "ja") || a.name.localeCompare(b.name, "ja"));
}


// 全国の概観は従来の軽量データを利用する。訪問記録とは独立した表示用データ。
const MAP_DATA_URL = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/N03-21_210101_designated_city.json";
// 拡大表示では2026年行政区域データの県別5%簡略化版を取得する。
// 0.1%の全国用データより詳細だが、測量データそのものではない。
const DETAIL_MAP_BASE_URL = "https://raw.githubusercontent.com/ricewin/simplify-japan-geojson/main/GeoJson/";
const detailedMapLayers = new Map(); // 県名 -> { layer, codes }
const detailedMapRequests = new Set();
const failedDetailedPrefectures = new Set();
const municipalityCodesHiddenByDetail = new Set();
const prefectureGeoBounds = new Map(); // 県名 -> [南端, 西端, 北端, 東端]
let detailedMapUpdateTimer;
let mapGeoJSON = null;
const mapPrefectureFilter = $("mapPrefectureFilter");

function normalizeMapCode(value) {
  return String(value || "").trim().replace(/\D/g, "").slice(0, 5).padStart(5, "0");
}

function findMunicipalityForFeature(feature) {
  const props = feature?.properties || {};
  const code = normalizeMapCode(props.N03_007);
  const byCode = municipalityByMapCode.get(code);
  if (byCode) return byCode;
  // Code format differs between some public datasets; use prefecture/name as fallback.
  const pref = String(props.N03_001 || "").trim();
  const names = [props.N03_004, props.N03_003].map(v => String(v || "").trim()).filter(Boolean);
  return municipalities.find(m => m.prefecture === pref && names.includes(m.name)) || null;
}

// 地形と自治体境界を同時に見られるよう、未訪問地域は薄い透明色にする。
function getMapStatusColor(feature) {
  const municipality = findMunicipalityForFeature(feature);
  if (!municipality) return { color: "#667b6d", weight: 0.55, fillColor: "#f2f5ec", fillOpacity: 0.06 };
  const status = getRecord(municipality.code).status;
  if (status === "visited") return { color: "#235743", weight: 0.65, fillColor: "#19865b", fillOpacity: 0.64 };
  if (status === "want") return { color: "#866321", weight: 0.65, fillColor: "#f0b94e", fillOpacity: 0.63 };
  return { color: "#53685b", weight: 0.55, fillColor: "#ffffff", fillOpacity: 0.05 };
}

// 詳細図で置き換わっている市区町村の全国版だけを非表示にする。
// 対応していない小島・自治体は従来の地図に残す。
function getCoarseMapStatusColor(feature) {
  const municipality = findMunicipalityForFeature(feature);
  const style = getMapStatusColor(feature);
  if (municipality && municipalityCodesHiddenByDetail.has(municipality.code)) {
    return { ...style, color: "transparent", weight: 0, opacity: 0, fillOpacity: 0 };
  }
  return style;
}

function refreshMapStyles() {
  if (municipalityGeoLayer) municipalityGeoLayer.setStyle(getCoarseMapStatusColor);
  for (const entry of detailedMapLayers.values()) entry.layer.setStyle(getMapStatusColor);
}

function populateMapPrefectures() {
  const prefectures = [...new Set(municipalities.map(m => m.prefecture))].sort((a, b) => a.localeCompare(b, "ja"));
  mapPrefectureFilter.replaceChildren(new Option("全国", ""));
  prefectures.forEach(pref => mapPrefectureFilter.add(new Option(pref, pref)));
}

// 一度だけ全国の境界データから都道府県ごとの大まかな範囲を計算する。
// 詳細データを読み込む地域を判定するためだけに使い、境界の形状は変更しない。
function indexPrefectureBounds() {
  prefectureGeoBounds.clear();
  function extend(coords, bbox) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lon, lat] = coords;
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        bbox[0] = Math.min(bbox[0], lat);
        bbox[1] = Math.min(bbox[1], lon);
        bbox[2] = Math.max(bbox[2], lat);
        bbox[3] = Math.max(bbox[3], lon);
      }
    } else {
      coords.forEach(part => extend(part, bbox));
    }
  }
  for (const feature of mapGeoJSON?.features || []) {
    const prefecture = String(feature?.properties?.N03_001 || "").trim();
    if (!prefecture || !feature.geometry?.coordinates) continue;
    const bbox = prefectureGeoBounds.get(prefecture) || [Infinity, Infinity, -Infinity, -Infinity];
    extend(feature.geometry.coordinates, bbox);
    prefectureGeoBounds.set(prefecture, bbox);
  }
}

function getDetailedMapTargets() {
  const selectedPrefecture = mapPrefectureFilter.value;
  if (selectedPrefecture) return [selectedPrefecture];
  if (!map || typeof map.getZoom !== "function" || map.getZoom() < 8 ||
      typeof map.getBounds !== "function") return [];
  const view = map.getBounds();
  const center = map.getCenter();
  const matches = [];
  for (const [prefecture, b] of prefectureGeoBounds) {
    if (b.every(Number.isFinite) && view.intersects(L.latLngBounds([[b[0], b[1]], [b[2], b[3]]]))) {
      // 県境付近で同時に大量ロードしないよう中心に近い2県までに限定。
      const distance = Math.abs(center.lat - Math.max(b[0], Math.min(center.lat, b[2]))) +
        Math.abs(center.lng - Math.max(b[1], Math.min(center.lng, b[3])));
      matches.push({ prefecture, distance });
    }
  }
  return matches.sort((a, b) => a.distance - b.distance).slice(0, 2).map(item => item.prefecture);
}

function updateDetailedMapStatus() {
  const host = $("mapDetailStatus");
  if (!host) return;
  const activeCount = detailedMapLayers.size;
  if (detailedMapRequests.size) {
    host.textContent = "詳細な市区町村境界を読み込み中です…";
  } else if (activeCount) {
    host.textContent = "詳細境界を表示中（2026年行政区域データ・県別5％簡略化版）。";
  } else if (getDetailedMapTargets().some(pref => failedDetailedPrefectures.has(pref))) {
    host.textContent = "詳細境界の取得に失敗したため、従来の境界を表示しています。";
  } else {
    host.textContent = "地図を拡大するか都道府県を選ぶと、より詳細な境界を読み込みます。";
  }
}

function refreshDetailVisibility() {
  municipalityCodesHiddenByDetail.clear();
  for (const entry of detailedMapLayers.values()) {
    for (const code of entry.codes) municipalityCodesHiddenByDetail.add(code);
  }
  refreshMapStyles();
  updateDetailedMapStatus();
}

function bindMunicipalityPopup(feature, layer) {
  const municipality = findMunicipalityForFeature(feature);
  if (!municipality) return;
  const record = getRecord(municipality.code);
  layer.bindPopup(`<div class="map-popup-title">${escapeHtml(municipality.name)}</div><div class="map-popup-status">${escapeHtml(municipality.prefecture)} · ${escapeHtml(getStatusLabel(record.status))}</div><button class="map-popup-button" type="button" data-map-code="${escapeHtml(municipality.code)}">記録を編集</button>`);
  layer.on("popupopen", event => {
    const button = event.popup.getElement()?.querySelector("[data-map-code]");
    if (button) button.addEventListener("click", () => openRecordDialog(municipality), { once: true });
  });
  layer.bindTooltip(`${municipality.prefecture} ${municipality.name}`, { sticky: true, direction: "top" });
}

async function refreshDetailedBoundaries() {
  if (!mapGeoJSON || !map) return;
  const targets = new Set(getDetailedMapTargets());
  for (const [prefecture, entry] of detailedMapLayers) {
    if (!targets.has(prefecture)) {
      map.removeLayer(entry.layer);
      detailedMapLayers.delete(prefecture);
    }
  }
  refreshDetailVisibility();

  for (const prefecture of targets) {
    if (detailedMapLayers.has(prefecture) || detailedMapRequests.has(prefecture) ||
        failedDetailedPrefectures.has(prefecture)) continue;
    const municipality = municipalities.find(m => m.prefecture === prefecture);
    if (!municipality) continue;
    const prefCode = normalizeMapCode(municipality.code).slice(0, 2);
    detailedMapRequests.add(prefecture);
    updateDetailedMapStatus();
    try {
      const response = await fetch(`${DETAIL_MAP_BASE_URL}${prefCode}.json`);
      if (!response.ok) throw new Error(`詳細境界 HTTP ${response.status}`);
      const data = await response.json();
      if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
        throw new Error("詳細境界の形式が不正です");
      }
      const features = data.features.filter(feature => {
        const m = findMunicipalityForFeature(feature);
        return m && m.prefecture === prefecture && feature.geometry;
      });
      const codes = new Set(features.map(feature => findMunicipalityForFeature(feature).code));
      if (!codes.size) throw new Error("自治体一覧と詳細境界を照合できません");
      // 通信中に地域を変更した場合は、古い地域の地図を後から追加しない。
      if (!getDetailedMapTargets().includes(prefecture)) continue;
      const layer = L.geoJSON({ type: "FeatureCollection", features }, {
        smoothFactor: 0.15,
        style: getMapStatusColor,
        onEachFeature: bindMunicipalityPopup
      }).addTo(map);
      detailedMapLayers.set(prefecture, { layer, codes });
      refreshDetailVisibility();
    } catch (error) {
      console.warn(`${prefecture}の詳細境界を読み込めませんでした。`, error);
      failedDetailedPrefectures.add(prefecture);
    } finally {
      detailedMapRequests.delete(prefecture);
      refreshDetailVisibility();
    }
  }
}

function scheduleDetailedBoundaries() {
  clearTimeout(detailedMapUpdateTimer);
  detailedMapUpdateTimer = setTimeout(() => { void refreshDetailedBoundaries(); }, 250);
}

function renderMapLayer(prefecture = "") {
  if (!mapGeoJSON || !map) return;
  const features = mapGeoJSON.features.filter(feature => {
    const municipality = findMunicipalityForFeature(feature);
    if (!municipality) return false;
    return !prefecture || municipality.prefecture === prefecture;
  });
  if (municipalityGeoLayer) map.removeLayer(municipalityGeoLayer);
  municipalityGeoLayer = L.geoJSON({ type: "FeatureCollection", features }, {
    // Leafletによる境界線の描画時の省略を減らす。元の行政区域データは変更しない。
    smoothFactor: 0.35,
    style: getCoarseMapStatusColor,
    onEachFeature: bindMunicipalityPopup
  }).addTo(map);
  const bounds = municipalityGeoLayer.getBounds();
  if (bounds.isValid()) {
    // Keep panning near Japan even when users zoom or drag the map.
    // Do not replace this with fixed coordinates: the bounds come from actual map data.
    if (!prefecture) {
      // 以前の表示範囲制限を解除してから、全国の境界を中央に配置する。
      map.setMaxBounds(null);
      // 上下左右に同じ余白を確保する。panByで強制的に下へずらさない。
      // 北海道から沖縄までの表示範囲は、実際の行政界データから自動計算する。
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 5 });
      // 現在の全国表示を含む範囲内でのみ地図を移動できるようにする。
      map.setMaxBounds(map.getBounds().pad(0.12));
    } else {
      // 都道府県表示はこれまでの拡大率を保ちつつ、適度な余白を確保する。
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
    }
  }
  const count = features.length;
  $("mapBadge").textContent = prefecture ? `${prefecture} · ${count.toLocaleString("ja-JP")} 区域` : `全国 · ${count.toLocaleString("ja-JP")} 区域`;
  $("mapBadge").style.color = "#12664f";
  $("mapBadge").style.background = "#dff4e9";
  void refreshDetailedBoundaries();
}

function initializeMap() {
  const mapElement = $("japanMap");
  if (!mapElement || !window.L) {
    $("mapBadge").textContent = "地図ライブラリを読み込めません";
    return;
  }
  // 日本国内の地形だけを提供する地理院タイルを使う。
  // OpenStreetMap等の世界地図は使わず、従来の日本付近への移動制限も保持する。
  map = L.map("japanMap", {
    scrollWheelZoom: true,
    preferCanvas: true,
    minZoom: 3,
    maxZoom: 12,
    maxBoundsViscosity: 1.0
  }).setView([36.2, 138.2], 5);

  // 南鳥島・沖ノ鳥島・与那国島などを含む、日本周辺のタイル取得範囲。
  // 実際の市区町村の表示範囲はGeoJSONで制限する。
  const terrainTileBounds = [[20, 122], [46, 154]];
  const gsiTileOptions = {
    bounds: terrainTileBounds,
    minZoom: 3,
    minNativeZoom: 5,
    maxZoom: 12,
    tileSize: 256,
    keepBuffer: 2
  };
  // 標高による色分け（山・平野）を表示する。
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/relief/{z}/{x}/{y}.png", {
    ...gsiTileOptions,
    zIndex: 1,
    className: "japan-relief-tiles",
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル（国土地理院）</a>'
  }).addTo(map);
  // 陰影によって山の起伏を表現する。白地は乗算合成で地形の色を維持。
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png", {
    ...gsiTileOptions,
    maxNativeZoom: 12,
    zIndex: 2,
    className: "japan-hillshade-tiles",
    opacity: 0.38
  }).addTo(map);
  // 市区町村名・行政界の文字を表示。道路や外国の地形は表示しない。
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", {
    ...gsiTileOptions,
    zIndex: 3,
    className: "japan-name-tiles",
    opacity: 0.88
  }).addTo(map);

  if (typeof map.on === "function") {
    map.on("moveend", scheduleDetailedBoundaries);
    map.on("zoomend", scheduleDetailedBoundaries);
  }
  mapPrefectureFilter.addEventListener("change", () => renderMapLayer(mapPrefectureFilter.value));
  $("resetMapView").addEventListener("click", () => {
    mapPrefectureFilter.value = "";
    renderMapLayer("");
  });

  fetch(MAP_DATA_URL)
    .then(response => {
      if (!response.ok) throw new Error(`地図データ HTTP ${response.status}`);
      return response.json();
    })
    .then(geojson => {
      if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
        throw new Error("地図データの形式が想定と異なります");
      }
      mapGeoJSON = geojson;
      indexPrefectureBounds();
      municipalityByMapCode.clear();
      municipalities.forEach(m => municipalityByMapCode.set(normalizeMapCode(m.code), m));
      populateMapPrefectures();
      renderMapLayer("");
      if (!municipalityGeoLayer || municipalityGeoLayer.getLayers().length === 0) {
        throw new Error("自治体一覧と地図の境界データを対応付けできませんでした");
      }
    })
    .catch(error => {
      console.warn("地図データを読み込めませんでした。", error);
      $("mapBadge").textContent = "地図データの読み込み失敗";
      $("mapBadge").style.color = "#9b3f36";
      $("mapBadge").style.background = "#fbe8e5";
      $("saveStatus").textContent = "自治体一覧は使えますが、地図データの読み込みに失敗しました。インターネット接続を確認してください。";
    });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function initialize() {
  updateRestoreAvailability();
  setImportAvailability(false, "全国の自治体一覧を確認中です。完了するまでバックアップは読み込めません。");
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const normalized = normalizeMunicipalityData(data);
    if (normalized.length < 1000) throw new Error(`自治体数が想定より少ない: ${normalized.length}`);
    municipalities = normalized;
    $("dataBadge").textContent = `全国データ ${municipalities.length.toLocaleString("ja-JP")} 件`;
    $("dataBadge").style.color = "#12664f";
    $("dataBadge").style.background = "#dff4e9";
    setImportAvailability(true, "全国の自治体一覧を読み込みました。バックアップを読み込めます。");
  } catch (error) {
    console.warn("全国データを読み込めませんでした。サンプルデータで起動します。", error);
    $("dataBadge").textContent = "サンプルデータ";
    $("saveStatus").textContent = "全国データの読み込みに失敗しました。インターネット接続を確認してください。";
    setImportAvailability(false, "全国の自治体一覧を読み込めないため、バックアップの読み込みを停止しています。通信状態を確認して、ページを再読み込みしてください。JSONの書き出しは利用できます。");
  }
  populatePrefectures();
  renderAll();
  initializeMap();
}

initialize();
