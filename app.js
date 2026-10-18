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


// 全国では都道府県境界のみを表示し、都道府県選択時にその県の詳細境界を取得する。
// 地図の描画のみMapLibreへ移行。訪問記録・検索・制覇率は従来の処理を維持する。
// 既存のSTORAGE_KEYと記録オブジェクトをそのまま使用し、移行処理や自動書き換えは行わない。
function refreshMapStyles() {
  window.MainMapLibre?.refreshRecords();
}

function initializeMap() {
  if (!window.MainMapLibre) {
    $("mapBadge").textContent = "地図プログラムが見つかりません";
    $("mapDetailStatus").textContent = "maplibre-main.jsを読み込めませんでした。ファイルを確認してください。";
    return;
  }
  window.MainMapLibre.initialize({
    municipalities,
    getRecords: () => records,
    openRecordDialog,
    regions: PREFECTURE_REGIONS
  });
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
