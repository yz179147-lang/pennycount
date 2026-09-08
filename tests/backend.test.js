/*
 * 後端邏輯測試：用假的 Google Apps Script 服務（試算表、屬性、UrlFetch…）
 * 直接載入 apps-script/*.gs 執行，不需要真的部署。
 *
 *   node tests/backend.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- 假的 GAS 服務 ----
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const row = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = row[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.rows.length <= idx) this.sheet.rows.push([]);
      line.forEach((v, c) => { this.sheet.rows[idx][this.col - 1 + c] = v; });
    });
    return this;
  }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.reads = 0; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  getRange(a, b, c, d) {
    this.reads += 1;   // 用來驗證快取真的有擋下重複的讀取
    if (typeof a === 'string') return new FakeRange(this, 1, 1, Math.max(this.rows.length, 1), 26);
    return new FakeRange(this, a, b, c, d);
  }
  appendRow(values) { this.rows.push(values.slice()); return this; }
  deleteRow(index) { this.rows.splice(index - 1, 1); return this; }
  setFrozenRows() { return this; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getName() { return 'Test Book'; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { this.sheets[name] = new FakeSheet(name); return this.sheets[name]; }
}

const book = new FakeSpreadsheet();
const cacheStore = new Map();
const props = {};
let uuidSeed = 0;

const sandbox = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => book,
    openById: () => book,
    getUi: () => { throw new Error('no ui'); },
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    }),
  },
  Session: {
    getScriptTimeZone: () => 'Asia/Taipei',
    getActiveUser: () => ({ getEmail: () => 'tester@example.com' }),
  },
  LockService: {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  },
  // 有 TTL 行為的假快取，才能真的驗證「寫入後會失效」
  CacheService: {
    getScriptCache: () => ({
      get(key) {
        const hit = cacheStore.get(key);
        if (!hit) return null;
        if (hit.expires <= Date.now()) { cacheStore.delete(key); return null; }
        return hit.value;
      },
      put(key, value, seconds) {
        cacheStore.set(key, { value, expires: Date.now() + (seconds || 600) * 1000 });
      },
      remove(key) { cacheStore.delete(key); },
    }),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
  },
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 1 },
    createHtmlOutput: (html) => ({ html, setXFrameOptionsMode() { return this; } }),
  },
  UrlFetchApp: {
    fetch: (url, options) => {
      sandbox.__sent.push({ url, payload: JSON.parse(options.payload) });
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    },
  },
  Utilities: {
    // 要像真的 UUID 一樣「前幾碼就不同」，否則 newId_() 取前 8 碼會全部撞在一起
    getUuid: () => {
      const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
      uuidSeed++;
      return [hex(8), hex(4), hex(4), hex(4), hex(12)].join('-');
    },
    formatDate: (date, tz, fmt) => {
      // 測試用簡化版：以本地時間格式化
      const p = (n) => String(n).padStart(2, '0');
      const map = {
        'yyyy-MM-dd': `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`,
        'yyyy-MM': `${date.getFullYear()}-${p(date.getMonth() + 1)}`,
        'yyyy': String(date.getFullYear()),
      };
      if (!(fmt in map)) throw new Error('unsupported format ' + fmt);
      return map[fmt];
    },
  },
  __sent: [],
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const dir = path.join(__dirname, '..', 'apps-script');
['Config', 'Util', 'Store', 'Parser', 'Api', 'Line', 'WebApp', 'Setup'].forEach((name) => {
  const code = fs.readFileSync(path.join(dir, name + '.gs'), 'utf8');
  vm.runInContext(code, sandbox, { filename: name + '.gs' });
});

// ---- 測試 ----
let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log('  ✓ ' + label);
  } else {
    failures++;
    console.log('  ✗ ' + label + '\n      得到 ' + a + '\n      預期 ' + e);
  }
}

const run = (src) => vm.runInContext(src, sandbox);
const today = run('today_()');
const yesterday = run('shiftDays_(-1)');
const year = today.slice(0, 4);

console.log('\n[Parser]');
check('午餐 120', run("parseMessage_('午餐 120')"),
  { kind: 'record', record: { date: today, type: 'expense', category: '餐飲', amount: 120, note: '午餐' } });
check('星巴克 大杯拿鐵 180', run("parseMessage_('星巴克 大杯拿鐵 180')").record.category, '餐飲');
check('數字黏著 晚餐250', run("parseMessage_('晚餐250')").record.amount, 250);
check('+45000 薪水', run("parseMessage_('+45000 薪水')").record,
  { date: today, type: 'income', category: '薪水', amount: 45000, note: '薪水' });
check('收入 30000 接案', run("parseMessage_('收入 30000 接案')").record.type, 'income');
check('昨天 加油 800 → 日期', run("parseMessage_('昨天 加油 800')").record.date, yesterday);
check('昨天 加油 800 → 分類', run("parseMessage_('昨天 加油 800')").record.category, '交通');
check('9/1 房租 15000', run("parseMessage_('9/1 房租 15000')").record,
  { date: year + '-09-01', type: 'expense', category: '居住', amount: 15000, note: '房租' });
check('#教育 1200 線上課程', run("parseMessage_('#教育 1200 線上課程')").record.category, '教育');
check('千分位 1,250 電腦', run("parseMessage_('買電腦 1,250')").record.amount, 1250);
check('去掉「元」', run("parseMessage_('計程車 320元')").record.note, '計程車');
check('本月 → 指令', run("parseMessage_('本月')"), { kind: 'month' });
check('刪除 abcd1234', run("parseMessage_('刪除 abcd1234')"), { kind: 'delete', id: 'abcd1234' });
check('收回', run("parseMessage_('收回')"), { kind: 'undo' });
check('沒有數字 → unknown', run("parseMessage_('哈囉')").kind, 'unknown');

console.log('\n[Store]');
run("setup()");
const created = run("createRecord({date:'" + today + "',type:'expense',category:'餐飲',amount:120,note:'午餐'},{source:'web',user:'me'})");
check('新增後可查到', run("queryRecords({}).total"), 1);
check('金額正確', created.amount, 120);
check('id 長度 8', created.id.length, 8);
run("createRecord({date:'" + today + "',type:'income',category:'薪水',amount:50000},{source:'line',user:'U1'})");
check('收支統計', run("(function(){var s=summarize({});return [s.expense,s.income,s.balance,s.count];})()"), [120, 50000, 49880]. concat([2]));
check('依 type 篩選', run("queryRecords({type:'income'}).total"), 1);
check('關鍵字搜尋', run("queryRecords({keyword:'午餐'}).total"), 1);
check('更新金額', run("updateRecord('" + created.id + "',{amount:150}).amount"), 150);
check('寬鬆日期 9/5', run("updateRecord('" + created.id + "',{date:'9/5'}).date"), year + '-09-05');
check('刪除後剩 1 筆', run("(function(){deleteRecord('" + created.id + "');return queryRecords({}).total;})()"), 1);
check('刪除不存在會報錯', run("(function(){try{deleteRecord('zzzz');}catch(e){return e.code;}})()"), 'NOT_FOUND');
check('金額 0 會報錯', run("(function(){try{createRecord({amount:0,category:'x'},{});}catch(e){return e.code;}})()"), 'BAD_REQUEST');
check('分類清單有預設值', run("listCategories().length > 5"), true);
check('月份篩選 month 參數', run("queryRecords({month:'" + today.slice(0, 7) + "'}).total"), 1);
check('前月份沒有資料', run("queryRecords({month:'2000-01'}).total"), 0);

console.log('\n[Api]');
props.API_TOKEN = 'secret';
check('沒帶 token 被擋', run("handleApi_({action:'ping'}).error.code"), 'UNAUTHORIZED');
check('帶對 token 可用', run("handleApi_({action:'ping',token:'secret'}).ok"), true);
check('未知 action', run("handleApi_({action:'nope',token:'secret'}).error.code"), 'UNKNOWN_ACTION');
check('addRecord 走 API', run("handleApi_({action:'addRecord',token:'secret',amount:88,category:'餐飲',note:'測試'}).data.amount"), 88);
check('listRecords 走 API', run("handleApi_({action:'listRecords',token:'secret'}).data.total"), 2);
check('GET 不能寫入', run("(function(){var r=doGet({parameter:{action:'addRecord',token:'secret',amount:5}});return JSON.parse(r.text).error.code;})()"), 'METHOD_NOT_ALLOWED');
check('GET 唯讀可用', run("(function(){var r=doGet({parameter:{action:'listCategories',token:'secret'}});return JSON.parse(r.text).ok;})()"), true);

console.log('\n[LINE]');
props.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
props.LINE_HOOK_KEY = 'hookkey';
props.LINE_ALLOWED_USER_IDS = 'U-allowed';
sandbox.__sent.length = 0;
run(`doPost({
  parameter: { route: 'line', key: 'hookkey' },
  postData: { contents: JSON.stringify({ events: [
    { type: 'message', replyToken: 'r1', source: { userId: 'U-allowed' }, message: { type: 'text', text: '午餐 120' } }
  ] }) }
})`);
check('回覆了一則訊息', sandbox.__sent.length, 1);
check('回覆內容含「已記帳」', /已記帳/.test(sandbox.__sent[0].payload.messages[0].text), true);
check('LINE 寫入成功', run("queryRecords({keyword:'午餐'}).total"), 1);

sandbox.__sent.length = 0;
run(`doPost({
  parameter: { route: 'line', key: 'hookkey' },
  postData: { contents: JSON.stringify({ events: [
    { type: 'message', replyToken: 'r2', source: { userId: 'U-stranger' }, message: { type: 'text', text: '午餐 120' } }
  ] }) }
})`);
check('非白名單被拒絕', /沒有開放/.test(sandbox.__sent[0].payload.messages[0].text), true);

sandbox.__sent.length = 0;
run(`doPost({
  parameter: { route: 'line', key: 'wrong' },
  postData: { contents: JSON.stringify({ events: [
    { type: 'message', replyToken: 'r3', source: { userId: 'U-allowed' }, message: { type: 'text', text: '午餐 120' } }
  ] }) }
})`);
check('key 錯誤不處理', sandbox.__sent.length, 0);

sandbox.__sent.length = 0;
run(`doPost({
  parameter: { route: 'line', key: 'hookkey' },
  postData: { contents: JSON.stringify({ events: [
    { type: 'message', replyToken: 'r4', source: { userId: 'U-allowed' }, message: { type: 'text', text: '本月' } }
  ] }) }
})`);
check('本月統計有回覆', /📊/.test(sandbox.__sent[0].payload.messages[0].text), true);

sandbox.__sent.length = 0;
run(`doPost({
  parameter: { route: 'line', key: 'hookkey' },
  postData: { contents: JSON.stringify({ events: [
    { type: 'message', replyToken: 'r5', source: { userId: 'U-allowed' }, message: { type: 'text', text: '收回' } }
  ] }) }
})`);
check('收回刪掉自己最後一筆', /已刪除最後一筆/.test(sandbox.__sent[0].payload.messages[0].text), true);
check('刪除後 LINE 紀錄歸零', run("queryRecords({keyword:'午餐'}).total"), 0);

console.log('\n[分類 CRUD]');
const brunch = run("createCategory({type:'expense',name:'早午餐',icon:'🥐',keywords:'brunch, 早午餐 ,蛋餅'})");
check('新增分類', [brunch.name, brunch.icon, brunch.keywords], ['早午餐', '🥐', ['brunch', '早午餐', '蛋餅']]);
check('分類 id 有值', brunch.id.length > 1, true);
check('重複新增回傳既有的', run("createCategory({type:'expense',name:'早午餐'}).id"), brunch.id);
check('名稱空白會擋', run("(function(){try{createCategory({type:'expense',name:'  '});}catch(e){return e.code;}})()"), 'BAD_REQUEST');
check('名稱過長會擋', run("(function(){try{createCategory({type:'expense',name:'一二三四五六七八九十十一十二十三'});}catch(e){return e.code;}})()"), 'BAD_REQUEST');
check('自訂分類出現在清單', run("listCategories().filter(function(c){return c.name==='早午餐';}).length"), 1);

// 自訂分類的關鍵字要立刻在 LINE 解析生效
check('自訂關鍵字可分類', run("parseMessage_('蛋餅 55').record.category"), '早午餐');
check('分類名稱本身可分類', run("parseMessage_('早午餐 180').record.category"), '早午餐');

const r1 = run("createRecord({date:'" + today + "',type:'expense',category:'早午餐',amount:180,note:'蛋餅'},{source:'web'})");
check('改名會一併改掉舊紀錄', run("updateCategory('" + brunch.id + "',{name:'早餐店'}).renamedRecords"), 1);
check('舊紀錄已換成新名稱', run("getRecord('" + r1.id + "').category"), '早餐店');
check('改圖示', run("updateCategory('" + brunch.id + "',{icon:'🍳'}).icon"), '🍳');
check('設定預算', run("updateCategory('" + brunch.id + "',{budget:3000}).budget"), 3000);
check('改成重複名稱會擋', run("(function(){try{updateCategory('" + brunch.id + "',{name:'餐飲'});}catch(e){return e.code;}})()"), 'CONFLICT');
check('分類使用次數', run("categoryUsage()['expense|早餐店']"), 1);

check('排序', run(`(function(){
  var ids = listCategories().filter(function(c){return c.type==='expense';}).map(function(c){return c.id;});
  var reordered = ids.slice().reverse();
  reorderCategories(reordered);
  var after = listCategories().filter(function(c){return c.type==='expense';}).map(function(c){return c.id;});
  return after[0] === reordered[0];
})()`), true);

check('刪除分類會把紀錄搬到「其他」', run("deleteCategory('" + brunch.id + "').movedRecords"), 1);
check('搬移後紀錄分類是「其他」', run("getRecord('" + r1.id + "').category"), '其他');
check('分類已消失', run("listCategories().filter(function(c){return c.name==='早餐店';}).length"), 0);
check('刪不存在的分類', run("(function(){try{deleteCategory('nope');}catch(e){return e.code;}})()"), 'NOT_FOUND');
run("deleteRecord('" + r1.id + "')");

console.log('\n[統計 analytics]');
// 用一個未來的月份，才不會被前面測試留下的資料干擾
const thisMonth = '2099-03';
const lastMonth = '2099-02';
run(`(function(){
  createRecord({date:'${thisMonth}-02',type:'expense',category:'餐飲',amount:100,note:'早餐'},{source:'web'});
  createRecord({date:'${thisMonth}-02',type:'expense',category:'交通',amount:60,note:'捷運'},{source:'web'});
  createRecord({date:'${thisMonth}-03',type:'expense',category:'餐飲',amount:200,note:'早餐'},{source:'web'});
  createRecord({date:'${thisMonth}-03',type:'income',category:'薪水',amount:50000},{source:'web'});
  createRecord({date:'${lastMonth}-10',type:'expense',category:'餐飲',amount:500},{source:'web'});
})()`);
const stats = run("analytics({month:'" + thisMonth + "',months:3})");
check('本月支出總額', stats.totals.expense, 360);
check('本月收入總額', stats.totals.income, 50000);
check('上月支出可比較', stats.previous.expense, 500);
check('分類排行第一名是餐飲', stats.categories[0].category, '餐飲');
check('分類佔比', stats.categories[0].share, 83.3);
check('分類含圖示', stats.categories[0].icon, '🍜');
check('月度序列長度', stats.monthly.length, 3);
check('每日序列 = 當月天數', stats.daily.length, run("daysInMonth_('" + thisMonth + "')"));
check('累積支出最後一天 = 總額', stats.cumulative.current[stats.cumulative.current.length - 1], 360);
check('星期分布有 7 天', stats.weekday.length, 7);
check('常買項目合併同備註', stats.topNotes.filter((n) => n.note === '早餐')[0].count, 2);
check('日均有算出來', stats.totals.avgPerDay > 0, true);
check('最大單筆', stats.totals.largest.amount, 200);
check('記帳天數', stats.totals.activeDays, 2);

run("updateCategory(listCategories().filter(function(c){return c.name==='餐飲';})[0].id,{budget:250})");
const budgeted = run("analytics({month:'" + thisMonth + "',months:2})");
check('預算進度', [budgeted.budgets[0].spent, budgeted.budgets[0].pct, budgeted.budgets[0].status], [300, 120, 'critical']);

console.log('\n[LINE 分類指令]');
const lineSay = (text) => {
  sandbox.__sent.length = 0;
  run(`doPost({
    parameter: { route: 'line', key: 'hookkey' },
    postData: { contents: JSON.stringify({ events: [
      { type: 'message', replyToken: 'r', source: { userId: 'U-allowed' },
        message: { type: 'text', text: ${JSON.stringify(text)} } }
    ] }) }
  })`);
  return sandbox.__sent[0] ? sandbox.__sent[0].payload.messages[0].text : '';
};

check('分類清單', /🏷️ 分類清單/.test(lineSay('分類')), true);
check('新增分類（emoji 在前）', /已新增支出分類/.test(lineSay('新增分類 🍔 早午餐')), true);
check('新增後真的存在', run("listCategories().filter(function(c){return c.name==='早午餐';})[0].icon"), '🍔');
check('新增分類（emoji 在後）', run("(function(){return parseMessage_('新增分類 消夜 🌙').category;})()"),
  { type: 'expense', name: '消夜', icon: '🌙' });
check('新增收入分類', run("parseMessage_('新增收入分類 💰 股利').category.type"), 'income');
check('用新分類記帳', /早午餐/.test(lineSay('早午餐 250')), true);
check('設定預算', /已設定預算/.test(lineSay('預算 早午餐 3000')), true);
check('預算真的寫進去', run("findCategoryByName('早午餐','expense').budget"), 3000);
check('預算進度查詢', /🎯 本月預算/.test(lineSay('預算')), true);
check('消費習慣分析', /🔍 消費習慣/.test(lineSay('分析')), true);
check('記帳回覆帶預算進度', /早午餐/.test(lineSay('早午餐 100')), true);
check('刪除分類', /已刪除分類/.test(lineSay('刪除分類 早午餐')), true);
check('刪除分類後紀錄搬家', run("queryRecords({category:'早午餐'}).total"), 0);
check('刪除不存在的分類會提示', /找不到分類/.test(lineSay('刪除分類 不存在的類')), true);

console.log('\n[讀取快取]');
const recordsSheet = () => book.sheets['Records'];

// 同樣的查詢第二次不該再去讀試算表
run("queryRecords({month:'" + thisMonth + "'})");
const readsBefore = recordsSheet().reads;
run("queryRecords({month:'" + thisMonth + "'})");
check('相同查詢會命中快取', recordsSheet().reads === readsBefore, true);

// month 與等價的 from/to 應該是同一份快取
run("queryRecords({from:'" + thisMonth + "-01',to:'" + thisMonth + "-31'})");
check('month 與 from/to 命中同一份', recordsSheet().reads === readsBefore, true);

// 寫入之後一定要看到新資料（版本號換掉 = 全部失效）
const cacheProbe = run("createRecord({date:'" + thisMonth + "-04',type:'expense',category:'餐飲',amount:77,note:'快取測試'},{source:'web'})");
check('寫入後讀得到新資料', run("queryRecords({month:'" + thisMonth + "',keyword:'快取測試'}).total"), 1);
check('寫入後統計跟著更新', run("analytics({month:'" + thisMonth + "'}).totals.expense"), 437);

// 從 LINE 寫入也要讓網頁端的快取失效
lineSay('2099/03/04 快取同步測試 23');
check('LINE 寫入後網頁讀得到', run("queryRecords({month:'" + thisMonth + "',keyword:'快取同步測試'}).total > 0"), true);

run("deleteRecord('" + cacheProbe.id + "')");
check('刪除後統計也跟著回去', run("analytics({month:'" + thisMonth + "'}).totals.expense"), 383);

// 分類異動同樣要失效
const cacheCat = run("createCategory({type:'expense',name:'快取分類'})");
check('新增分類後清單立刻有', run("listCategories().filter(function(c){return c.name==='快取分類';}).length"), 1);
run("updateCategory('" + cacheCat.id + "',{icon:'🧪'})");
check('改圖示後清單立刻更新', run("findCategoryByName('快取分類','expense').icon"), '🧪');
run("deleteCategory('" + cacheCat.id + "')");
check('刪除後清單立刻沒有', run("listCategories().filter(function(c){return c.name==='快取分類';}).length"), 0);

check('太大的結果不進快取也不會壞', run(`(function(){
  var big = queryRecords({ limit: 500 });
  return big.items.length >= 0;
})()`), true);

console.log('\n[POST JSON API]');
check('text/plain body', run("(function(){var r=doPost({parameter:{},postData:{contents:JSON.stringify({action:'ping',token:'secret'})}});return JSON.parse(r.text).ok;})()"), true);
check('analytics 走 API', run("handleApi_({action:'analytics',token:'secret',month:'" + thisMonth + "'}).data.totals.expense > 0"), true);
check('addCategory 走 API', run("handleApi_({action:'addCategory',token:'secret',type:'expense',name:'寵物',icon:'🐶'}).data.name"), '寵物');
check('updateCategory 走 API', run(`(function(){
  var id = findCategoryByName('寵物','expense').id;
  return handleApi_({action:'updateCategory',token:'secret',id:id,icon:'🐱'}).data.icon;
})()`), '🐱');
check('deleteCategory 走 API', run(`(function(){
  var id = findCategoryByName('寵物','expense').id;
  return handleApi_({action:'deleteCategory',token:'secret',id:id}).ok;
})()`), true);

console.log(failures ? `\n❌ ${failures} 項失敗\n` : '\n✅ 全部通過\n');
process.exit(failures ? 1 : 0);
