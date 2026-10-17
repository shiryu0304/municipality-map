/*
 * 全国市町村制覇 v0.5
 * 全国の自治体一覧は起動時に公開データから取得します。
 * 読み込み失敗時のみサンプル自治体を表示します。
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
// 境界データの自治体コードが異なる場合も、毎回全国一覧を走査しない。
const municipalityByPrefectureAndName = new Map();

const $ = (id) => document.getElementById(id);
const prefectureFilter = $("prefectureFilter");
const searchInput = $("searchInput");
const statusFilter = $("statusFilter");
const municipalityList = $("municipalityList");
const dialog = $("recordDialog");

// 旧「行きたい」は画面上で「未踏」として扱う。
// 起動時に localStorage を書き換えないため、旧記録はバックアップに残る。
function normalizeStatus(status) {
  if (status === "visited" || status === "passed" || status === "unvisited") return status;
  return "unvisited";
}

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
  const record = records[code];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { status: "unvisited", date: "", memo: "" };
  }
  // 表示用コピーだけ変換し、保存済みの元データは自動で変更しない。
  return { ...record, status: normalizeStatus(record.status) };
}

function getStatusLabel(status) {
  return ({ visited: "訪問", passed: "通過", unvisited: "未踏" })[normalizeStatus(status)];
}

function getFilteredMunicipalities() {
  const pref = prefectureFilter.value;
  const query = searchInput.value.trim().toLocaleLowerCase("ja");
  const status = statusFilter.value;

  return municipalities.filter((m) => {
    const record = getRecord(m.code);
    const matchesPref = !pref || m.prefecture === pref;
    const matchesQuery = !query || `${m.name} ${m.prefecture} ${m.code}`.toLocaleLowerCase("ja").includes(query);
    const matchesStatus = !status || status === "all" || record.status === status;
    return matchesPref && matchesQuery && matchesStatus;
  });
}

function renderStats() {
  const total = municipalities.length;
  const visited = municipalities.filter((m) => getRecord(m.code).status === "visited").length;
  const passed = municipalities.filter((m) => getRecord(m.code).status === "passed").length;
  const unvisited = total - visited - passed;
  const percent = total ? visited / total * 100 : 0;

  $("overallPercent").textContent = `${percent.toFixed(1)}%`;
  $("overallBar").style.width = `${percent}%`;
  $("overallCount").textContent = `訪問 ${visited} / ${total} 自治体`;
  $("visitedCount").textContent = visited;
  $("passedCount").textContent = passed;
  $("unvisitedCount").textContent = unvisited;
}

function renderList() {
  municipalityList.replaceChildren();

  // 初期表示では一覧を並べない。都道府県・名前検索・表示から条件を指定すると一覧を表示する。
  // 「表示を選択」は値が空なので初期状態では全国一覧を出さない。
  const hasSearchCondition = Boolean(prefectureFilter.value || searchInput.value.trim() || statusFilter.value);
  if (!hasSearchCondition) {
    $("resultSummary").textContent = "都道府県・市町村名・表示のいずれかを指定すると一覧を表示します。";
    $("emptyState").hidden = true;
    return;
  }

  const list = getFilteredMunicipalities();
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

// 北から南への八地方区分。県別の制覇率カードはこの順序で表示する。
// 地域区分は表示のためだけに使用し、自治体コードや記録の保存内容は変更しない。
const PREFECTURE_REGIONS = [
  { name: "北海道", prefectures: ["北海道"] },
  { name: "東北", prefectures: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { name: "関東", prefectures: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"] },
  { name: "中部", prefectures: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"] },
  { name: "近畿", prefectures: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"] },
  { name: "中国", prefectures: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"] },
  { name: "四国", prefectures: ["徳島県", "香川県", "愛媛県", "高知県"] },
  { name: "九州・沖縄", prefectures: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] }
];

function renderPrefectureProgress() {
  const host = $("prefectureProgressList");
  if (!host) return;
  host.replaceChildren();
  const itemsByPrefecture = new Map();
  for (const municipality of municipalities) {
    if (!itemsByPrefecture.has(municipality.prefecture)) itemsByPrefecture.set(municipality.prefecture, []);
    itemsByPrefecture.get(municipality.prefecture).push(municipality);
  }
  $("prefectureProgressBadge").textContent = `${itemsByPrefecture.size}都道府県`;

  // 将来、自治体一覧に未知の都道府県名が含まれても表示から除外しない。
  const known = new Set(PREFECTURE_REGIONS.flatMap(region => region.prefectures));
  const others = [...itemsByPrefecture.keys()].filter(name => !known.has(name)).sort((a, b) => a.localeCompare(b, "ja"));
  const regions = others.length ? [...PREFECTURE_REGIONS, { name: "その他", prefectures: others }] : PREFECTURE_REGIONS;
  for (const region of regions) {
    const present = region.prefectures.filter(name => itemsByPrefecture.has(name));
    if (!present.length) continue;
    const heading = document.createElement("h3");
    heading.className = "prefecture-region-heading";
    heading.textContent = region.name;
    host.append(heading);

    for (const prefecture of present) {
      const items = itemsByPrefecture.get(prefecture);
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
    }
  }
}

function renderAll() {
  renderStats();
  renderPrefectureProgress();
  renderList();
  refreshMapStyles();
}

function populatePrefectures() {
  // 制覇率カードと同じ地域区分・北から南への順番で並べる。
  // 最初の「すべての都道府県」はそのまま残し、地域名は選択できない見出しにする。
  const available = new Set(municipalities.map(m => m.prefecture));
  const known = new Set(PREFECTURE_REGIONS.flatMap(region => region.prefectures));
  const others = [...available].filter(name => !known.has(name)).sort((a, b) => a.localeCompare(b, "ja"));
  const regions = others.length ? [...PREFECTURE_REGIONS, { name: "その他", prefectures: others }] : PREFECTURE_REGIONS;

  for (const region of regions) {
    const present = region.prefectures.filter(name => available.has(name));
    if (!present.length) continue;
    const group = document.createElement("optgroup");
    group.label = region.name;
    for (const prefecture of present) {
      const option = document.createElement("option");
      option.value = prefecture;
      option.textContent = prefecture;
      group.append(option);
    }
    prefectureFilter.append(group);
  }
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
  const wasTravelled = record.status === "visited" || record.status === "passed";
  $("recordDate").value = record.date || (wasTravelled ? getLocalDateString() : "");
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
    date: status === "unvisited" ? "" : $("recordDate").value,
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
      if (allowed.has(code) && value && typeof value === "object" && !Array.isArray(value) &&
          ["visited", "passed", "unvisited", "want"].includes(value.status)) {
        cleaned[code] = {
          status: normalizeStatus(value.status),
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


// 全国表示には軽量な都道府県境界を使い、全国の市区町村境界は起動時に取得しない。
// 拡大表示では2026年行政区域データの県別5%簡略化版を取得する。
// 0.1%の全国用データより詳細だが、測量データそのものではない。
const DETAIL_MAP_BASE_URL = "https://raw.githubusercontent.com/ricewin/simplify-japan-geojson/main/GeoJson/";
// 全国の市町村境界と同じ元データによる県境（軽量な0.1%簡略化版）。
// 市町村境界を太くすると全線が濃くなるため、県境だけを独立して上に描く。
const PREFECTURE_BORDER_URL = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/prefectures.json";
let prefectureBorderGeoJSON = null;
let prefectureBorderLayer;
let prefectureOverviewLayer;
let prefecturePreviewLayer;
const detailedGeoCache = new Map(); // 直近3県の詳細データだけを再利用する。
const detailedLabelCache = new Map(); // 同じ県に戻ったとき地名位置を再計算しない。
let mapViewVersion = 0; // 通信中に県を切り替えた場合、古い結果を表示しない。

const detailedMapLayers = new Map(); // 県名 -> { layer, codes }
const detailedMapRequests = new Set();
const failedDetailedPrefectures = new Set();
const municipalityCodesHiddenByDetail = new Set();
const prefectureGeoBounds = new Map(); // 県名 -> [南端, 西端, 北端, 東端]
let coarseMunicipalityLabelPositions = new Map();
let municipalityNameLayer; // 地図の上に表示する市区町村名（記録データとは独立）
// 県の詳細図を切り替えた場合だけラベルを作り直す。移動・拡大縮小ではDOMを増減しない。
let renderedLabelPrefecture = "";
let renderedLabelSource = null;
const municipalityLabelMarkers = new Map(); // 県内の自治体名を1自治体1マーカーで保持
let detailedMapUpdateTimer;
let mapGeoJSON = null;
// 全国用の図形は一度だけ都道府県ごとに整理し、県を選ぶたびに全国を走査しない。
const mapFeaturesByPrefecture = new Map();
let nationwideMunicipalityFeatures = [];
const coarseLabelPositionsByPrefecture = new Map();
let mapFullscreen = false;
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
  for (const name of names) {
    const match = municipalityByPrefectureAndName.get(`${pref}\u0000${name}`);
    if (match) return match;
  }
  return null;
}

// 地形と自治体境界を同時に見られるよう、未踏地域は薄い透明色にする。
function getMapStatusColor(feature) {
  const municipality = findMunicipalityForFeature(feature);
  if (!municipality) return { color: "#667b6d", weight: 0.55, fillColor: "#f2f5ec", fillOpacity: 0.06 };
  const status = getRecord(municipality.code).status;
  if (status === "visited") return { color: "#235743", weight: 0.65, fillColor: "#19865b", fillOpacity: 0.64 };
  if (status === "passed") return { color: "#9c4811", weight: 0.8, fillColor: "#f09740", fillOpacity: 0.78 };
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

// GeoJSONのポリゴンから自治体名の表示位置を求める。
// 複数の島・分割領域がある場合は最も広い部分を代表位置にする。
function getMunicipalityLabelPosition(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] :
    geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  let best = null;
  for (const polygon of polygons) {
    const ring = polygon?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    let crossSum = 0, weightedLon = 0, weightedLat = 0;
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const [x1, y1] = a, [x2, y2] = b;
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      west = Math.min(west, x1, x2); east = Math.max(east, x1, x2);
      south = Math.min(south, y1, y2); north = Math.max(north, y1, y2);
      const cross = x1 * y2 - x2 * y1;
      crossSum += cross;
      weightedLon += (x1 + x2) * cross;
      weightedLat += (y1 + y2) * cross;
    }
    const area = Math.abs(crossSum) / 2;
    if (!(area > 0) || (best && best.area >= area)) continue;
    let lon = weightedLon / (3 * crossSum);
    let lat = weightedLat / (3 * crossSum);
    // 凹形の自治体では重心が区域外になることがあるので、区域内を走る水平線から補正する。
    function inside(x, y) {
      let isInside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) isInside = !isInside;
      }
      return isInside;
    }
    if (!inside(lon, lat)) {
      for (const candidateLat of [(south + north) / 2, south + (north - south) * 0.35,
        south + (north - south) * 0.65]) {
        const intersections = [];
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
          if ((y1 > candidateLat) !== (y2 > candidateLat)) {
            intersections.push(x1 + (x2 - x1) * (candidateLat - y1) / (y2 - y1));
          }
        }
        intersections.sort((a, b) => a - b);
        let widest = 0;
        for (let i = 0; i + 1 < intersections.length; i += 2) {
          const width = intersections[i + 1] - intersections[i];
          if (width > widest) { widest = width; lon = (intersections[i] + intersections[i + 1]) / 2; lat = candidateLat; }
        }
        if (widest > 0) break;
      }
    }
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      // サイズの異なる町村名を配置するため、代表点を通る区域内の「横幅」と
      // 最大ポリゴンの「縦幅」を事前に求める。移動中に図形を再走査しない。
      const crossings = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        if ((y1 > lat) !== (y2 > lat)) {
          crossings.push(x1 + (x2 - x1) * (lat - y1) / (y2 - y1));
        }
      }
      crossings.sort((a, b) => a - b);
      let interiorWidth = east - west;
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        if (crossings[i] - 1e-8 <= lon && lon <= crossings[i + 1] + 1e-8) {
          interiorWidth = crossings[i + 1] - crossings[i];
          break;
        }
      }
      best = { lat, lon, area, widthDegrees: Math.max(0, interiorWidth),
        heightDegrees: Math.max(0, north - south) };
    }
  }
  return best;
}

function indexMunicipalityLabels(features) {
  const positions = new Map();
  for (const feature of features) {
    const municipality = findMunicipalityForFeature(feature);
    if (!municipality) continue;
    const position = getMunicipalityLabelPosition(feature.geometry);
    if (!position) continue;
    const current = positions.get(municipality.code);
    if (!current || current.area < position.area) {
      positions.set(municipality.code, { ...position, municipality });
    }
  }
  return positions;
}

// 地図は全国データを初回だけ整理し、県別表示ではその県の図形だけをLeafletに渡す。
function indexMapFeatures(features) {
  mapFeaturesByPrefecture.clear();
  nationwideMunicipalityFeatures = [];
  for (const feature of features) {
    const municipality = findMunicipalityForFeature(feature);
    if (!municipality) continue;
    nationwideMunicipalityFeatures.push(feature);
    const prefecture = municipality.prefecture;
    if (!mapFeaturesByPrefecture.has(prefecture)) mapFeaturesByPrefecture.set(prefecture, []);
    mapFeaturesByPrefecture.get(prefecture).push(feature);
  }
}

function indexLabelsByPrefecture() {
  coarseLabelPositionsByPrefecture.clear();
  for (const [code, item] of coarseMunicipalityLabelPositions) {
    const prefecture = item.municipality.prefecture;
    if (!coarseLabelPositionsByPrefecture.has(prefecture)) {
      coarseLabelPositionsByPrefecture.set(prefecture, new Map());
    }
    coarseLabelPositionsByPrefecture.get(prefecture).set(code, item);
  }
}

// 地名は1県分を初回にまとめて用意し、パン・ピンチ中はLeafletのCSS移動に任せる。
// すべての自治体名を配置し、省略の上限や重なり判定は設けない。
// 極端に小さい区域では最小7pxの文字が重なり得るが、非表示にはしない。
function getMunicipalityLabelLayout(item) {
  const nameLength = Math.max(1, [...item.municipality.name].length);
  const lonPixels = 256 * Math.pow(2, 8) / 360; // ズーム8での経度1度の画素数
  const latitudeScale = 1 / Math.max(0.2, Math.cos(item.lat * Math.PI / 180));
  // 地名を行政区域の中にできるだけ収める。見切れないことを優先して小さくする。
  const horizontalPixels = Math.max(0, item.widthDegrees || 0) * lonPixels * 0.84;
  const verticalPixels = Math.max(0, item.heightDegrees || 0) * lonPixels * latitudeScale * 0.82;
  const horizontalFit = horizontalPixels / nameLength;
  const verticalFit = Math.min(horizontalPixels, verticalPixels / nameLength);
  // 縦長の細い区域は縦書きにする（まぷすたに近い省スペース配置）。
  const vertical = verticalFit > horizontalFit * 1.38 &&
    verticalPixels > horizontalPixels * 1.5;
  const fit = Math.max(1, vertical ? verticalFit : horizontalFit);
  const kind = item.municipality.type === "市" ? "city" : "town";
  const maxSize = kind === "city" ? 16 : 13;
  return { kind, vertical,
    fitSizeAtZoom8: Math.min(maxSize, fit), maxSize };
}

// 地図を動かすたびに全地名を削除・再計算しない。倍率だけCSS変数1個で反映。
function updateMapLabels() {
  if (!map || !window.L || typeof L.layerGroup !== "function" ||
      typeof L.marker !== "function" || typeof L.divIcon !== "function" ||
      typeof map.getZoom !== "function") return;
  const zoom = map.getZoom();
  const mapElement = $("japanMap");
  const scale = String(Math.pow(2, Math.max(3, Math.min(12, zoom)) - 8));
  if (mapElement?.style?.setProperty) mapElement.style.setProperty("--label-zoom-scale", scale);
  else if (mapElement?.style) mapElement.style["--label-zoom-scale"] = scale;
  if (!municipalityNameLayer) municipalityNameLayer = L.layerGroup().addTo(map);

  const selected = mapPrefectureFilter.value;
  const detail = selected && detailedMapLayers.get(selected);
  const nextSource = detail?.labels || null;
  if (selected === renderedLabelPrefecture && nextSource === renderedLabelSource) return;
  // 全国の概観では地名を作らない。県の切り替え時だけ丸ごと入れ替える。
  municipalityNameLayer.clearLayers();
  municipalityLabelMarkers.clear();
  renderedLabelPrefecture = selected;
  renderedLabelSource = nextSource;
  if (!selected || !nextSource) return;

  for (const [code, item] of nextSource) {
    const layout = getMunicipalityLabelLayout(item);
    const name = escapeHtml(item.municipality.name);
    const classes = `municipality-name-label municipality-name-label--${layout.kind}` +
      (layout.vertical ? " municipality-name-label--vertical" : "");
    const fit = layout.fitSizeAtZoom8.toFixed(3);
    const markup = `<span class="${classes}" style="--label-fit-z8:${fit}px;--label-max-size:${layout.maxSize}px">${name}</span>`;
    const marker = L.marker([item.lat, item.lon], {
      icon: L.divIcon({ className: "municipality-label-icon", html: markup,
        iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false, keyboard: false
    });
    municipalityNameLayer.addLayer(marker);
    municipalityLabelMarkers.set(code, { marker, lat: item.lat, lon: item.lon, kind: layout.kind });
  }
}

// 県境は自治体境界の線とは独立して描く。クリック・タップの邪魔をしない。
function getPrefectureBorderStyle() {
  const zoom = map && typeof map.getZoom === "function" ? map.getZoom() : 5;
  return { color: "#1b251e", weight: zoom >= 8 ? 4 : 2.5,
    opacity: 0.92, fill: false, interactive: false,
    lineCap: "round", lineJoin: "round" };
}

function raisePrefectureBorders() {
  if (prefectureBorderLayer && typeof prefectureBorderLayer.bringToFront === "function") {
    prefectureBorderLayer.bringToFront();
  }
}

// 全国表示は47都道府県の図形だけを描き、市区町村の境界は読み込まない。
function getPrefectureProgressCounts(prefecture) {
  const items = municipalities.filter(m => m.prefecture === prefecture);
  const visited = items.filter(m => getRecord(m.code).status === "visited").length;
  return { visited, total: items.length, percent: items.length ? visited / items.length * 100 : 0 };
}

function getOverviewMapStyle(feature) {
  const prefecture = String(feature?.properties?.N03_001 || "").trim();
  const progress = getPrefectureProgressCounts(prefecture).percent;
  const fillColor = progress === 0 ? "#eef2ef" : progress < 25 ? "#c4e7d2" :
    progress < 50 ? "#87cfa8" : progress < 75 ? "#45ad7d" : "#19865b";
  return { color: "#264638", weight: 1.4, opacity: 0.95,
    fillColor, fillOpacity: 0.77, lineCap: "round", lineJoin: "round" };
}

function renderOverviewLayer() {
  if (!map || !prefectureBorderGeoJSON || typeof L.geoJSON !== "function") return;
  if (prefectureOverviewLayer) map.removeLayer(prefectureOverviewLayer);
  const validFeatures = prefectureBorderGeoJSON.features.filter(feature =>
    municipalities.some(m => m.prefecture === feature.properties?.N03_001));
  prefectureOverviewLayer = L.geoJSON({ type: "FeatureCollection", features: validFeatures }, {
    smoothFactor: 0.45,
    style: getOverviewMapStyle,
    onEachFeature(feature, layer) {
      const prefecture = String(feature?.properties?.N03_001 || "").trim();
      if (!prefecture || !municipalities.some(m => m.prefecture === prefecture)) return;
      // スマホではタップ、PCではクリックして県別表示に進む。
      if (typeof layer.on === "function") layer.on("click", () => {
        mapPrefectureFilter.value = prefecture;
        renderMapLayer(prefecture);
      });
      if (typeof layer.bindTooltip === "function") layer.bindTooltip(() => {
        const progress = getPrefectureProgressCounts(prefecture);
        return `${prefecture} ・ ${progress.visited} / ${progress.total} 自治体（${progress.percent.toFixed(1)}%）`;
      }, { sticky: true, direction: "top" });
    }
  }).addTo(map);
  const bounds = prefectureOverviewLayer.getBounds?.();
  if (bounds?.isValid()) {
    map.setMaxBounds(null);
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 5 });
    // 北海道～沖縄の全体を見せ、全国モードでの移動範囲だけ制限する。
    const visibleBounds = map.getBounds?.();
    if (visibleBounds?.pad) map.setMaxBounds(visibleBounds.pad(0.12));
  }
  $("mapBadge").textContent = `全国 · ${new Set(validFeatures.map(f => f.properties?.N03_001)).size}都道府県`;
  $("mapDetailStatus").textContent = "地図の都道府県をタップすると、その県の市区町村を読み込みます。";
}

function renderPrefectureBorders() {
  if (!map || !prefectureBorderGeoJSON || typeof L.geoJSON !== "function") return;
  if (prefectureBorderLayer) map.removeLayer(prefectureBorderLayer);
  if (!mapPrefectureFilter.value) { prefectureBorderLayer = null; return; }
  const selected = mapPrefectureFilter.value;
  const features = prefectureBorderGeoJSON.features.filter(feature =>
    feature.properties?.N03_001 === selected);
  prefectureBorderLayer = L.geoJSON({type: "FeatureCollection", features}, {
    style: getPrefectureBorderStyle, interactive: false, smoothFactor: 0.2
  }).addTo(map);
  raisePrefectureBorders();
}

async function loadPrefectureBorders() {
  try {
    const response = await fetch(PREFECTURE_BORDER_URL);
    if (!response.ok) throw new Error(`県境データ HTTP ${response.status}`);
    const data = await response.json();
    if (data?.type !== "FeatureCollection" || !Array.isArray(data.features) ||
        !data.features.some(feature => typeof feature.properties?.N03_001 === "string")) {
      throw new Error("県境データの形式が不正です");
    }
    prefectureBorderGeoJSON = data;
    renderMapLayer(mapPrefectureFilter.value);
  } catch (error) {
    console.warn("全国の都道府県地図を取得できませんでした。", error);
    $("mapBadge").textContent = "地図の読み込み失敗";
    $("mapDetailStatus").textContent = "全国の県境データを取得できません。インターネット接続を確認し、再読み込みしてください。";
  }
}

function refreshMapStyles() {
  if (prefectureOverviewLayer) prefectureOverviewLayer.setStyle(getOverviewMapStyle);
  if (prefecturePreviewLayer) prefecturePreviewLayer.setStyle(getOverviewMapStyle);
  if (municipalityGeoLayer) municipalityGeoLayer.setStyle(getCoarseMapStatusColor);
  for (const entry of detailedMapLayers.values()) entry.layer.setStyle(getMapStatusColor);
  raisePrefectureBorders();
}

function populateMapPrefectures() {
  // 他の都道府県一覧と同じ地方区分・北から南の順で表示する。
  // 地方名は選択不可の見出し。都道府県の value は変更しない。
  const available = new Set(municipalities.map(m => m.prefecture));
  const known = new Set(PREFECTURE_REGIONS.flatMap(region => region.prefectures));
  const others = [...available].filter(name => !known.has(name)).sort((a, b) => a.localeCompare(b, "ja"));
  const regions = others.length ? [...PREFECTURE_REGIONS, { name: "その他", prefectures: others }] : PREFECTURE_REGIONS;

  mapPrefectureFilter.replaceChildren(new Option("全国", ""));
  for (const region of regions) {
    const present = region.prefectures.filter(name => available.has(name));
    if (!present.length) continue;
    const group = document.createElement("optgroup");
    group.label = region.name;
    for (const prefecture of present) {
      group.append(new Option(prefecture, prefecture));
    }
    mapPrefectureFilter.append(group);
  }
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
  // 全国モードでは軽量な全国図を保ち、詳細境界は県を選んだ場合にのみ読み込む。
  // 拡大するたびに隣接県の詳細図を取得しないため、描画や通信の負担を抑える。
  const selectedPrefecture = mapPrefectureFilter.value;
  return selectedPrefecture ? [selectedPrefecture] : [];
}

function updateDetailedMapStatus() {
  const host = $("mapDetailStatus");
  if (!host) return;
  const activeCount = detailedMapLayers.size;
  if (!mapPrefectureFilter.value) {
    host.textContent = "地図の都道府県をタップすると、その県の市区町村を読み込みます。";
  } else if (detailedMapRequests.size && !detailedMapLayers.has(mapPrefectureFilter.value)) {
    host.textContent = "詳細な市区町村境界を読み込み中です…";
  } else if (activeCount && detailedMapLayers.has(mapPrefectureFilter.value)) {
    host.textContent = "県内の市区町村を表示中です。地域をタップすると訪問記録を編集できます。";
  } else if (getDetailedMapTargets().some(pref => failedDetailedPrefectures.has(pref))) {
    host.textContent = "この県の詳細境界を読み込めませんでした。通信を確認し、別の県に切り替えてから再度お試しください。";
  } else {
    host.textContent = "都道府県を選ぶと、その県だけの市区町村境界を読み込みます。";
  }
}

function refreshDetailVisibility() {
  municipalityCodesHiddenByDetail.clear();
  for (const entry of detailedMapLayers.values()) {
    for (const code of entry.codes) municipalityCodesHiddenByDetail.add(code);
  }
  refreshMapStyles();
  updateDetailedMapStatus();
  updateMapLabels();
}

function bindMunicipalityPopup(feature, layer) {
  const municipality = findMunicipalityForFeature(feature);
  if (!municipality) return;
  // ポップアップを開くたびに最新の訪問状態を表示する。
  layer.bindPopup(() => {
    const record = getRecord(municipality.code);
    return `<div class="map-popup-title">${escapeHtml(municipality.name)}</div><div class="map-popup-status">${escapeHtml(municipality.prefecture)} · ${escapeHtml(getStatusLabel(record.status))}</div><button class="map-popup-button" type="button" data-map-code="${escapeHtml(municipality.code)}">記録を編集</button> <button class="map-popup-prefecture-button" type="button" data-map-prefecture="${escapeHtml(municipality.prefecture)}">この都道府県を表示</button>`;
  });
  layer.on("popupopen", event => {
    const button = event.popup.getElement()?.querySelector("[data-map-code]");
    if (button) button.addEventListener("click", () => openRecordDialog(municipality), { once: true });
    const prefectureButton = event.popup.getElement()?.querySelector("[data-map-prefecture]");
    if (prefectureButton) prefectureButton.addEventListener("click", () => {
      mapPrefectureFilter.value = municipality.prefecture;
      renderMapLayer(municipality.prefecture);
    }, { once: true });
  });
  layer.bindTooltip(`${municipality.prefecture} ${municipality.name}`, { sticky: true, direction: "top" });
}

function rememberDetailedGeoJSON(prefecture, features) {
  detailedGeoCache.delete(prefecture);
  detailedGeoCache.set(prefecture, features);
  if (detailedGeoCache.size > 3) {
    const oldest = detailedGeoCache.keys().next().value;
    detailedGeoCache.delete(oldest);
    detailedLabelCache.delete(oldest);
  }
}

async function refreshDetailedBoundaries() {
  if (!map) return;
  const prefecture = mapPrefectureFilter.value;
  const viewVersion = mapViewVersion;
  // 前に選んでいた県の図形は削除。取得済みのデータだけ最大3県まで保持。
  for (const [name, entry] of detailedMapLayers) {
    if (name !== prefecture) {
      map.removeLayer(entry.layer);
      detailedMapLayers.delete(name);
    }
  }
  if (!prefecture) { updateDetailedMapStatus(); return; }
  if (detailedMapLayers.has(prefecture)) { updateDetailedMapStatus(); return; }
  if (detailedMapRequests.has(prefecture)) return;
  detailedMapRequests.add(prefecture);
  updateDetailedMapStatus();
  try {
    let features = detailedGeoCache.get(prefecture);
    if (!features) {
      const representative = municipalities.find(m => m.prefecture === prefecture);
      if (!representative) throw new Error("自治体一覧に都道府県が見つかりません");
      const prefCode = normalizeMapCode(representative.code).slice(0, 2);
      const response = await fetch(`${DETAIL_MAP_BASE_URL}${prefCode}.json`);
      if (!response.ok) throw new Error(`詳細境界 HTTP ${response.status}`);
      const data = await response.json();
      if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
        throw new Error("詳細境界の形式が不正です");
      }
      features = data.features.filter(feature => {
        const m = findMunicipalityForFeature(feature);
        return m && m.prefecture === prefecture && feature.geometry;
      });
      if (!features.length) throw new Error("自治体一覧と詳細境界を照合できません");
      rememberDetailedGeoJSON(prefecture, features);
    }
    // 読み込み中に別の県へ移動した場合、その結果を画面に追加しない。
    if (mapViewVersion !== viewVersion || mapPrefectureFilter.value !== prefecture) return;
    const codes = new Set(features.map(feature => findMunicipalityForFeature(feature)?.code).filter(Boolean));
    const layer = L.geoJSON({ type: "FeatureCollection", features }, {
      // 5%簡略化済みの県別データをさらに画面表示向けに最適化。
      // 元データと自治体コードは変更しない。境界の細部は拡大後に確認する。
      smoothFactor: 0.75,
      style: getMapStatusColor,
      onEachFeature: bindMunicipalityPopup
    }).addTo(map);
    let labels = detailedLabelCache.get(prefecture);
    if (!labels) {
      labels = indexMunicipalityLabels(features);
      detailedLabelCache.set(prefecture, labels);
    }
    detailedMapLayers.set(prefecture, { layer, codes, labels });
    if (prefecturePreviewLayer) {
      map.removeLayer(prefecturePreviewLayer);
      prefecturePreviewLayer = null;
    }
    const bounds = layer.getBounds?.();
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
    failedDetailedPrefectures.delete(prefecture);
    updateMapLabels();
    raisePrefectureBorders();
    $("mapBadge").textContent = `${prefecture} · ${codes.size}自治体`;
  } catch (error) {
    console.warn(`${prefecture}の詳細境界を読み込めませんでした。`, error);
    if (mapViewVersion === viewVersion && mapPrefectureFilter.value === prefecture) {
      failedDetailedPrefectures.add(prefecture);
      $("mapBadge").textContent = `${prefecture} · 読み込み失敗`;
    }
  } finally {
    detailedMapRequests.delete(prefecture);
    if (mapViewVersion === viewVersion) updateDetailedMapStatus();
    // A→B→Aのように高速で県を戻した場合、途中で破棄した結果を現在画面へ反映し直す。
    else if (mapPrefectureFilter.value === prefecture && !detailedMapLayers.has(prefecture)) {
      void refreshDetailedBoundaries();
    }
  }
}

function scheduleDetailedBoundaries() {
  clearTimeout(detailedMapUpdateTimer);
  detailedMapUpdateTimer = setTimeout(() => {
    updateMapLabels();
    if (prefectureBorderLayer && typeof prefectureBorderLayer.setStyle === "function") {
      prefectureBorderLayer.setStyle(getPrefectureBorderStyle);
    }
    void refreshDetailedBoundaries();
  }, 250);
}

function renderMapLayer(prefecture = "") {
  if (!map) return;
  mapViewVersion++;
  mapPrefectureFilter.value = prefecture;
  // 県別画面に移る前に全国の図形を取り除き、描画数を減らす。
  if (prefectureOverviewLayer) {
    map.removeLayer(prefectureOverviewLayer);
    prefectureOverviewLayer = null;
  }
  if (prefecturePreviewLayer) {
    map.removeLayer(prefecturePreviewLayer);
    prefecturePreviewLayer = null;
  }
  if (municipalityGeoLayer) {
    map.removeLayer(municipalityGeoLayer);
    municipalityGeoLayer = null;
  }
  if (prefectureBorderLayer) {
    map.removeLayer(prefectureBorderLayer);
    prefectureBorderLayer = null;
  }
  for (const [name, entry] of detailedMapLayers) {
    if (name !== prefecture) {
      map.removeLayer(entry.layer);
      detailedMapLayers.delete(name);
    }
  }
  const isOverview = !prefecture;
  if (isOverview) $("mapPanel").classList.add("is-national-mode");
  else $("mapPanel").classList.remove("is-national-mode");
  $("mapModeTitle").textContent = isOverview ? "全国から都道府県を選択" : `${prefecture}の市区町村マップ`;
  $("mapOverviewLegend").hidden = !isOverview;
  $("mapMunicipalityLegend").hidden = isOverview;
  $("resetMapView").disabled = isOverview;
  renderedLabelPrefecture = "";
  renderedLabelSource = null;
  municipalityNameLayer?.clearLayers();
  municipalityLabelMarkers.clear();
  if (isOverview) {
    renderOverviewLayer();
    updateDetailedMapStatus();
    return;
  }
  // 全国モードの移動制限を解除し、県の形に合わせて拡大する。
  map.setMaxBounds(null);
  const features = prefectureBorderGeoJSON?.features.filter(
    feature => feature.properties?.N03_001 === prefecture) || [];
  if (features.length) {
    prefecturePreviewLayer = L.geoJSON({ type: "FeatureCollection", features }, {
      style: getOverviewMapStyle, interactive: false, smoothFactor: 0.3
    }).addTo(map);
    const bounds = prefecturePreviewLayer.getBounds?.();
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 8 });
  }
  $("mapBadge").textContent = `${prefecture} · 読み込み中`;
  renderPrefectureBorders();
  void refreshDetailedBoundaries();
}

// Safari/iPhoneでも使える、ページ内の全画面地図。OSのフルスクリーンAPIには依存しない。
function setMapFullscreen(expanded) {
  const panel = $("mapPanel");
  const button = $("toggleMapFullscreen");
  if (!panel || !button) return;
  mapFullscreen = expanded;
  if (expanded) {
    panel.classList.add("is-map-fullscreen");
    document.body.classList.add("map-fullscreen-active");
  } else {
    panel.classList.remove("is-map-fullscreen");
    document.body.classList.remove("map-fullscreen-active");
  }
  // 全画面中はボタンを短くして地図の上に小さな操作バーを重ねる。
  button.textContent = expanded ? "閉じる" : "全画面表示";
  $("resetMapView").textContent = expanded ? "全国へ" : "全国表示に戻す";
  button.setAttribute("aria-pressed", String(expanded));
  button.setAttribute("aria-label", expanded ? "地図の全画面表示を終了" : "地図を全画面で表示");
  // サイズ変更だけで勝手に表示位置をずらさず、地名マーカーも保持する。
  const resize = () => {
    if (map && typeof map.invalidateSize === "function") {
      map.invalidateSize({ animate: false, pan: false });
    }
    updateMapLabels();
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(resize);
  else resize();
}

function initializeMap() {
  const mapElement = $("japanMap");
  if (!mapElement || !window.L) {
    $("mapBadge").textContent = "地図ライブラリを読み込めません";
    return;
  }
  // 全国表示とスマートフォンで白・灰色の矩形ができないように、
  // 提供範囲が部分的な複数のタイルではなく、全球を覆う1種類の海底地形図を背景に使う。
  // 訪問状況・市区町村境界は従来どおり、その上に描画する。
  // Canvasの描画範囲を周辺へ少し広げ、画面端を出入りする境界の
  // 切り直しを緩和する。広げすぎるとメモリを使うため25%にとどめる。
  const bufferedRenderer = typeof L.canvas === "function" ? L.canvas({ padding: 0.25 }) : undefined;
  map = L.map("japanMap", {
    scrollWheelZoom: true,
    preferCanvas: true,
    ...(bufferedRenderer ? { renderer: bufferedRenderer } : {}),
    // 地名マーカーもピンチ拡大縮小のアニメーションに追従させる。
    // 無効だとLeafletの仕様上、ズーム中だけマーカーが非表示になる。
    markerZoomAnimation: true,
    minZoom: 3,
    maxZoom: 12,
    maxBoundsViscosity: 1.0
  }).setView([36.2, 138.2], 5);

  // Esri Ocean Base は世界共通の連続したタイルで、境界に白い矩形が発生しない。
  // この背景地図は地域によって高倍率のタイルが未整備のため、
  // zoom 10～12 では提供範囲が広い zoom 9 の画像を拡大して使用する。
  // 「Map data not yet available」と書かれた青い代替タイルを要求しない。
  // 市区町村の境界・地名は独立したレイヤーなので引き続き鮮明に表示される。
  // 出典表記は地図上と地図の説明文に表示する。
  L.tileLayer("https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}", {
    minZoom: 3,
    maxZoom: 12,
    maxNativeZoom: 9,
    tileSize: 256,
    // 直前に画面外へ出た背景タイルをすぐ捨てず、戻したとき再利用する。
    keepBuffer: 4,
    // ピンチの途中で次々とタイルを更新せず、指を離したときに更新する。
    updateWhenZooming: false,
    attribution: '地形図: <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a>、Garmin、GEBCO、NOAA NGDC ほか'
  }).addTo(map);

  if (typeof map.on === "function") {
    // 移動中は名前マーカーや地域のDOMを再作成しない。
    // 完了後の小さな更新だけに留める。
    map.on("zoomend", scheduleDetailedBoundaries);
  }
  const fullscreenButton = $("toggleMapFullscreen");
  if (fullscreenButton) fullscreenButton.addEventListener("click", () => setMapFullscreen(!mapFullscreen));
  if (typeof document.addEventListener === "function") {
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && mapFullscreen && !dialog.open) setMapFullscreen(false);
    });
  }
  mapPrefectureFilter.addEventListener("change", () => renderMapLayer(mapPrefectureFilter.value));
  $("resetMapView").addEventListener("click", () => {
    mapPrefectureFilter.value = "";
    renderMapLayer("");
  });

  // コードと自治体名の対応表だけ先に作る。全国市区町村の巨大な境界データは取得しない。
  municipalityByMapCode.clear();
  municipalityByPrefectureAndName.clear();
  municipalities.forEach(m => {
    municipalityByMapCode.set(normalizeMapCode(m.code), m);
    municipalityByPrefectureAndName.set(`${m.prefecture}\u0000${m.name}`, m);
  });
  populateMapPrefectures();
  void loadPrefectureBorders();
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
