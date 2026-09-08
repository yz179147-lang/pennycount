/**
 * JSON API 的路由層。
 * 所有請求格式：{ action: '...', token: '...', ...參數 }
 * 回應格式：{ ok: true, data } 或 { ok: false, error: { code, message } }
 */

/** 唯讀 action 不會改資料，前端可以用 GET 呼叫。 */
const READ_ACTIONS = [
  'ping',
  'listRecords',
  'getRecord',
  'listCategories',
  'categoryUsage',
  'summary',
  'analytics',
];

function handleApi_(request) {
  const action = String(request.action || '').trim();
  if (!action) return fail_('BAD_REQUEST', '缺少 action');

  try {
    assertToken_(request.token);
    return ok_(dispatch_(action, request));
  } catch (err) {
    const code = err && err.code ? err.code : 'INTERNAL';
    if (code === 'INTERNAL') console.error(err && err.stack ? err.stack : err);
    return fail_(code, err && err.message ? err.message : String(err));
  }
}

function dispatch_(action, req) {
  switch (action) {
    case 'ping':
      return {
        service: 'PennyCount',
        version: 2,
        time: nowIso_(),
        timeZone: scriptTimeZone_(),
        today: today_(),
        month: currentMonth_(),
      };

    // ---- 紀錄
    case 'listRecords':
      return queryRecords({
        from: req.from,
        to: req.to,
        month: req.month,
        type: req.type,
        category: req.category,
        keyword: req.keyword,
        limit: req.limit,
        offset: req.offset,
      });

    case 'getRecord':
      return getRecord(req.id);

    case 'addRecord':
      return createRecord(req.record || req, {
        source: req.source === 'line' ? 'line' : 'web',
        user: activeUser_(),
      });

    case 'updateRecord':
      return updateRecord(req.id, req.record || req);

    case 'deleteRecord':
      return deleteRecord(req.id);

    // ---- 分類
    case 'listCategories':
      return listCategories({ includeArchived: req.includeArchived === true || req.includeArchived === 'true' });

    case 'categoryUsage':
      return categoryUsage();

    case 'addCategory':
      return createCategory(req.category || req);

    case 'updateCategory':
      return updateCategory(req.id, req.category || req);

    case 'deleteCategory':
      return deleteCategory(req.id, req.reassignTo);

    case 'reorderCategories':
      return reorderCategories(req.ids);

    // ---- 統計
    case 'summary':
      return summarize({ from: req.from, to: req.to, month: req.month });

    case 'analytics':
      return analytics({ month: req.month, months: req.months });

    default:
      throw ApiError('UNKNOWN_ACTION', '不支援的 action：' + action);
  }
}

/**
 * 權杖檢查。指令碼屬性沒設 API_TOKEN 就不驗證（方便一開始測試），
 * 正式使用請務必設定，因為 Web App 是以「任何人」身分公開的。
 */
function assertToken_(token) {
  const expected = apiToken_();
  if (!expected) return;
  if (String(token || '') !== expected) {
    throw ApiError('UNAUTHORIZED', '權杖錯誤，請重新輸入存取碼');
  }
}

/** 取得目前操作者的 email；匿名部署時會是空字串。 */
function activeUser_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

/**
 * query string 只會給字串，這裡把數字欄位轉回數字，
 * 讓 GET 與 POST 兩條路徑拿到一樣的型別。
 */
function coerceParams_(params) {
  const out = {};
  Object.keys(params || {}).forEach(function (key) {
    const value = params[key];
    out[key] = Array.isArray(value) ? value[0] : value;
  });
  ['limit', 'offset', 'amount', 'months', 'budget', 'order'].forEach(function (key) {
    if (out[key] !== undefined && out[key] !== '') out[key] = Number(out[key]);
  });
  return out;
}
