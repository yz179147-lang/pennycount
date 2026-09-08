/**
 * 一次性的安裝與維護工具。
 * 在 Apps Script 編輯器選 setup 然後按「執行」，就會把試算表準備好。
 */

/** 建立工作表、寫入預設分類、產生 API_TOKEN。可重複執行，不會弄壞既有資料。 */
function setup() {
  const records = getTable_(CONFIG.SHEET_RECORDS, RECORD_FIELDS);
  records.sheet.setFrozenRows(1);
  // 日期存文字，避免不同時區開啟時整批位移一天
  records.sheet.getRange(1, records.index.date + 1, records.sheet.getMaxRows(), 1).setNumberFormat('@');
  records.sheet.getRange(2, records.index.amount + 1, records.sheet.getMaxRows() - 1, 1).setNumberFormat('#,##0.00');

  getTable_(CONFIG.SHEET_LOGS, LOG_FIELDS).sheet.setFrozenRows(1);

  const table = getTable_(CONFIG.SHEET_CATEGORIES, CATEGORY_FIELDS);
  table.sheet.setFrozenRows(1);
  seedCategories_(table);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_TOKEN')) {
    props.setProperty('API_TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 24));
  }
  if (!props.getProperty('LINE_HOOK_KEY')) {
    props.setProperty('LINE_HOOK_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }

  const summary =
    '安裝完成 ✅\n\n' +
    '試算表：' + getSpreadsheet_().getName() + '\n' +
    '時區：' + scriptTimeZone_() + '\n' +
    '分類：' + listCategories().length + ' 個\n\n' +
    'API_TOKEN（前端首次開啟時要輸入）：\n' + props.getProperty('API_TOKEN') + '\n\n' +
    'LINE_HOOK_KEY（webhook 網址的 key 參數）：\n' + props.getProperty('LINE_HOOK_KEY') + '\n\n' +
    '接著到「部署 → 新增部署作業 → 網頁應用程式」，\n' +
    '執行身分選「我」，存取權選「任何人」，把網址填進前端的設定。';

  console.log(summary);
  try {
    SpreadsheetApp.getUi().alert(summary);
  } catch (err) {
    // 從編輯器直接執行時沒有 UI，忽略即可
  }
  return summary;
}

/** 寫入預設分類；已經有同名分類就跳過，所以重跑 setup 不會產生重複。 */
function seedCategories_(table) {
  const existing = {};
  readTable_(table).forEach(function (row) {
    existing[normalizeType_(row.type) + '|' + String(row.name).trim()] = true;
  });

  DEFAULT_CATEGORIES.forEach(function (category) {
    if (existing[category.type + '|' + category.name]) return;
    appendRow_(table, {
      id: 'c' + newId_().slice(0, 6),
      type: category.type,
      name: category.name,
      icon: category.icon,
      order: category.order,
      keywords: (category.keywords || []).join(','),
      budget: category.budget || 0,
      archived: false,
    });
  });
}

/** 在試算表上加一個自訂選單，方便日後查金鑰。 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PennyCount')
      .addItem('初始化 / 修復工作表', 'setup')
      .addItem('顯示金鑰與網址', 'showKeys')
      .addItem('寫入示範資料', 'seedDemoData')
      .addToUi();
  } catch (err) {
    console.error(err);
  }
}

function showKeys() {
  const props = PropertiesService.getScriptProperties();
  const text =
    'API_TOKEN：\n' + (props.getProperty('API_TOKEN') || '（尚未設定，請先執行 setup）') + '\n\n' +
    'LINE_HOOK_KEY：\n' + (props.getProperty('LINE_HOOK_KEY') || '（尚未設定）') + '\n\n' +
    '前端網址（WEB_APP_URL）：\n' + (props.getProperty('WEB_APP_URL') || '（未設定）');
  SpreadsheetApp.getUi().alert(text);
}

/** 塞三個月的假資料，方便驗證統計圖表。 */
function seedDemoData() {
  const samples = [
    ['餐飲', 120, '午餐'], ['餐飲', 65, '早餐'], ['餐飲', 180, '咖啡'],
    ['交通', 30, '捷運'], ['交通', 800, '加油'], ['交通', 250, '計程車'],
    ['購物', 890, '日用品'], ['購物', 1580, '衣服'],
    ['娛樂', 390, '電影'], ['娛樂', 270, '訂閱'],
    ['醫療', 450, '看診'], ['教育', 620, '書'],
  ];

  for (let day = 0; day < 92; day++) {
    const date = shiftDays_(-day);
    const count = Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const sample = samples[Math.floor(Math.random() * samples.length)];
      createRecord({
        date: date,
        type: 'expense',
        category: sample[0],
        amount: Math.round(sample[1] * (0.7 + Math.random() * 0.6)),
        note: sample[2],
      }, { source: 'sheet', user: 'demo' });
    }
    // 每月 5 號房租與薪水
    if (date.slice(8) === '05') {
      createRecord({ date: date, type: 'expense', category: '居住', amount: 15000, note: '房租' },
        { source: 'sheet', user: 'demo' });
      createRecord({ date: date, type: 'income', category: '薪水', amount: 52000, note: '月薪' },
        { source: 'sheet', user: 'demo' });
    }
  }
}

/** 不必部署就能驗證後端邏輯：在編輯器執行，看「執行紀錄」。 */
function runSelfTest() {
  const cases = [
    '午餐 120',
    '星巴克 大杯拿鐵 180',
    '+45000 薪水',
    '昨天 加油 800',
    '9/1 房租 15000',
    '#教育 1200 線上課程',
    '本月',
    '分類',
    '新增分類 🍔 早午餐',
    '預算 餐飲 8000',
    '刪除 abcd1234',
    '哈囉',
  ];
  cases.forEach(function (text) {
    console.log(text + '  →  ' + JSON.stringify(parseMessage_(text)));
  });

  const created = createRecord(
    { date: today_(), type: 'expense', category: '測試', amount: 1, note: 'self test' },
    { source: 'sheet', user: 'self-test' }
  );
  console.log('created: ' + JSON.stringify(created));
  console.log('analytics: ' + JSON.stringify(analytics({}).totals));
  console.log('deleted: ' + JSON.stringify(deleteRecord(created.id)));
  console.log('✅ self test passed');
}
