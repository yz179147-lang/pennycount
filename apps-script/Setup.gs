/**
 * 一次性的安裝與維護工具。
 * 在 Apps Script 編輯器選 setup 然後按「執行」，就會把試算表準備好。
 */

/** 建立工作表、寫入預設分類、產生 API_TOKEN。 */
function setup() {
  getSheet_(CONFIG.SHEET_RECORDS);
  getSheet_(CONFIG.SHEET_LOGS);

  const categorySheet = getSheet_(CONFIG.SHEET_CATEGORIES);
  if (categorySheet.getLastRow() < 2) {
    const rows = DEFAULT_CATEGORIES.map(function (c) {
      return CATEGORY_FIELDS.map(function (f) { return c[f]; });
    });
    categorySheet.getRange(2, 1, rows.length, CATEGORY_FIELDS.length).setValues(rows);
  }

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
    '時區：' + scriptTimeZone_() + '\n\n' +
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

/** 塞 30 天的假資料，方便驗證前端畫面。 */
function seedDemoData() {
  const samples = [
    ['餐飲', 120, '午餐'], ['餐飲', 65, '早餐'], ['交通', 30, '捷運'],
    ['購物', 890, '日用品'], ['娛樂', 390, '電影'], ['餐飲', 180, '咖啡'],
    ['居住', 15000, '房租'], ['交通', 800, '加油'], ['醫療', 450, '看診'],
  ];
  for (let day = 0; day < 30; day++) {
    const count = Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const sample = samples[Math.floor(Math.random() * samples.length)];
      createRecord({
        date: shiftDays_(-day),
        type: 'expense',
        category: sample[0],
        amount: sample[1],
        note: sample[2],
      }, { source: 'sheet', user: 'demo' });
    }
  }
  createRecord({
    date: shiftDays_(-15), type: 'income', category: '薪水', amount: 52000, note: '月薪',
  }, { source: 'sheet', user: 'demo' });
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
  console.log('summary: ' + JSON.stringify(summarize({})));
  console.log('deleted: ' + JSON.stringify(deleteRecord(created.id)));
  console.log('✅ self test passed');
}
