/**
 * 資料層：所有對 Google Sheet 的讀寫都集中在這裡。
 * 上層（Api / Line）只看得到 JavaScript 物件，看不到列號與欄位順序。
 */

function getSpreadsheet_() {
  const id = spreadsheetId_();
  if (id) return SpreadsheetApp.openById(id);

  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (!bound) {
    throw ApiError('NO_SPREADSHEET',
      '找不到試算表。請把這個指令碼綁在試算表上，或在指令碼屬性設定 SPREADSHEET_ID。');
  }
  return bound;
}

/** 取得工作表，不存在就依 schema 建立（含表頭與格式）。 */
function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  if (name === CONFIG.SHEET_RECORDS) {
    sheet.getRange(1, 1, 1, RECORD_FIELDS.length).setValues([RECORD_FIELDS]);
    // 日期存文字，避免不同時區開啟時整批位移一天
    sheet.getRange('B:B').setNumberFormat('@');
    sheet.getRange('E:E').setNumberFormat('#,##0.00');
    sheet.setFrozenRows(1);
  } else if (name === CONFIG.SHEET_CATEGORIES) {
    sheet.getRange(1, 1, 1, CATEGORY_FIELDS.length).setValues([CATEGORY_FIELDS]);
    sheet.setFrozenRows(1);
  } else if (name === CONFIG.SHEET_LOGS) {
    sheet.getRange(1, 1, 1, 3).setValues([['time', 'kind', 'detail']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 把整張表讀成物件陣列（含 _row 方便回頭定位）。 */
function readAll_(sheetName, fields) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, fields.length).getValues();
  const items = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (cell) { return cell === '' || cell === null; })) continue;

    const item = { _row: i + 2 };
    for (let c = 0; c < fields.length; c++) item[fields[c]] = row[c];
    items.push(item);
  }
  return items;
}

/** 內部列物件 → 對外的乾淨 record。 */
function toRecord_(row) {
  return {
    id: String(row.id),
    // 手動在試算表亂填日期時不要讓整份清單掛掉，壞掉的那筆日期留空即可
    date: safeDate_(row.date),
    type: normalizeType_(row.type),
    category: String(row.category || ''),
    amount: Number(row.amount) || 0,
    note: String(row.note || ''),
    payment: String(row.payment || ''),
    source: String(row.source || ''),
    user: String(row.user || ''),
    createdAt: row.createdAt ? String(row.createdAt) : '',
    updatedAt: row.updatedAt ? String(row.updatedAt) : '',
  };
}

/** 寫入用：record 物件 → 依 RECORD_FIELDS 排好的陣列。 */
function toRow_(record) {
  return RECORD_FIELDS.map(function (field) {
    const value = record[field];
    return value === undefined || value === null ? '' : value;
  });
}

/**
 * 查詢紀錄。
 * filter: { from, to, type, category, keyword, limit, offset }
 * 回傳 { items, total, offset, limit }，依日期新到舊排序。
 */
function queryRecords(filter) {
  const opts = filter || {};
  const rows = readAll_(CONFIG.SHEET_RECORDS, RECORD_FIELDS)
    .filter(function (row) { return row.id !== '' && row.id !== null; })
    .map(toRecord_);

  // 給了 month（yyyy-MM）就換算成該月的起訖，from/to 優先
  const month = (!opts.from && !opts.to && opts.month) ? monthRange_(opts.month) : null;
  const from = opts.from ? normalizeDate_(opts.from) : (month ? month.from : null);
  const to = opts.to ? normalizeDate_(opts.to) : (month ? month.to : null);
  const type = opts.type ? normalizeType_(opts.type) : null;
  const category = opts.category || null;
  const keyword = opts.keyword ? String(opts.keyword).toLowerCase() : null;

  const filtered = rows.filter(function (r) {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (type && r.type !== type) return false;
    if (category && r.category !== category) return false;
    if (keyword) {
      const haystack = (r.note + ' ' + r.category + ' ' + r.payment).toLowerCase();
      if (haystack.indexOf(keyword) === -1) return false;
    }
    return true;
  });

  filtered.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (a.createdAt < b.createdAt) ? 1 : -1;
  });

  const offset = Math.max(0, Number(opts.offset) || 0);
  const limit = Math.min(CONFIG.MAX_PAGE_SIZE, Math.max(1, Number(opts.limit) || CONFIG.MAX_PAGE_SIZE));

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset: offset,
    limit: limit,
  };
}

/** 新增一筆紀錄，回傳寫入後的完整 record。 */
function createRecord(input, context) {
  const ctx = context || {};
  const now = nowIso_();
  const record = {
    id: newId_(),
    date: normalizeDate_(input.date),
    type: normalizeType_(input.type),
    category: String(input.category || '').trim() || '其他',
    amount: normalizeAmount_(input.amount),
    note: String(input.note || '').trim(),
    payment: String(input.payment || '').trim(),
    source: ctx.source || 'web',
    user: ctx.user || '',
    createdAt: now,
    updatedAt: now,
  };

  withLock_(function () {
    getSheet_(CONFIG.SHEET_RECORDS).appendRow(toRow_(record));
  });
  return record;
}

/** 依 id 找出列物件，找不到丟 NOT_FOUND。 */
function findRow_(id) {
  const target = String(id || '').trim();
  if (!target) throw ApiError('BAD_REQUEST', '缺少 id');

  const rows = readAll_(CONFIG.SHEET_RECORDS, RECORD_FIELDS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].id).trim() === target) return rows[i];
  }
  throw ApiError('NOT_FOUND', '找不到這筆紀錄：' + target);
}

function getRecord(id) {
  return toRecord_(findRow_(id));
}

/** 局部更新；只帶要改的欄位即可。 */
function updateRecord(id, patch) {
  return withLock_(function () {
    const row = findRow_(id);
    const current = toRecord_(row);
    const next = {
      id: current.id,
      date: patch.date !== undefined ? normalizeDate_(patch.date) : current.date,
      type: patch.type !== undefined ? normalizeType_(patch.type) : current.type,
      category: patch.category !== undefined ? String(patch.category).trim() : current.category,
      amount: patch.amount !== undefined ? normalizeAmount_(patch.amount) : current.amount,
      note: patch.note !== undefined ? String(patch.note).trim() : current.note,
      payment: patch.payment !== undefined ? String(patch.payment).trim() : current.payment,
      source: current.source,
      user: current.user,
      createdAt: current.createdAt,
      updatedAt: nowIso_(),
    };
    getSheet_(CONFIG.SHEET_RECORDS)
      .getRange(row._row, 1, 1, RECORD_FIELDS.length)
      .setValues([toRow_(next)]);
    return next;
  });
}

/** 刪除一筆，回傳被刪掉的內容（LINE 上可以回覆「已刪除 早餐 85」）。 */
function deleteRecord(id) {
  return withLock_(function () {
    const row = findRow_(id);
    const deleted = toRecord_(row);
    getSheet_(CONFIG.SHEET_RECORDS).deleteRow(row._row);
    return deleted;
  });
}

/** 最近一筆（LINE 的「刪除上一筆」用）。 */
function latestRecord(user) {
  const result = queryRecords({ limit: CONFIG.MAX_PAGE_SIZE });
  const items = user
    ? result.items.filter(function (r) { return r.user === user; })
    : result.items;
  return items.length ? items[0] : null;
}

/** 分類清單，沒有資料時回傳預設值（讓前端永遠有東西可選）。 */
function listCategories() {
  const rows = readAll_(CONFIG.SHEET_CATEGORIES, CATEGORY_FIELDS)
    .filter(function (r) { return String(r.name || '').trim() !== ''; })
    .map(function (r) {
      return {
        type: normalizeType_(r.type),
        name: String(r.name).trim(),
        icon: String(r.icon || ''),
        order: Number(r.order) || 50,
      };
    });

  const list = rows.length ? rows : DEFAULT_CATEGORIES.slice();
  list.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.name < b.name ? -1 : 1;
  });
  return list;
}

/** 新增分類（重複就直接回傳既有的）。 */
function createCategory(input) {
  const type = normalizeType_(input.type);
  const name = String(input.name || '').trim();
  if (!name) throw ApiError('BAD_REQUEST', '分類名稱不能空白');

  const existing = listCategories().filter(function (c) {
    return c.type === type && c.name === name;
  });
  if (existing.length) return existing[0];

  const category = {
    type: type,
    name: name,
    icon: String(input.icon || '🏷️'),
    order: Number(input.order) || 50,
  };
  withLock_(function () {
    getSheet_(CONFIG.SHEET_CATEGORIES).appendRow(
      CATEGORY_FIELDS.map(function (f) { return category[f]; })
    );
  });
  return category;
}

/**
 * 統計：期間內的收支總額、分類佔比、每日走勢。
 */
function summarize(filter) {
  const opts = filter || {};
  const range = (opts.from || opts.to) ? opts : monthRange_(opts.month);
  const result = queryRecords({ from: range.from, to: range.to, limit: CONFIG.MAX_PAGE_SIZE });

  let expense = 0;
  let income = 0;
  const byCategory = {};
  const byDate = {};

  result.items.forEach(function (r) {
    if (r.type === 'income') income += r.amount;
    else expense += r.amount;

    const key = r.type + '|' + r.category;
    byCategory[key] = (byCategory[key] || 0) + r.amount;

    if (!byDate[r.date]) byDate[r.date] = { date: r.date, expense: 0, income: 0 };
    byDate[r.date][r.type] += r.amount;
  });

  const categories = Object.keys(byCategory).map(function (key) {
    const parts = key.split('|');
    return { type: parts[0], category: parts[1], amount: byCategory[key] };
  }).sort(function (a, b) { return b.amount - a.amount; });

  const daily = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });

  return {
    from: range.from,
    to: range.to,
    count: result.total,
    expense: Math.round(expense * 100) / 100,
    income: Math.round(income * 100) / 100,
    balance: Math.round((income - expense) * 100) / 100,
    categories: categories,
    daily: daily,
  };
}

/** 寫入時上鎖，避免網頁與 LINE 同時 append 撞在一起。 */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw ApiError('BUSY', '系統忙碌中，請稍後再試');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** 除錯用的簡易記錄（預設只在 LINE webhook 出錯時寫）。 */
function logEvent_(kind, detail) {
  try {
    getSheet_(CONFIG.SHEET_LOGS).appendRow([
      nowIso_(),
      kind,
      typeof detail === 'string' ? detail : JSON.stringify(detail),
    ]);
  } catch (err) {
    console.error('logEvent_ failed: ' + err);
  }
}
