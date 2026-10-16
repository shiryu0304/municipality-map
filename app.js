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


// 全国の概観は従来の軽量データを利用する。訪問記録とは独立した表示用データ。
const MAP_DATA_URL = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/N03-21_210101_designated_city.json";
// 拡大表示では2026年行政区域データの県別5%簡略化版を取得する。
// 0.1%の全国用データより詳細だが、測量データそのものではない。
const DETAIL_MAP_BASE_URL = "https://raw.githubusercontent.com/ricewin/simplify-japan-geojson/main/GeoJson/";
// 全国の市町村境界と同じ元データによる県境（軽量な0.1%簡略化版）。
// 市町村境界を太くすると全線が濃くなるため、県境だけを独立して上に描く。
const PREFECTURE_BORDER_URL = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/prefectures.json";
let prefectureBorderGeoJSON = null;
let prefectureBorderLayer;

const detailedMapLayers = new Map(); // 県名 -> { layer, codes }
const detailedMapRequests = new Set();
const failedDetailedPrefectures = new Set();
const municipalityCodesHiddenByDetail = new Set();
const prefectureGeoBounds = new Map(); // 県名 -> [南端, 西端, 北端, 東端]
let coarseMunicipalityLabelPositions = new Map();
let municipalityNameLayer; // 地図の上に表示する市区町村名（記録データとは独立）
let lastMapLabelSignature = null; // 同じラベル構成ならDOMの作り直しを省く
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
    if (Number.isFinite(lat) && Number.isFinite(lon)) best = { lat, lon, area };
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

// まぷすたのように地図上に文字を直接置く。表示レベルに応じて文字数と優先度を制御する。
function updateMapLabels() {
  if (!map || !window.L || typeof L.layerGroup !== "function" ||
      typeof L.marker !== "function" || typeof L.divIcon !== "function" ||
      typeof map.getZoom !== "function" || typeof map.getBounds !== "function" ||
      typeof map.latLngToContainerPoint !== "function") return;
  if (!municipalityNameLayer) municipalityNameLayer = L.layerGroup().addTo(map);
  const zoom = map.getZoom();
  if (zoom < 7) {
    if (lastMapLabelSignature !== "hidden") {
      municipalityNameLayer.clearLayers();
      lastMapLabelSignature = "hidden";
    }
    return;
  }

  const selected = mapPrefectureFilter.value;
  const candidates = new Map();
  for (const entry of detailedMapLayers.values()) {
    for (const [code, position] of entry.labels || []) candidates.set(code, position);
  }
  for (const [code, position] of coarseMunicipalityLabelPositions) {
    if (!candidates.has(code) && !municipalityCodesHiddenByDetail.has(code)) {
      candidates.set(code, position);
    }
  }
  const bounds = map.getBounds();
  const visible = [...candidates.values()].filter(item =>
    (!selected || item.municipality.prefecture === selected) &&
    typeof bounds.contains === "function" && bounds.contains([item.lat, item.lon]) &&
    // 広域表示では市だけを優先し、細かな町村・特別区は拡大後に表示する。
    (zoom >= 8 || item.municipality.type === "市"));

  // 都市名を優先しつつ、広い市区町村はラベルを残しやすくする。
  const priority = m => m.type === "市" ? 2 : m.type === "特別区" ? 1 : 0;
  visible.sort((a, b) => priority(b.municipality) - priority(a.municipality) || b.area - a.area);
  const occupied = [];
  const chosen = [];
  const limit = zoom >= 10 ? 180 : zoom >= 9 ? 130 : zoom >= 8 ? 95 : 45;
  for (const item of visible) {
    const pixel = map.latLngToContainerPoint([item.lat, item.lon]);
    if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) continue;
    const kind = item.municipality.type === "市" ? "city" : "town";
    const fontSize = kind === "city" ? (zoom >= 10 ? 15 : 14) : (zoom >= 10 ? 13 : 12);
    const halfWidth = [...item.municipality.name].length * fontSize * 0.53 + 3;
    const halfHeight = fontSize * 0.6;
    if (occupied.some(pos => Math.abs(pixel.x - pos.x) < halfWidth + pos.halfWidth + 5 &&
        Math.abs(pixel.y - pos.y) < halfHeight + pos.halfHeight + 4)) continue;
    occupied.push({ x: pixel.x, y: pixel.y, halfWidth, halfHeight });
    chosen.push({ ...item, kind });
    if (occupied.length >= limit) break;
  }
  // Leafletは地図移動時に既存のマーカーを自動追従させる。
  // 表示対象と位置が同じなら破棄・再生成をしないことで、スマートフォンのDOM負荷を抑える。
  const signature = chosen.map(item =>
    `${item.municipality.code}:${item.lat}:${item.lon}:${item.kind}`).join("|");
  if (signature === lastMapLabelSignature) return;
  municipalityNameLayer.clearLayers();
  for (const item of chosen) {
    municipalityNameLayer.addLayer(L.marker([item.lat, item.lon], {
      icon: L.divIcon({
        className: "municipality-label-icon",
        html: `<span class="municipality-name-label municipality-name-label--${item.kind}">${escapeHtml(item.municipality.name)}</span>`,
        iconSize: [0, 0], iconAnchor: [0, 0]
      }),
      interactive: false, keyboard: false
    }));
  }
  lastMapLabelSignature = signature;
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

function renderPrefectureBorders() {
  if (!map || !prefectureBorderGeoJSON || typeof L.geoJSON !== "function") return;
  if (prefectureBorderLayer) map.removeLayer(prefectureBorderLayer);
  const selected = mapPrefectureFilter.value;
  const features = prefectureBorderGeoJSON.features.filter(feature =>
    !selected || feature.properties?.N03_001 === selected);
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
    renderPrefectureBorders();
  } catch (error) {
    console.warn("県境データの取得に失敗しました。市町村境界は従来どおり表示します。", error);
  }
}

function refreshMapStyles() {
  if (municipalityGeoLayer) municipalityGeoLayer.setStyle(getCoarseMapStatusColor);
  for (const entry of detailedMapLayers.values()) entry.layer.setStyle(getMapStatusColor);
  raisePrefectureBorders();
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
  updateMapLabels();
}

function bindMunicipalityPopup(feature, layer) {
  const municipality = findMunicipalityForFeature(feature);
  if (!municipality) return;
  // ポップアップを開くたびに最新の訪問状態を表示する。
  layer.bindPopup(() => {
    const record = getRecord(municipality.code);
    return `<div class="map-popup-title">${escapeHtml(municipality.name)}</div><div class="map-popup-status">${escapeHtml(municipality.prefecture)} · ${escapeHtml(getStatusLabel(record.status))}</div><button class="map-popup-button" type="button" data-map-code="${escapeHtml(municipality.code)}">記録を編集</button>`;
  });
  layer.on("popupopen", event => {
    const button = event.popup.getElement()?.querySelector("[data-map-code]");
    if (button) button.addEventListener("click", () => openRecordDialog(municipality), { once: true });
  });
  layer.bindTooltip(`${municipality.prefecture} ${municipality.name}`, { sticky: true, direction: "top" });
}

async function refreshDetailedBoundaries() {
  if (!mapGeoJSON || !map) return;
  const targets = new Set(getDetailedMapTargets());
  let changedLayers = false;
  for (const [prefecture, entry] of detailedMapLayers) {
    if (!targets.has(prefecture)) {
      map.removeLayer(entry.layer);
      detailedMapLayers.delete(prefecture);
      changedLayers = true;
    }
  }
  // 表示中の詳細レイヤーが変わらなければ、全自治体の描画スタイルは触らない。
  if (changedLayers) refreshDetailVisibility();
  else updateDetailedMapStatus();

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
      detailedMapLayers.set(prefecture, { layer, codes, labels: indexMunicipalityLabels(features) });
      refreshDetailVisibility();
      raisePrefectureBorders();
    } catch (error) {
      console.warn(`${prefecture}の詳細境界を読み込めませんでした。`, error);
      failedDetailedPrefectures.add(prefecture);
    } finally {
      detailedMapRequests.delete(prefecture);
      // 読み込み失敗・対象変更では境界を描き直さず、案内文だけ更新する。
      updateDetailedMapStatus();
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
  renderPrefectureBorders();
  updateMapLabels();
  void refreshDetailedBoundaries();
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
  map = L.map("japanMap", {
    scrollWheelZoom: true,
    preferCanvas: true,
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
    keepBuffer: 2,
    attribution: '地形図: <a href="https://www.esri.com/" target="_blank" rel="noopener noreferrer">Esri</a>、Garmin、GEBCO、NOAA NGDC ほか'
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
      municipalityByPrefectureAndName.clear();
      municipalities.forEach(m => {
        municipalityByMapCode.set(normalizeMapCode(m.code), m);
        municipalityByPrefectureAndName.set(`${m.prefecture}\u0000${m.name}`, m);
      });
      populateMapPrefectures();
      coarseMunicipalityLabelPositions = indexMunicipalityLabels(geojson.features);
      renderMapLayer("");
      void loadPrefectureBorders();
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
