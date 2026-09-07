/**
 * LINE Messaging API webhook。
 *
 * Apps Script 的 doPost 讀不到 HTTP header，所以無法驗證 X-Line-Signature；
 * 改用「網址帶密鑰」的方式保護：webhook URL 設成
 *   https://script.google.com/macros/s/xxx/exec?route=line&key=<LINE_HOOK_KEY>
 * 再加上 LINE_ALLOWED_USER_IDS 白名單，只有自己人能記到你的帳本。
 */

const LINE_API = 'https://api.line.me/v2/bot';

function handleLineWebhook_(e, params) {
  // LINE 不看回應內容，只看 200，所以這裡永遠回 200，錯誤寫進 Logs 工作表
  try {
    const expectedKey = prop_('LINE_HOOK_KEY', '');
    if (expectedKey && String(params.key || '') !== expectedKey) {
      logEvent_('line_reject', 'bad key');
      return jsonOutput_({ ok: false });
    }

    const body = (e && e.postData && e.postData.contents)
      ? safeJsonParse_(e.postData.contents)
      : null;
    const events = (body && body.events) || [];

    events.forEach(function (event) {
      try {
        handleLineEvent_(event);
      } catch (err) {
        logEvent_('line_error', (err && err.stack) || String(err));
        if (event.replyToken) {
          replyText_(event.replyToken, '⚠️ 處理失敗：' + ((err && err.message) || err));
        }
      }
    });
  } catch (err) {
    logEvent_('line_fatal', (err && err.stack) || String(err));
  }
  return jsonOutput_({ ok: true });
}

function handleLineEvent_(event) {
  if (event.type === 'follow') {
    replyText_(event.replyToken, helpText_());
    return;
  }
  if (event.type !== 'message' || !event.message || event.message.type !== 'text') return;

  const userId = (event.source && event.source.userId) || '';
  if (!isAllowedLineUser_(userId)) {
    replyText_(event.replyToken,
      '這個帳本沒有開放給你使用。\n你的 userId：' + userId +
      '\n（帳本擁有者可把它加進指令碼屬性 LINE_ALLOWED_USER_IDS）');
    return;
  }

  const parsed = parseMessage_(event.message.text);
  replyText_(event.replyToken, runLineCommand_(parsed, userId));
}

/** 依解析結果實際操作帳本，回傳要送出的文字。 */
function runLineCommand_(parsed, userId) {
  switch (parsed.kind) {
    case 'record': {
      const saved = createRecord(parsed.record, { source: 'line', user: userId });
      const month = summarize({});
      return '✅ 已記帳\n' +
        saved.date + '　' + (saved.type === 'income' ? '收入' : '支出') + '．' + saved.category + '\n' +
        '$' + formatMoney_(saved.amount) + (saved.note ? '　' + saved.note : '') + '\n' +
        '—\n本月支出 $' + formatMoney_(month.expense) +
        '｜結餘 $' + formatMoney_(month.balance) + '\n' +
        'id: ' + saved.id + '（輸入「刪除 ' + saved.id + '」可移除）';
    }

    case 'delete': {
      const removed = deleteRecord(parsed.id);
      return '🗑️ 已刪除\n' + removed.date + '　' + removed.category +
        '　$' + formatMoney_(removed.amount) + (removed.note ? '　' + removed.note : '');
    }

    case 'undo': {
      const last = latestRecord(userId);
      if (!last) return '找不到可以刪除的紀錄。';
      deleteRecord(last.id);
      return '🗑️ 已刪除最後一筆\n' + last.date + '　' + last.category +
        '　$' + formatMoney_(last.amount) + (last.note ? '　' + last.note : '');
    }

    case 'today':
      return listText_('今天', { from: today_(), to: today_() });

    case 'yesterday':
      return listText_('昨天', { from: shiftDays_(-1), to: shiftDays_(-1) });

    case 'list':
      return listText_('最近', { from: shiftDays_(-6), to: today_() });

    case 'month':
      return statsText_(monthRange_(), '本月');

    case 'lastMonth': {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      const ym = Utilities.formatDate(d, scriptTimeZone_(), 'yyyy-MM');
      return statsText_(monthRange_(ym), ym);
    }

    case 'stats':
      return statsText_(monthRange_(), '本月');

    case 'help':
      return helpText_();

    default:
      return '看不懂這句話 🤔\n' + helpText_();
  }
}

/** 清單文字：日期 + 分類 + 金額 + 備註 + id。 */
function listText_(title, range) {
  const result = queryRecords({ from: range.from, to: range.to, limit: CONFIG.LINE_LIST_SIZE });
  if (!result.items.length) return title + '沒有任何紀錄。';

  const lines = result.items.map(function (r) {
    return '· ' + r.date.slice(5) + '　' + r.category + '　' +
      (r.type === 'income' ? '+' : '-') + formatMoney_(r.amount) +
      (r.note ? '　' + r.note : '') + '　[' + r.id + ']';
  });

  let expense = 0;
  let income = 0;
  result.items.forEach(function (r) {
    if (r.type === 'income') income += r.amount;
    else expense += r.amount;
  });

  const more = result.total > result.items.length
    ? '\n（共 ' + result.total + ' 筆，只顯示最新 ' + result.items.length + ' 筆）'
    : '';

  return '📒 ' + title + '（' + range.from + ' ~ ' + range.to + '）\n' +
    lines.join('\n') + '\n—\n支出 $' + formatMoney_(expense) +
    '｜收入 $' + formatMoney_(income) + more;
}

/** 統計文字：收支總覽 + 分類前五名。 */
function statsText_(range, title) {
  const s = summarize({ from: range.from, to: range.to });
  if (!s.count) return title + '還沒有任何紀錄。';

  const top = s.categories
    .filter(function (c) { return c.type === 'expense'; })
    .slice(0, 5)
    .map(function (c) {
      const pct = s.expense ? Math.round((c.amount / s.expense) * 100) : 0;
      return '· ' + c.category + '　$' + formatMoney_(c.amount) + '　' + pct + '%';
    });

  return '📊 ' + title + '（' + s.from + ' ~ ' + s.to + '）\n' +
    '支出 $' + formatMoney_(s.expense) + '\n' +
    '收入 $' + formatMoney_(s.income) + '\n' +
    '結餘 $' + formatMoney_(s.balance) + '　共 ' + s.count + ' 筆\n' +
    (top.length ? '—\n支出前五名\n' + top.join('\n') : '');
}

function helpText_() {
  return '👋 PennyCount 記帳機器人\n\n' +
    '【記一筆】直接打\n' +
    '· 午餐 120\n' +
    '· 星巴克 拿鐵 180\n' +
    '· +45000 薪水\n' +
    '· 昨天 加油 800\n' +
    '· 9/1 房租 15000\n' +
    '· #交通 120 高鐵（自己指定分類）\n\n' +
    '【查詢】今天／昨天／最近／本月／上個月／統計\n' +
    '【刪除】刪除 <id>　或　收回';
}

function isAllowedLineUser_(userId) {
  const allow = prop_('LINE_ALLOWED_USER_IDS', '').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
  if (!allow.length) return true; // 沒設定就是不限制（建議至少設定自己）
  return allow.indexOf(userId) !== -1;
}

function replyText_(replyToken, text) {
  if (!replyToken) return;
  replyMessages_(replyToken, [{ type: 'text', text: String(text).slice(0, 4900) }]);
}

function replyMessages_(replyToken, messages) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token) {
    logEvent_('line_error', '尚未設定 LINE_CHANNEL_ACCESS_TOKEN');
    return;
  }

  const response = UrlFetchApp.fetch(LINE_API + '/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    logEvent_('line_reply_failed', response.getResponseCode() + ' ' + response.getContentText());
  }
}

/** 主動推播（可搭配時間觸發器做每日／每月提醒）。 */
function pushText_(userId, text) {
  const token = prop_('LINE_CHANNEL_ACCESS_TOKEN', '');
  if (!token || !userId) return;

  UrlFetchApp.fetch(LINE_API + '/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    muteHttpExceptions: true,
  });
}

/**
 * 可選：加一個「每天 21:00」的時間觸發器指向這個函式，
 * 就會把當天的收支推播給白名單裡的所有人。
 */
function sendDailySummary() {
  const users = prop_('LINE_ALLOWED_USER_IDS', '').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
  if (!users.length) return;

  const text = listText_('今天', { from: today_(), to: today_() });
  users.forEach(function (userId) { pushText_(userId, text); });
}
