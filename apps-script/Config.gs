/**
 * PennyCount — 全域設定與常數。
 *
 * 機密資料（API_TOKEN、LINE 金鑰…）一律放在「指令碼屬性」，不要寫在程式碼裡：
 *   Apps Script 編輯器 → 專案設定 → 指令碼屬性
 */

/** 工作表名稱與欄位定義。 */
const CONFIG = {
  SHEET_RECORDS: 'Records',
  SHEET_CATEGORIES: 'Categories',
  SHEET_LOGS: 'Logs',

  /** 一次最多回傳幾筆紀錄（避免前端一次抓爆）。 */
  MAX_PAGE_SIZE: 500,

  /** LINE 查詢時預設顯示幾筆。 */
  LINE_LIST_SIZE: 10,
};

/** Records 工作表的欄位順序，改動這裡等於改資料表結構。 */
const RECORD_FIELDS = [
  'id',        // 唯一鍵（UUID 前 8 碼，好在 LINE 上用來刪除）
  'date',      // yyyy-MM-dd，以文字儲存，避免時區位移
  'type',      // expense | income
  'category',  // 分類名稱
  'amount',    // 正數
  'note',      // 備註
  'payment',   // 付款方式／帳戶
  'source',    // web | line | sheet
  'user',      // 建立者（email 或 LINE userId）
  'createdAt', // ISO 字串
  'updatedAt', // ISO 字串
];

const CATEGORY_FIELDS = ['type', 'name', 'icon', 'order'];

/** 第一次執行 setup() 時寫入的預設分類。 */
const DEFAULT_CATEGORIES = [
  { type: 'expense', name: '餐飲', icon: '🍜', order: 1 },
  { type: 'expense', name: '交通', icon: '🚌', order: 2 },
  { type: 'expense', name: '購物', icon: '🛍️', order: 3 },
  { type: 'expense', name: '娛樂', icon: '🎮', order: 4 },
  { type: 'expense', name: '居住', icon: '🏠', order: 5 },
  { type: 'expense', name: '醫療', icon: '💊', order: 6 },
  { type: 'expense', name: '教育', icon: '📚', order: 7 },
  { type: 'expense', name: '人情', icon: '🎁', order: 8 },
  { type: 'expense', name: '其他', icon: '📦', order: 99 },
  { type: 'income', name: '薪水', icon: '💼', order: 1 },
  { type: 'income', name: '獎金', icon: '🏆', order: 2 },
  { type: 'income', name: '投資', icon: '📈', order: 3 },
  { type: 'income', name: '兼職', icon: '🧰', order: 4 },
  { type: 'income', name: '其他', icon: '📦', order: 99 },
];

/**
 * LINE／快速輸入的關鍵字對照表：訊息裡出現左邊任一個字，就歸到右邊的分類。
 * 順序有意義，先命中的先贏，所以請把最specific的放前面。
 */
const CATEGORY_KEYWORDS = [
  { type: 'income', category: '薪水', words: ['薪水', '薪資', '月薪', '工資'] },
  { type: 'income', category: '獎金', words: ['獎金', '年終', '紅利'] },
  { type: 'income', category: '投資', words: ['股利', '股息', '利息', '投資', '配息'] },
  { type: 'income', category: '兼職', words: ['兼職', '接案', '外快', '打工'] },
  { type: 'expense', category: '餐飲', words: ['早餐', '午餐', '晚餐', '宵夜', '飲料', '咖啡', '拿鐵', '美式', '奶茶', '珍奶', '手搖', '便當', '火鍋', '燒烤', '壽司', '麵', '飯', '吃', '餐', '超商', '超市', '零食', '小吃', '星巴克', '麥當勞', '全家', '7-11'] },
  { type: 'expense', category: '交通', words: ['捷運', '公車', '客運', '高鐵', '台鐵', '火車', '計程車', 'uber', '油錢', '加油', '停車', '機票', '悠遊卡'] },
  { type: 'expense', category: '購物', words: ['買', '衣服', '鞋', '網購', '蝦皮', 'momo', '日用品', '家電', '3c'] },
  { type: 'expense', category: '娛樂', words: ['電影', '遊戲', '唱歌', 'ktv', '旅遊', '訂閱', 'netflix', 'spotify', '展覽', '演唱會'] },
  { type: 'expense', category: '居住', words: ['房租', '水費', '電費', '瓦斯', '網路費', '管理費', '房貸'] },
  { type: 'expense', category: '醫療', words: ['看診', '掛號', '醫院', '藥', '牙醫', '健檢', '診所'] },
  { type: 'expense', category: '教育', words: ['書', '課程', '學費', '補習', '教材'] },
  { type: 'expense', category: '人情', words: ['紅包', '禮物', '喜酒', '包紅包', '孝親'] },
];

/** 讀取指令碼屬性，找不到就回傳 fallback。 */
function prop_(key, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value === null || value === '' ? (fallback === undefined ? '' : fallback) : value;
}

/** 這支 Web App 的存取權杖；未設定時代表不驗證（僅建議在自己測試時這樣用）。 */
function apiToken_() {
  return prop_('API_TOKEN', '');
}

/** 綁定的試算表 ID；留空代表用「這個指令碼所附屬的試算表」。 */
function spreadsheetId_() {
  return prop_('SPREADSHEET_ID', '');
}

function scriptTimeZone_() {
  return Session.getScriptTimeZone() || 'Asia/Taipei';
}
