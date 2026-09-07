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
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  getRange(a, b, c, d) {
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
    getUuid: () => 'uuid' + String(++uuidSeed).padStart(4, '0') + '-aaaa-bbbb-cccc-dddddddddddd',
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

console.log('\n[POST JSON API]');
check('text/plain body', run("(function(){var r=doPost({parameter:{},postData:{contents:JSON.stringify({action:'ping',token:'secret'})}});return JSON.parse(r.text).ok;})()"), true);

console.log(failures ? `\n❌ ${failures} 項失敗\n` : '\n✅ 全部通過\n');
process.exit(failures ? 1 : 0);
