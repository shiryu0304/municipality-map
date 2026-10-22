const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const wait = async () => { for (let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };

function start(initialRecords) {
  class Element {
    constructor(){ this.value='';this.textContent='';this.style={};this.disabled=false;this.hidden=false;this.children=[];this.events={};this.classList={add(){},remove(){}}; }
    addEventListener(type,handler){this.events[type]=handler;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=items;}
    setAttribute(){}
    add(el){this.children.push(el);}
    showModal(){this.isOpen=true;}
    close(){this.isOpen=false;}
    scrollIntoView(){}
    click(){this.clicked=true;}
    remove(){this.removed=true;}
  }
  const els=new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>[m[1],new Element()]));
  els.get('statusFilter').value=''; // 初期状態は「表示を選択」
  const localStore=new Map([['municipality-conquest-records-v1',JSON.stringify(initialRecords)]]);
  const writes=[];
  const alerts=[];
  const feature=(name,code)=>({type:'Feature',properties:{N03_001:'東京都',N03_004:name,N03_007:code},geometry:{type:'Polygon',coordinates:[[[139,35],[140,35],[140,36],[139,35]]]}});
  const features=[feature('千代田区','13101'),feature('新宿区','13104'),feature('渋谷区','13113')];
  const catalog=[{lgcode:'131016',pref:'東京都',city:'千代田区'}, {lgcode:'131041',pref:'東京都',city:'新宿区'}, {lgcode:'131130',pref:'東京都',city:'渋谷区'}, ...Array.from({length:999},(_,i)=>({lgcode:String(800000+i),pref:'北海道',city:`テスト${i}市`}))];
  const layer={addTo(){return this;},getBounds(){return {isValid(){return true;}};},getLayers(){return features;},setStyle(style){this.style=style;}};
  const bounds={pad(){return this;}};
  const map={setView(){return this;},fitBounds(){return this;},setMaxBounds(){return this;},getBounds(){return bounds;},removeLayer(){},on(){return this;}};
  const L={map:()=>map,tileLayer:()=>({addTo(){}}),geoJSON:(data,opts)=>{
    // bind popups needs fake sublayers, real display map isn't needed.
    for(const ft of data.features){opts.onEachFeature?.(ft,{bindPopup(){},on(){},bindTooltip(){}})}
    return {...layer};
  }};
  const context=vm.createContext({
    document:{getElementById:id=>els.get(id),createElement:()=>new Element(),body:new Element()},
    localStorage:{getItem:key=>localStore.get(key)??null,setItem:(key,val)=>{localStore.set(key,val);writes.push({key,val});}},
    fetch: async url=>({ok:true,json:async()=>url.includes('localgovjp')?catalog:{type:'FeatureCollection',features}}),
    L,window:{L},Option:function(text,value){return Object.assign(new Element(),{textContent:text,value})},
    console:{error(){},warn(){}},setTimeout:()=>1,clearTimeout(){},
    alert:message=>alerts.push(message),confirm:()=>true,Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},
  });
  vm.runInContext(js,context);
  return {els,context,writes,alerts,localStore,features};
}

test('new three statuses appear everywhere and style tokens agree',()=>{
  assert.match(html, /id="passedCount"/);
  assert.match(html, /option value="passed">通過<\/option>/);
  assert.match(html, /legend-dot passed/);
  assert.match(css, /\.status-passed/);
  assert.match(css, /\.legend-dot\.passed/);
  assert.doesNotMatch(html,/value="want"/);
  assert.doesNotMatch(html,/wantCount/);
});

test('legacy wanted record shows as unvisited without mutating storage on load',async()=>{
  const data={'131016':{status:'visited',date:'2026-01-01',memo:'X'},'131041':{status:'want',date:'',memo:'save this'},'131130':{status:'passed',date:'2026-04-02',memo:'train'}};
  const a=start(data);await wait();
  assert.equal(a.writes.length,0);
  assert.equal(a.els.get('visitedCount').textContent,1);
  assert.equal(a.els.get('passedCount').textContent,1);
  assert.equal(a.els.get('overallPercent').textContent,'0.1%');
  assert.equal(vm.runInContext('getRecord("131041").status',a.context),'unvisited');
  assert.equal(vm.runInContext('getRecord("131041").memo',a.context),'save this');
  assert.equal(JSON.parse(a.localStore.get('municipality-conquest-records-v1'))['131041'].status,'want');
  // 地図の描画方式をLeafletからMapLibreへ変更。色分けの更新は地図専用テストで検証。
  a.els.get('statusFilter').value='passed';
  assert.deepEqual(Array.from(vm.runInContext('getFilteredMunicipalities().map(m=>m.name)',a.context)),['渋谷区']);
});

test('saving passed status preserves the selected date and old unrelated records',async()=>{
  const a=start({'131041':{status:'want',date:'',memo:'old request'}});await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))',a.context);
  assert.equal(a.els.get('recordDialog').isOpen,true);
  a.els.get('recordStatus').value='passed';
  a.els.get('recordDate').value='2026-10-12';
  a.els.get('recordMemo').value='駅を通過';
  a.els.get('recordForm').events.submit({preventDefault(){}});
  const saved=JSON.parse(a.localStore.get('municipality-conquest-records-v1'));
  assert.deepEqual(saved['131016'],{status:'passed',date:'2026-10-12',memo:'駅を通過'});
  assert.equal(saved['131041'].status,'want');
  assert.equal(a.els.get('recordDialog').isOpen,false);
  assert.equal(a.els.get('passedCount').textContent,1);
  assert.equal(a.els.get('visitedCount').textContent,0);
  assert.equal(a.writes.length,1);
});

test('main app keeps its MapLibre redraw hook when records are saved',async()=>{
  const a=start({'131016':{status:'visited',date:'2026-01-01',memo:''}});await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))',a.context);
  a.els.get('recordStatus').value='passed';
  a.els.get('recordForm').events.submit({preventDefault(){}});
  assert.equal(vm.runInContext('getRecord("131016").status',a.context),'passed');
  assert.match(js, /window\.MainMapLibre\?\.refreshRecords\(\)/);
});

test('import supports old want entries, backs up original records, and displays as unvisited',async()=>{
  const a=start({'131016':{status:'visited',date:'2025-01-01',memo:'original'}});await wait();
  const previous=a.localStore.get('municipality-conquest-records-v1');
  const imported={records:{'131016':{status:'want',date:'',memo:'later'},'131041':{status:'passed',date:'2026-05-01',memo:'train'}}};
  await a.els.get('importInput').events.change({target:{files:[{text:async()=>JSON.stringify(imported)}],value:'file'}});
  const backup=JSON.parse(a.localStore.get('municipality-conquest-before-import-v1'));
  assert.equal(backup.recordsRaw,previous);
  const saved=JSON.parse(a.localStore.get('municipality-conquest-records-v1'));
  assert.equal(saved['131016'].status,'unvisited');
  assert.equal(saved['131016'].memo,'later');
  assert.equal(saved['131041'].status,'passed');
  assert.equal(saved['131041'].date,'2026-05-01');
  assert.equal(a.els.get('passedCount').textContent,1);
});

test('municipality cards are hidden on initial load, without changing saved records',async()=>{
  const a=start({'131016':{status:'visited',date:'2026-01-01',memo:'keep'}});
  await wait();
  assert.equal(a.els.get('municipalityList').children.length,0);
  assert.match(a.els.get('resultSummary').textContent,/都道府県・市町村名・表示のいずれか/);
  assert.equal(a.els.get('emptyState').hidden,true);
  assert.equal(a.els.get('visitedCount').textContent,1,'全体の集計は変わらない');
  assert.equal(a.writes.length,0);
});

test('choosing a prefecture shows only its municipalities and clearing it hides the list',async()=>{
  const a=start({});await wait();
  a.els.get('prefectureFilter').value='東京都';
  a.els.get('prefectureFilter').events.change();
  assert.equal(a.els.get('municipalityList').children.length,3);
  assert.equal(a.els.get('resultSummary').textContent,'3 件を表示中');
  a.els.get('prefectureFilter').value='';
  a.els.get('prefectureFilter').events.change();
  assert.equal(a.els.get('municipalityList').children.length,0);
  assert.equal(a.els.get('emptyState').hidden,true);
  assert.equal(a.writes.length,0);
});

test('searching by municipality name shows matches and clearing search hides the list',async()=>{
  const a=start({});await wait();
  a.els.get('searchInput').value='新宿';
  a.els.get('searchInput').events.input();
  assert.equal(a.els.get('municipalityList').children.length,1);
  assert.equal(a.els.get('municipalityList').children[0].children[0].children[0].textContent,'新宿区');
  a.els.get('searchInput').value='見つからない自治体';
  a.els.get('searchInput').events.input();
  assert.equal(a.els.get('municipalityList').children.length,0);
  assert.equal(a.els.get('emptyState').hidden,false,'検索結果0件のメッセージは表示する');
  a.els.get('searchInput').value='';
  a.els.get('searchInput').events.input();
  assert.equal(a.els.get('emptyState').hidden,true,'未検索の案内に戻す');
  assert.match(a.els.get('resultSummary').textContent,/都道府県・市町村名・表示/);
  assert.equal(a.writes.length,0);
});

test('the status filter has a blank prompt, while choosing any option reveals matching municipalities',async()=>{
  assert.match(html, /<select id="statusFilter">\s*<option value="">表示を選択<\/option>/);
  const a=start({'131016':{status:'visited',date:'2026-10-11',memo:'stay'},
    '131130':{status:'passed',date:'2026-10-12',memo:'rail'}});await wait();
  const filter=a.els.get('statusFilter');
  assert.equal(filter.value,'');
  assert.equal(a.els.get('municipalityList').children.length,0,'初期状態で一覧を表示しない');

  filter.value='passed'; filter.events.change();
  assert.equal(a.els.get('municipalityList').children.length,1,'表示だけで通過済みの一覧が出る');
  assert.equal(a.els.get('municipalityList').children[0].children[0].children[0].textContent,'渋谷区');

  filter.value='visited'; filter.events.change();
  assert.equal(a.els.get('municipalityList').children.length,1,'訪問も絞り込める');
  assert.equal(a.els.get('municipalityList').children[0].children[0].children[0].textContent,'千代田区');

  filter.value='unvisited'; filter.events.change();
  assert.ok(a.els.get('municipalityList').children.length>0,'未踏も絞り込める');

  filter.value='all'; filter.events.change();
  assert.equal(a.els.get('municipalityList').children.length,1002,'表示の「すべて」を選ぶと全国一覧を表示');
  assert.equal(a.els.get('resultSummary').textContent,'1002 件を表示中');

  a.els.get('prefectureFilter').value='東京都';
  a.els.get('prefectureFilter').events.change();
  assert.equal(a.els.get('municipalityList').children.length,3,'都道府県と表示を同時に絞れる');
  filter.value='passed'; filter.events.change();
  assert.equal(a.els.get('municipalityList').children.length,1,'都道府県と通過で組み合わせて検索できる');

  filter.value=''; filter.events.change();
  assert.equal(a.els.get('municipalityList').children.length,3,'表示を解除しても都道府県の検索条件は残る');
  a.els.get('prefectureFilter').value='';
  a.els.get('prefectureFilter').events.change();
  assert.equal(a.els.get('municipalityList').children.length,0,'条件をすべて解除すると再び一覧を隠す');
  assert.equal(a.writes.length,0,'表示変更は保存データを変更しない');
});

test('clicking a prefecture progress item can reveal municipality records',async()=>{
  const a=start({});await wait();
  const tokyoButton=a.els.get('prefectureProgressList').children.find(btn=>
    btn.children[0]?.children[0]?.textContent==='東京都');
  assert.ok(tokyoButton);
  tokyoButton.events.click();
  assert.equal(a.els.get('prefectureFilter').value,'東京都');
  assert.equal(a.els.get('municipalityList').children.length,3);
  assert.equal(a.writes.length,0);
});


test('a new visited record has no date by default, and saving keeps the date blank', async () => {
  const a = start({}); await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  assert.equal(a.els.get('recordDate').value, '');
  a.els.get('recordStatus').value = 'visited';
  a.els.get('recordForm').events.submit({ preventDefault() {} });
  const saved = JSON.parse(a.localStore.get('municipality-conquest-records-v1'));
  assert.deepEqual(saved['131016'], { status:'visited', date:'', memo:'' });
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  assert.equal(a.els.get('recordDate').value, '', '再度開いても当日の日付が入力されない');
});

test('a travelled record without a saved date also opens and stays blank', async () => {
  const a = start({'131016':{status:'passed',date:'',memo:'通過'}}); await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  assert.equal(a.els.get('recordDate').value, '');
  assert.equal(a.writes.length, 0, '開くだけでは記録を自動変更しない');
  a.els.get('recordForm').events.submit({preventDefault(){}});
  assert.equal(JSON.parse(a.localStore.get('municipality-conquest-records-v1'))['131016'].date, '');
});

test('multiple days and a long stay save and reopen without losing any dates', async () => {
  const a = start({}); await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  a.els.get('recordStatus').value = 'visited';
  a.els.get('recordDate').value = '2026-07-02';
  a.els.get('addVisitDateButton').events.click();
  a.els.get('addVisitPeriodButton').events.click();
  vm.runInContext('extraVisitDateRows[0].startInput.value = "2026-08-03"', a.context);
  vm.runInContext('extraVisitDateRows[1].startInput.value = "2026-09-01"', a.context);
  vm.runInContext('extraVisitDateRows[1].endInput.value = "2026-09-12"', a.context);
  a.els.get('recordForm').events.submit({ preventDefault() {} });
  const saved = JSON.parse(a.localStore.get('municipality-conquest-records-v1'))['131016'];
  assert.equal(saved.date, '2026-07-02', '旧バージョン互換の代表日が残る');
  assert.deepEqual(saved.visitDates, [
    {start:'2026-07-02',end:''},
    {start:'2026-08-03',end:''},
    {start:'2026-09-01',end:'2026-09-12'}
  ]);
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  assert.equal(a.els.get('recordDate').value, '2026-07-02');
  assert.equal(a.els.get('additionalVisitDates').children.length, 2);
  assert.equal(vm.runInContext('extraVisitDateRows[0].startInput.value', a.context), '2026-08-03');
  assert.equal(vm.runInContext('extraVisitDateRows[1].endInput.value', a.context), '2026-09-12');
  assert.equal(a.els.get('visitedCount').textContent, 1, '複数日でも制覇数は1自治体');
});

test('an empty date row is ignored and an added date can be deleted', async () => {
  const a = start({}); await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  a.els.get('recordStatus').value = 'visited';
  a.els.get('addVisitDateButton').events.click();
  vm.runInContext('extraVisitDateRows[0].startInput.value = "2026-05-03"', a.context);
  a.els.get('additionalVisitDates').children[0].children[1].events.click();
  assert.equal(a.els.get('additionalVisitDates').children.length, 0);
  a.els.get('addVisitDateButton').events.click(); // 空行のまま保存
  a.els.get('recordForm').events.submit({preventDefault(){}});
  const saved=JSON.parse(a.localStore.get('municipality-conquest-records-v1'))['131016'];
  assert.equal(saved.date, '');
  assert.equal(saved.visitDates, undefined);
});

test('an invalid long-stay range cannot overwrite an existing record', async () => {
  const old={'131016':{status:'visited',date:'2024-01-01',memo:'大切なメモ'}};
  const a=start(old); await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  a.els.get('addVisitPeriodButton').events.click();
  vm.runInContext('extraVisitDateRows[0].startInput.value = "2026-09-08"', a.context);
  vm.runInContext('extraVisitDateRows[0].endInput.value = "2026-09-03"', a.context);
  a.els.get('recordForm').events.submit({preventDefault(){}});
  assert.equal(a.els.get('recordDialog').isOpen, true, '不正な入力なら画面を閉じない');
  assert.equal(a.writes.length, 0, '保存データを書き換えない');
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')), old);
  assert.ok(a.alerts.length);
});

test('JSON import preserves new multi-date and stay formats alongside legacy dates', async () => {
  const a=start({'131016':{status:'visited',date:'2025-02-01',memo:'old'}}); await wait();
  const imported={records:{
    '131016':{status:'visited',date:'2026-06-01',memo:'滞在',visitDates:[
      {start:'2026-06-01',end:'2026-06-14'},{start:'2026-07-03',end:''}]},
    '131041':{status:'passed',date:'2024-02-12',memo:'従来形式'}
  }};
  await a.els.get('importInput').events.change({target:{files:[{text:async()=>JSON.stringify(imported)}],value:'file'}});
  const saved=JSON.parse(a.localStore.get('municipality-conquest-records-v1'));
  assert.deepEqual(saved['131016'].visitDates, imported.records['131016'].visitDates);
  assert.equal(saved['131041'].date, '2024-02-12');
  assert.equal(saved['131041'].visitDates, undefined);
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  assert.equal(a.els.get('recordDate').value, '2026-07-03');
  assert.equal(vm.runInContext('extraVisitDateRows[0].endInput.value', a.context), '2026-06-14');
  assert.ok(a.localStore.get('municipality-conquest-before-import-v1'));
});

test('import does not erase records if a multi-date entry is malformed', async () => {
  const old={'131016':{status:'visited',date:'2022-01-02',memo:'retain'}};
  const a=start(old); await wait();
  const imported={records:{'131016':{status:'visited',date:'',memo:'',visitDates:[{start:'2026-07-10',end:'2026-07-01'}]}}};
  await a.els.get('importInput').events.change({target:{files:[{text:async()=>JSON.stringify(imported)}],value:'file'}});
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')), old);
  assert.equal(a.writes.length, 0);
  assert.ok(a.alerts.length);
});

test('changing a visited place to unvisited removes its dates but keeps its memo', async () => {
  const old={'131016':{status:'visited',date:'2026-06-01',memo:'思い出',visitDates:[
    {start:'2026-06-01',end:'2026-06-14'}]}};
  const a=start(old); await wait();
  vm.runInContext('openRecordDialog(municipalities.find(m=>m.name==="千代田区"))', a.context);
  a.els.get('recordStatus').value='unvisited';
  a.els.get('recordForm').events.submit({preventDefault(){}});
  const saved=JSON.parse(a.localStore.get('municipality-conquest-records-v1'))['131016'];
  assert.equal(saved.status,'unvisited');
  assert.equal(saved.date,'');
  assert.equal(saved.visitDates,undefined);
  assert.equal(saved.memo,'思い出');
});


test('history remains empty until a category is chosen, even if a search is typed', async () => {
  assert.match(html, /<select id="historyStatusFilter">\s*<option value="">カテゴリーを選択<\/option>/);
  const initial = {
    '131016': {status:'visited', date:'2026-01-01', memo:'keep'},
    '131041': {status:'passed', date:'', memo:'keep too'}
  };
  const a=start(initial); await wait();
  const list=a.els.get('historyList');
  const category=a.els.get('historyStatusFilter');
  assert.equal(category.value, '');
  assert.equal(list.children.length, 0);
  assert.equal(a.els.get('historyBadge').textContent, '—');
  assert.match(a.els.get('historySummary').textContent,/カテゴリーを選択/);
  assert.equal(a.els.get('historyEmpty').hidden, true);
  assert.equal(a.els.get('historyMoreButton').hidden, true);

  a.els.get('historySearch').value='千代田';
  a.els.get('historySearch').events.input();
  assert.equal(list.children.length, 0, 'search alone must not open the list');
  category.value='visited'; category.events.change();
  assert.equal(list.children.length, 1, 'category selection applies any typed search');
  category.value=''; category.events.change();
  assert.equal(list.children.length, 0, 'clearing category hides results again');
  assert.equal(a.els.get('historyMoreButton').hidden, true);
  assert.equal(a.els.get('historyEmpty').hidden, true);
  assert.equal(a.els.get('historyBadge').textContent,'—');
  assert.equal(a.writes.length, 0);
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')), initial);
});

test('history category selection filters visited, passed, all, then hides when cleared', async () => {
  const initial={
    '131016':{status:'visited',date:'2026-10-01',memo:''},
    '131041':{status:'passed',date:'2026-10-02',memo:''}
  };
  const a=start(initial); await wait();
  const category=a.els.get('historyStatusFilter');
  for (const [choice,expected,label] of [['visited',1,'訪問'],['passed',1,'通過'],['all',2,'両方'],['',0,'未選択']]) {
    category.value=choice; category.events.change();
    assert.equal(a.els.get('historyList').children.length,expected,label);
  }
  assert.equal(a.writes.length,0);
});

test('history is sorted by visit date and includes periods, multiple days and undated visits', async () => {
  const originals = {
    '131016': { status:'visited', date:'2026-01-01', memo:'hotel', visitDates:[
      {start:'2026-01-01',end:''}, {start:'2026-10-01',end:'2026-10-06'}] },
    '131041': { status:'passed', date:'2026-07-04', memo:'train'},
    '131130': { status:'visited', date:'', memo:'unknown'}
  };
  const a=start(originals);await wait();
  const history = Array.from(vm.runInContext('getHistoryEntries()', a.context));
  assert.deepEqual(history.map(x=>x.start), ['2026-10-01','2026-07-04','2026-01-01','']);
  assert.equal(a.els.get('historyList').children.length,0, 'no category selected');
  a.els.get('historyStatusFilter').value='all';
  a.els.get('historyStatusFilter').events.change();
  assert.equal(a.els.get('historyBadge').textContent, '4 件');
  assert.equal(a.els.get('historyList').children[0].children[0].children[0].textContent, '2026年10月1日 〜 2026年10月6日');
  assert.equal(a.els.get('historyList').children[3].children[0].children[0].textContent, '日付未設定');
  assert.equal(a.writes.length, 0, 'opening the history must not change stored data');
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')), originals);
});

test('history filters work and editing a history card opens the existing dialog', async () => {
  const a=start({'131016':{status:'visited',date:'',memo:'old'},'131041':{status:'passed',date:'2026-10-02',memo:''}});await wait();
  a.els.get('historyStatusFilter').value='passed';
  a.els.get('historyStatusFilter').events.change();
  assert.equal(a.els.get('historyList').children.length,1);
  a.els.get('historyList').children[0].children[1].children[1].events.click();
  assert.equal(a.els.get('recordCode').value,'131041');
  assert.equal(a.els.get('recordDialog').isOpen,true);
  a.els.get('historySearch').value='該当なし';
  a.els.get('historySearch').events.input();
  assert.equal(a.els.get('historyList').children.length,0);
  assert.equal(a.els.get('historyEmpty').hidden,false);
});

test('history shows first 30 items and loads another page without changing records', async () => {
  const initial={};
  for(let i=0;i<40;i++) initial[String(800000+i)]={status:'visited',date:'2026-10-01',memo:''};
  const a=start(initial);await wait();
  assert.equal(a.els.get('historyList').children.length,0);
  a.els.get('historyStatusFilter').value='all';
  a.els.get('historyStatusFilter').events.change();
  assert.equal(a.els.get('historyList').children.length,30);
  assert.equal(a.els.get('historyMoreButton').hidden,false);
  a.els.get('historyMoreButton').events.click();
  assert.equal(a.els.get('historyList').children.length,40);
  assert.equal(a.els.get('historyMoreButton').hidden,true);
  assert.equal(a.writes.length,0);
});

test('reset creates a separate recovery snapshot and restores original dates and memos', async () => {
  const original={'131016':{status:'visited',date:'2026-10-01',visitDates:[{start:'2026-10-01',end:''},{start:'2026-10-10',end:'2026-10-12'}],memo:'stay'}};
  const a=start(original);await wait();
  a.els.get('historyStatusFilter').value='all';
  a.els.get('historyStatusFilter').events.change();
  a.els.get('resetButton').events.click();
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')),{});
  const snapshot=JSON.parse(a.localStore.get('municipality-conquest-before-reset-v1'));
  assert.deepEqual(JSON.parse(snapshot.recordsRaw),original);
  assert.equal(a.els.get('restoreBeforeResetButton').disabled,false);
  a.els.get('restoreBeforeResetButton').events.click();
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')),original);
  assert.equal(a.els.get('historyList').children.length,2);
});

test('empty reset does not overwrite a previous recovery snapshot', async () => {
  const a=start({'131016':{status:'visited',date:'2026-01-01',memo:''}});await wait();
  a.els.get('resetButton').events.click();
  const snapshot=a.localStore.get('municipality-conquest-before-reset-v1');
  a.els.get('resetButton').events.click();
  assert.equal(a.localStore.get('municipality-conquest-before-reset-v1'),snapshot);
});

test('backup export timestamp is a record of an attempted download and uses a unique time filename', async () => {
  const a=start({'131016':{status:'visited',date:'',memo:''}});await wait();
  a.els.get('exportButton').events.click();
  const marker=JSON.parse(a.localStore.get('municipality-conquest-last-export-v1'));
  assert.equal(marker.count,1);
  assert.ok(Number.isFinite(Date.parse(marker.at)));
  assert.match(a.els.get('lastExportStatus').textContent,/書き出し操作/);
  assert.equal(a.localStore.get('municipality-conquest-records-v1'),JSON.stringify({'131016':{status:'visited',date:'',memo:''}}));
});


test('100-percent color setting defaults to ON and persists separately without changing visit records', async () => {
  const initial = {'131016':{status:'visited',date:'2026-01-01',memo:'kept'}};
  const a = start(initial); await wait();
  assert.equal(a.els.get('highlightCompletedToggle').checked,true);
  assert.equal(a.els.get('mapTopBandLabel').textContent,'75～99%');
  assert.equal(a.els.get('mapPerfectLegendItem').hidden,false);
  const key='municipality-conquest-perfect-prefecture-color-v1';
  a.els.get('highlightCompletedToggle').events.change({target:{checked:false}});
  assert.equal(a.localStore.get(key),'off');
  assert.equal(a.els.get('mapPerfectLegendItem').hidden,true);
  assert.equal(a.els.get('mapTopBandLabel').textContent,'75～100%');
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')),initial);
  a.els.get('highlightCompletedToggle').events.change({target:{checked:true}});
  assert.equal(a.localStore.get(key),'on');
  assert.equal(a.els.get('mapPerfectLegendItem').hidden,false);
  assert.deepEqual(JSON.parse(a.localStore.get('municipality-conquest-records-v1')),initial);
});
