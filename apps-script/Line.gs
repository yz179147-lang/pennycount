/**
 * LINE Messaging API webhook。
 *
 * Apps Script 的 doPost 讀不到 HTTP header，所以無法驗證 X-Line-Signature；
 * 改用「網址帶密鑰」的方式保護：webhook URL 設成
 *   https://script.google.com/macros/s/xxx/exec?route=line&key=<LINE_HOOK_KEY>
 * 再加上 LINE_ALLOWED_USER_IDS 白名單，只有自己人能記到你的帳本。
 *
 * 網頁上做得到的事，這裡都做得到：記帳、查詢、修改分類、設預算、看統計。
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
    case 'record':
      return recordReply_(createRecord(parsed.record, { source: 'line', user: userId }));

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
    case 'stats':
      return statsText_(currentMonth_(), '本月');

    case 'lastMonth':
      return statsText_(shiftMonth_(currentMonth_(), -1), '上個月');

    case 'habits':
      return habitsText_(currentMonth_());

    case 'budget':
      return budgetText_(currentMonth_());

    case 'categories':
      return categoriesText_();

    case 'addCategory': {
      if (!parsed.category.name) return '要叫什麼名字呢？例如「新增分類 🍔 早午餐」';
      const created = createCategory(parsed.category);
      return '✅ 已新增' + (created.type === 'income' ? '收入' : '支出') + '分類\n' +
        created.icon + ' ' + created.name + '\n' +
        '之後打「' + created.name + ' 120」就會記到這一類。';
    }

    case 'deleteCategory': {
      const target = findCategoryByName(parsed.name);
      if (!target) return '找不到分類「' + parsed.name + '」。輸入「分類」可以看目前有哪些。';
      const result = deleteCategory(target.id);
      return '🗑️ 已刪除分類 ' + target.icon + ' ' + target.name +
        (result.movedRecords
          ? '\n原本的 ' + result.movedRecords + ' 筆紀錄已改成「' + result.movedTo + '」'
          : '');
    }

    case 'setBudget': {
      const target = findCategoryByName(parsed.name, 'expense');
      if (!target) return '找不到支出分類「' + parsed.name + '」。輸入「分類」可以看目前有哪些。';
      const amount = normalizeAmount_(parsed.amount);
      updateCategory(target.id, { budget: amount });
      return '🎯 已設定預算\n' + target.icon + ' ' + target.name +
        '　每月 $' + formatMoney_(amount) + '\n輸入「預算」可以看使用進度。';
    }

    case 'help':
      return helpText_();

    default:
      return '看不懂這句話 🤔\n' + helpText_();
  }
}

/** 記帳成功的回覆：這筆內容 + 本月概況 + 該分類的預算進度。 */
function recordReply_(saved) {
  const stats = analytics({ month: saved.date.slice(0, 7), months: 2 });
  const lines = [
    '✅ 已記帳',
    saved.date + '　' + (saved.type === 'income' ? '收入' : '支出') + '．' + saved.category,
    '$' + formatMoney_(saved.amount) + (saved.note ? '　' + saved.note : ''),
    '—',
    '本月支出 $' + formatMoney_(stats.totals.expense) +
      '｜結餘 $' + formatMoney_(stats.totals.balance),
  ];

  const budget = stats.budgets.filter(function (b) { return b.category === saved.category; })[0];
  if (budget) {
    lines.push(budgetLine_(budget));
  }

  lines.push('id: ' + saved.id + '（輸入「刪除 ' + saved.id + '」可移除）');
  return lines.join('\n');
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

/** 月報：收支、與上月比較、日均與月底預估、分類前五名。 */
function statsText_(month, title) {
  const s = analytics({ month: month, months: 2 });
  if (!s.totals.count) return title + '還沒有任何紀錄。';

  const diff = s.totals.expense - s.previous.expense;
  const trend = s.previous.expense
    ? (diff >= 0 ? '↑ 比上月多 $' : '↓ 比上月少 $') + formatMoney_(Math.abs(diff))
    : '（上月沒有資料可比）';

  const top = s.categories.slice(0, 5).map(function (c) {
    return '· ' + c.icon + ' ' + c.category + '　$' + formatMoney_(c.amount) + '　' + c.share + '%';
  });

  return '📊 ' + title + '（' + s.from + ' ~ ' + s.to + '）\n' +
    '支出 $' + formatMoney_(s.totals.expense) + '　' + trend + '\n' +
    '收入 $' + formatMoney_(s.totals.income) + '\n' +
    '結餘 $' + formatMoney_(s.totals.balance) + '　共 ' + s.totals.count + ' 筆\n' +
    '日均 $' + formatMoney_(s.totals.avgPerDay) +
    '｜月底預估 $' + formatMoney_(s.totals.projected) + '\n' +
    (top.length ? '—\n支出前五名\n' + top.join('\n') : '');
}

/** 消費習慣：星期分布、常買項目、最大單筆。 */
function habitsText_(month) {
  const s = analytics({ month: month, months: 2 });
  if (!s.totals.count) return '本月還沒有資料可以分析。';

  const names = ['日', '一', '二', '三', '四', '五', '六'];
  const busiest = s.weekday.slice().sort(function (a, b) { return b.average - a.average; })[0];

  const weekdayLines = s.weekday.map(function (w) {
    const bar = barText_(w.average, busiest.average || 1);
    return '週' + names[w.weekday] + ' ' + bar + ' $' + formatMoney_(w.average);
  });

  const notes = s.topNotes.slice(0, 5).map(function (n) {
    return '· ' + n.note + '　$' + formatMoney_(n.amount) + '（' + n.count + ' 次）';
  });

  const lines = [
    '🔍 消費習慣（' + s.month + '）',
    '記帳 ' + s.totals.activeDays + ' 天／' + s.totals.elapsedDays + ' 天',
    '日均 $' + formatMoney_(s.totals.avgPerDay),
    '—',
    '各星期平均支出',
  ].concat(weekdayLines);

  lines.push('花最多的是週' + names[busiest.weekday]);

  if (s.totals.largest) {
    lines.push('—', '最大單筆：' + s.totals.largest.category + ' $' +
      formatMoney_(s.totals.largest.amount) +
      (s.totals.largest.note ? '（' + s.totals.largest.note + '）' : ''));
  }
  if (notes.length) {
    lines.push('—', '常買項目', notes.join('\n'));
  }
  return lines.join('\n');
}

/** 預算使用進度。 */
function budgetText_(month) {
  const s = analytics({ month: month, months: 2 });
  if (!s.budgets.length) {
    return '還沒有設定任何預算。\n輸入「預算 餐飲 8000」就可以幫「餐飲」設定每月上限。';
  }
  return '🎯 本月預算（' + s.month + '）\n' +
    s.budgets.map(budgetLine_).join('\n');
}

function budgetLine_(b) {
  const mark = b.status === 'critical' ? '🔴' : (b.status === 'warning' ? '🟡' : '🟢');
  return mark + ' ' + b.icon + ' ' + b.category + ' ' + barText_(b.spent, b.budget) + ' ' +
    b.pct + '%　$' + formatMoney_(b.spent) + ' / ' + formatMoney_(b.budget);
}

/** 文字長條，LINE 沒有圖表就用方塊代替。 */
function barText_(value, max) {
  const width = 10;
  const filled = Math.max(0, Math.min(width, Math.round((Number(value) / (Number(max) || 1)) * width)));
  return '▇'.repeat(filled) + '·'.repeat(width - filled);
}

/** 分類清單（含預算與關鍵字）。 */
function categoriesText_() {
  const categories = listCategories();
  const render = function (type) {
    return categories.filter(function (c) { return c.type === type; }).map(function (c) {
      const budget = c.budget ? '　預算 $' + formatMoney_(c.budget) : '';
      return '· ' + c.icon + ' ' + c.name + budget;
    });
  };

  return '🏷️ 分類清單\n' +
    '【支出】\n' + render('expense').join('\n') + '\n' +
    '【收入】\n' + render('income').join('\n') + '\n—\n' +
    '新增：新增分類 🍔 早午餐\n' +
    '刪除：刪除分類 早午餐\n' +
    '預算：預算 餐飲 8000';
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
    '【查詢】今天／昨天／最近／本月／上個月\n' +
    '【分析】分析（消費習慣）／預算\n' +
    '【分類】分類／新增分類 🍔 早午餐／刪除分類 早午餐／預算 餐飲 8000\n' +
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
 * 就會把當天的收支推播給白名單裡的所有人；有超支的預算也會一起提醒。
 */
function sendDailySummary() {
  const users = prop_('LINE_ALLOWED_USER_IDS', '').split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
  if (!users.length) return;

  const stats = analytics({ month: currentMonth_(), months: 2 });
  const alerts = stats.budgets.filter(function (b) { return b.status !== 'good'; });
  const text = listText_('今天', { from: today_(), to: today_() }) +
    (alerts.length ? '\n—\n⚠️ 預算提醒\n' + alerts.map(budgetLine_).join('\n') : '');

  users.forEach(function (userId) { pushText_(userId, text); });
}
