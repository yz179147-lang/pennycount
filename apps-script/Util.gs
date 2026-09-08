/**
 * 共用小工具：回應格式、日期、數字、錯誤。
 */

/** 帶錯誤碼的例外，讓 API 層可以回對應的 code。 */
function ApiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** 統一的 JSON 輸出。 */
function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(data) {
  return { ok: true, data: data };
}

function fail_(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

/** 短 ID：UUID 取前 8 碼，足夠避免碰撞又方便在 LINE 上輸入。 */
function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function nowIso_() {
  return new Date().toISOString();
}

/** Date → yyyy-MM-dd（用指令碼時區）。 */
function formatDate_(date) {
  return Utilities.formatDate(date, scriptTimeZone_(), 'yyyy-MM-dd');
}

function today_() {
  return formatDate_(new Date());
}

/** 相對今天位移 n 天的日期字串。 */
function shiftDays_(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDate_(d);
}

function currentMonth_() {
  return Utilities.formatDate(new Date(), scriptTimeZone_(), 'yyyy-MM');
}

/** 這個月的第一天／最後一天。 */
function monthRange_(yyyymm) {
  const ym = yyyymm || currentMonth_();
  return {
    from: ym + '-01',
    to: ym + '-' + String(daysInMonth_(ym)).padStart(2, '0'),
  };
}

/** 該月有幾天。 */
function daysInMonth_(yyyymm) {
  const parts = String(yyyymm || currentMonth_()).split('-');
  return new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
}

/** yyyy-MM 往前／往後推 n 個月。 */
function shiftMonth_(yyyymm, delta) {
  const parts = String(yyyymm || currentMonth_()).split('-');
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1 + Number(delta), 1);
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

/** yyyy-MM-dd 是星期幾（0 = 週日）。不經過時區，純粹算日期。 */
function weekdayOf_(dateText) {
  const parts = String(dateText).split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay();
}

/** 金額統一保留兩位小數，避免浮點數尾數跑出來。 */
function round2_(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * 各種輸入正規化成 yyyy-MM-dd。
 * 接受 Date 物件、'2026-09-07'、'2026/9/7'、'9/7'、空值(=今天)。
 */
function normalizeDate_(input) {
  if (input === null || input === undefined || input === '') return today_();
  if (Object.prototype.toString.call(input) === '[object Date]') return formatDate_(input);

  const text = String(input).trim().replace(/\//g, '-');
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  }
  m = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const year = Utilities.formatDate(new Date(), scriptTimeZone_(), 'yyyy');
    return year + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  }
  throw ApiError('BAD_REQUEST', '日期格式不正確：' + input);
}

/** 讀取時用的寬鬆版：解析失敗回傳空字串，不中斷整份清單。 */
function safeDate_(input) {
  try {
    return normalizeDate_(input);
  } catch (err) {
    return '';
  }
}

/** 金額正規化：接受 '1,200'、'$99'、'12.5'，回傳正數。 */
function normalizeAmount_(input) {
  const num = Number(String(input === undefined || input === null ? '' : input).replace(/[^0-9.\-]/g, ''));
  if (!isFinite(num) || num === 0) {
    throw ApiError('BAD_REQUEST', '金額不正確：' + input);
  }
  return Math.abs(Math.round(num * 100) / 100);
}

function normalizeType_(input) {
  const text = String(input || 'expense').trim().toLowerCase();
  if (text === 'income' || text === '收入' || text === '收' || text === '+') return 'income';
  return 'expense';
}

/** 千分位，給 LINE 訊息用。 */
function formatMoney_(amount) {
  const rounded = Math.round(Number(amount) * 100) / 100;
  const parts = String(rounded).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/** 安全 JSON 解析，壞掉就回 null。 */
function safeJsonParse_(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}
