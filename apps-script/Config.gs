/**
 * PennyCount — 全域設定與常數。
 *
 * 機密資料（API_TOKEN、LINE 金鑰…）一律放在「指令碼屬性」，不要寫在程式碼裡：
 *   Apps Script 編輯器 → 專案設定 → 指令碼屬性
 */

/** 工作表名稱與其他上限。 */
const CONFIG = {
  SHEET_RECORDS: 'Records',
  SHEET_CATEGORIES: 'Categories',
  SHEET_LOGS: 'Logs',

  /** 一次最多回傳幾筆紀錄（避免前端一次抓爆）。 */
  MAX_PAGE_SIZE: 500,

  /** LINE 查詢時預設顯示幾筆。 */
  LINE_LIST_SIZE: 10,

  /** 統計預設往回看幾個月。 */
  ANALYTICS_MONTHS: 6,
};

/** Records 工作表的欄位，程式依「表頭名稱」對應，順序可以自己調。 */
const RECORD_FIELDS = [
  'id',        // 唯一鍵（8 碼，好在 LINE 上用來刪除）
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

/**
 * Categories 工作表。分類可以自由新增、改名、換圖示、排序、設預算，
 * keywords 則決定 LINE 上打一句話時要歸到哪一類。
 */
const CATEGORY_FIELDS = [
  'id',        // c + 6 碼，改名時才不會弄丟關聯
  'type',      // expense | income
  'name',      // 顯示名稱
  'icon',      // emoji
  'order',     // 排序（小的在前）
  'keywords',  // 逗號分隔，LINE 自動分類用
  'budget',    // 每月預算，0 = 不設定
  'archived',  // TRUE = 收起來不再出現在選單
];

const LOG_FIELDS = ['time', 'kind', 'detail'];

/** 第一次執行 setup() 時寫入的預設分類（keywords 之後可自己改）。 */
const DEFAULT_CATEGORIES = [
  { type: 'expense', name: '餐飲', icon: '🍜', order: 1, budget: 0, keywords: ['早餐', '午餐', '晚餐', '宵夜', '飲料', '咖啡', '拿鐵', '美式', '奶茶', '珍奶', '手搖', '便當', '火鍋', '燒烤', '壽司', '麵', '飯', '吃', '餐', '超商', '超市', '零食', '小吃', '星巴克', '麥當勞', '全家', '7-11'] },
  { type: 'expense', name: '交通', icon: '🚌', order: 2, budget: 0, keywords: ['捷運', '公車', '客運', '高鐵', '台鐵', '火車', '計程車', 'uber', '油錢', '加油', '停車', '機票', '悠遊卡'] },
  { type: 'expense', name: '購物', icon: '🛍️', order: 3, budget: 0, keywords: ['買', '衣服', '鞋', '網購', '蝦皮', 'momo', '日用品', '家電', '3c'] },
  { type: 'expense', name: '娛樂', icon: '🎮', order: 4, budget: 0, keywords: ['電影', '遊戲', '唱歌', 'ktv', '旅遊', '訂閱', 'netflix', 'spotify', '展覽', '演唱會'] },
  { type: 'expense', name: '居住', icon: '🏠', order: 5, budget: 0, keywords: ['房租', '水費', '電費', '瓦斯', '網路費', '管理費', '房貸'] },
  { type: 'expense', name: '醫療', icon: '💊', order: 6, budget: 0, keywords: ['看診', '掛號', '醫院', '藥', '牙醫', '健檢', '診所'] },
  { type: 'expense', name: '教育', icon: '📚', order: 7, budget: 0, keywords: ['書', '課程', '學費', '補習', '教材'] },
  { type: 'expense', name: '人情', icon: '🎁', order: 8, budget: 0, keywords: ['紅包', '禮物', '喜酒', '包紅包', '孝親'] },
  { type: 'expense', name: '其他', icon: '📦', order: 99, budget: 0, keywords: [] },
  { type: 'income', name: '薪水', icon: '💼', order: 1, budget: 0, keywords: ['薪水', '薪資', '月薪', '工資'] },
  { type: 'income', name: '獎金', icon: '🏆', order: 2, budget: 0, keywords: ['獎金', '年終', '紅利'] },
  { type: 'income', name: '投資', icon: '📈', order: 3, budget: 0, keywords: ['股利', '股息', '利息', '投資', '配息'] },
  { type: 'income', name: '兼職', icon: '🧰', order: 4, budget: 0, keywords: ['兼職', '接案', '外快', '打工'] },
  { type: 'income', name: '其他', icon: '📦', order: 99, budget: 0, keywords: [] },
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
