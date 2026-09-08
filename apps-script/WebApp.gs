/**
 * Web App 進入點。
 *
 * GET  ?action=listRecords&token=...   → 唯讀 JSON API
 * GET  （沒有 action）                  → 一頁說明，附上前端網址
 * POST body = {action,token,...}       → 完整 JSON API（前端用 text/plain 送，避免 CORS preflight）
 * POST ?route=line&key=...             → LINE Messaging API webhook
 */

function doGet(e) {
  const params = coerceParams_((e && e.parameter) || {});

  if (!params.action) return landingPage_();

  if (READ_ACTIONS.indexOf(params.action) === -1) {
    return jsonOutput_(fail_('METHOD_NOT_ALLOWED', params.action + ' 只能用 POST 呼叫'));
  }
  return jsonOutput_(handleApi_(params));
}

function doPost(e) {
  const params = coerceParams_((e && e.parameter) || {});

  // LINE webhook 走另一條路：它有自己的驗證方式與回應格式
  if (params.route === 'line') {
    return handleLineWebhook_(e, params);
  }

  const body = (e && e.postData && e.postData.contents)
    ? safeJsonParse_(e.postData.contents)
    : null;

  if (!body) {
    // 也支援 form-urlencoded（?action=...&token=... 直接放在 query）
    if (params.action) return jsonOutput_(handleApi_(params));
    return jsonOutput_(fail_('BAD_REQUEST', '請用 JSON 格式送出請求'));
  }

  return jsonOutput_(handleApi_(body));
}

/** 沒帶 action 直接開網址時看到的頁面。 */
function landingPage_() {
  const webUrl = prop_('WEB_APP_URL', '');
  const link = webUrl
    ? '<p><a href="' + webUrl + '">開啟記帳介面 →</a></p>'
    : '<p>把前端部署到 GitHub Pages 後，可在指令碼屬性設定 <code>WEB_APP_URL</code>，這裡就會出現連結。</p>';

  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>PennyCount API</title>' +
    '<style>body{font:16px/1.7 -apple-system,system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.25rem;color:#1c1c1e}' +
    'code{background:#f1f1f4;padding:.15em .4em;border-radius:.3em}a{color:#0b74de}</style>' +
    '<h1>PennyCount API</h1>' +
    '<p>後端運作中，時區 <code>' + scriptTimeZone_() + '</code>，今天是 <code>' + today_() + '</code>。</p>' +
    link +
    '<p>健康檢查：<code>?action=ping</code></p>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
