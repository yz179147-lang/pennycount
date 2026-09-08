/**
 * 資料層：所有對 Google Sheet 的讀寫都集中在這裡。
 * 上層（Api / Line）只看得到 JavaScript 物件，看不到列號與欄位順序。
 *
 * 欄位是「依表頭名稱」對應而不是依位置，所以使用者在試算表裡
 * 自己搬動欄位、插入自訂欄位都不會弄壞程式。
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

/** 取得工作表，不存在就建立。 */
function getSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * 取得工作表與「表頭 → 欄索引」的對應，缺少的欄位會自動補在最後面。
 * 這也是舊版試算表的升級路徑：新增欄位不需要手動改表。
 */
function getTable_(name, fields) {
  const sheet = getSheet_(name);
  const lastColumn = sheet.getLastColumn();

  let header = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (v) { return String(v).trim(); })
    : [];
  header = header.filter(function (h, i) { return h !== '' || i < header.length; });

  const missing = fields.filter(function (f) { return header.indexOf(f) === -1; });
  if (missing.length) {
    const start = header.filter(function (h) { return h !== ''; }).length + 1;
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    header = header.slice(0, start - 1).concat(missing);
  }

  const index = {};
  header.forEach(function (name2, i) {
    if (name2 !== '' && index[name2] === undefined) index[name2] = i;
  });
  return { sheet: sheet, header: header, index: index };
}

/** 整張表讀成物件陣列（含 _row 方便回頭定位）。 */
function readTable_(table) {
  const lastRow = table.sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = table.sheet.getRange(2, 1, lastRow - 1, table.header.length).getValues();
  const fields = Object.keys(table.index);
  const items = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (cell) { return cell === '' || cell === null; })) continue;

    const item = { _row: i + 2 };
    fields.forEach(function (field) { item[field] = row[table.index[field]]; });
    items.push(item);
  }
  return items;
}

/** 依表頭把物件寫進某一列，不認得的欄位（使用者自己加的）原封不動保留。 */
function writeRow_(table, rowIndex, patch) {
  const width = table.header.length;
  const range = table.sheet.getRange(rowIndex, 1, 1, width);
  const values = rowIndex <= table.sheet.getLastRow()
    ? range.getValues()[0]
    : new Array(width).fill('');

  Object.keys(patch).forEach(function (key) {
    const col = table.index[key];
    if (col !== undefined) values[col] = patch[key];
  });
  range.setValues([values]);
}

function appendRow_(table, values) {
  const row = new Array(table.header.length).fill('');
  Object.keys(values).forEach(function (key) {
    const col = table.index[key];
    if (col !== undefined) row[col] = values[key];
  });
  table.sheet.appendRow(row);
}

/** 把某一欄整批換掉（改分類名稱時用，比一列一列寫快得多）。 */
function replaceColumnValues_(table, field, mapper) {
  const lastRow = table.sheet.getLastRow();
  if (lastRow < 2) return 0;

  const col = table.index[field] + 1;
  const range = table.sheet.getRange(2, col, lastRow - 1, 1);
  const values = range.getValues();
  let changed = 0;

  for (let i = 0; i < values.length; i++) {
    const next = mapper(values[i][0]);
    if (next !== undefined && next !== values[i][0]) {
      values[i][0] = next;
      changed += 1;
    }
  }
  if (changed) range.setValues(values);
  return changed;
}

// ---------------------------------------------------------------- 紀錄

function recordTable_() {
  const table = getTable_(CONFIG.SHEET_RECORDS, RECORD_FIELDS);
  return table;
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

/** 全部紀錄（已排序，新到舊）。內部用，外面請用 queryRecords。 */
function allRecords_() {
  return readTable_(recordTable_())
    .filter(function (row) { return row.id !== '' && row.id !== null; })
    .map(toRecord_)
    .sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.createdAt < b.createdAt) ? 1 : -1;
    });
}

/**
 * 查詢紀錄。
 * filter: { from, to, month, type, category, keyword, limit, offset }
 */
function queryRecords(filter) {
  const opts = filter || {};

  // 給了 month（yyyy-MM）就換算成該月的起訖，from/to 優先
  const month = (!opts.from && !opts.to && opts.month) ? monthRange_(opts.month) : null;
  const from = opts.from ? normalizeDate_(opts.from) : (month ? month.from : null);
  const to = opts.to ? normalizeDate_(opts.to) : (month ? month.to : null);
  const type = opts.type ? normalizeType_(opts.type) : null;
  const category = opts.category || null;
  const keyword = opts.keyword ? String(opts.keyword).toLowerCase() : null;

  const filtered = allRecords_().filter(function (r) {
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
    appendRow_(recordTable_(), record);
  });
  return record;
}

/** 依 id 找出列物件，找不到丟 NOT_FOUND。 */
function findRecordRow_(table, id) {
  const target = String(id || '').trim();
  if (!target) throw ApiError('BAD_REQUEST', '缺少 id');

  const rows = readTable_(table);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].id).trim() === target) return rows[i];
  }
  throw ApiError('NOT_FOUND', '找不到這筆紀錄：' + target);
}

function getRecord(id) {
  return toRecord_(findRecordRow_(recordTable_(), id));
}

/** 局部更新；只帶要改的欄位即可。 */
function updateRecord(id, patch) {
  return withLock_(function () {
    const table = recordTable_();
    const row = findRecordRow_(table, id);
    const current = toRecord_(row);
    const next = {
      date: patch.date !== undefined ? normalizeDate_(patch.date) : current.date,
      type: patch.type !== undefined ? normalizeType_(patch.type) : current.type,
      category: patch.category !== undefined ? String(patch.category).trim() : current.category,
      amount: patch.amount !== undefined ? normalizeAmount_(patch.amount) : current.amount,
      note: patch.note !== undefined ? String(patch.note).trim() : current.note,
      payment: patch.payment !== undefined ? String(patch.payment).trim() : current.payment,
      updatedAt: nowIso_(),
    };
    writeRow_(table, row._row, next);
    return Object.assign({}, current, next);
  });
}

/** 刪除一筆，回傳被刪掉的內容（LINE 上可以回覆「已刪除 早餐 85」）。 */
function deleteRecord(id) {
  return withLock_(function () {
    const table = recordTable_();
    const row = findRecordRow_(table, id);
    const deleted = toRecord_(row);
    table.sheet.deleteRow(row._row);
    return deleted;
  });
}

/** 最近一筆（LINE 的「刪除上一筆」用）。 */
function latestRecord(user) {
  const records = allRecords_();
  const items = user
    ? records.filter(function (r) { return r.user === user; })
    : records;
  return items.length ? items[0] : null;
}

// ---------------------------------------------------------------- 分類

function categoryTable_() {
  return getTable_(CONFIG.SHEET_CATEGORIES, CATEGORY_FIELDS);
}

function toCategory_(row) {
  return {
    id: String(row.id || ''),
    type: normalizeType_(row.type),
    name: String(row.name || '').trim(),
    icon: String(row.icon || '') || '🏷️',
    order: Number(row.order) || 50,
    keywords: String(row.keywords || '').split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; }),
    budget: Number(row.budget) || 0,
    archived: row.archived === true || String(row.archived).toUpperCase() === 'TRUE',
  };
}

function sortCategories_(list) {
  return list.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'expense' ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.name < b.name ? -1 : 1;
  });
}

/**
 * 分類清單。工作表是空的就回傳預設值（讓前端永遠有東西可選），
 * 但不會自動寫進試算表——那是 setup() 的工作。
 */
function listCategories(options) {
  const opts = options || {};
  const rows = readTable_(categoryTable_())
    .map(toCategory_)
    .filter(function (c) { return c.name !== ''; });

  const list = rows.length ? rows : DEFAULT_CATEGORIES.map(function (c, i) {
    return toCategory_(Object.assign({ id: 'seed' + i, archived: false }, c, {
      keywords: (c.keywords || []).join(','),
    }));
  });

  return sortCategories_(opts.includeArchived
    ? list
    : list.filter(function (c) { return !c.archived; }));
}

function findCategoryRow_(table, id) {
  const target = String(id || '').trim();
  if (!target) throw ApiError('BAD_REQUEST', '缺少分類 id');

  const rows = readTable_(table);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].id).trim() === target) return rows[i];
  }
  throw ApiError('NOT_FOUND', '找不到這個分類：' + target);
}

/** 依名稱找分類（LINE 用文字操作時需要）。 */
function findCategoryByName(name, type) {
  const target = String(name || '').trim();
  const wanted = type ? normalizeType_(type) : null;
  const match = listCategories({ includeArchived: true }).filter(function (c) {
    return c.name === target && (!wanted || c.type === wanted);
  });
  return match.length ? match[0] : null;
}

/** 新增分類。同型別同名稱視為已存在，直接回傳既有的那個。 */
function createCategory(input) {
  const type = normalizeType_(input.type);
  const name = String(input.name || '').trim();
  if (!name) throw ApiError('BAD_REQUEST', '分類名稱不能空白');
  if (name.length > 12) throw ApiError('BAD_REQUEST', '分類名稱請控制在 12 個字以內');

  const existing = findCategoryByName(name, type);
  if (existing) return existing;

  return withLock_(function () {
    const table = categoryTable_();
    const current = readTable_(table).map(toCategory_);
    const sameType = current.filter(function (c) { return c.type === type; });
    const maxOrder = sameType.reduce(function (max, c) { return Math.max(max, c.order); }, 0);

    const category = {
      id: 'c' + newId_().slice(0, 6),
      type: type,
      name: name,
      icon: String(input.icon || '').trim() || '🏷️',
      order: Number(input.order) || Math.min(98, maxOrder + 1),
      keywords: normalizeKeywords_(input.keywords),
      budget: Number(input.budget) || 0,
      archived: false,
    };
    appendRow_(table, category);
    return toCategory_(category);
  });
}

/**
 * 修改分類。改名稱時會一併把既有紀錄的分類名稱換掉，
 * 這樣歷史資料不會變成孤兒。
 */
function updateCategory(id, patch) {
  return withLock_(function () {
    const table = categoryTable_();
    const row = findCategoryRow_(table, id);
    const current = toCategory_(row);

    const nextName = patch.name !== undefined ? String(patch.name).trim() : current.name;
    if (!nextName) throw ApiError('BAD_REQUEST', '分類名稱不能空白');
    if (nextName.length > 12) throw ApiError('BAD_REQUEST', '分類名稱請控制在 12 個字以內');

    if (nextName !== current.name) {
      const clash = findCategoryByName(nextName, current.type);
      if (clash && clash.id !== current.id) {
        throw ApiError('CONFLICT', '已經有一個叫「' + nextName + '」的分類了');
      }
    }

    const next = {
      type: current.type, // 型別不給改：收入分類改成支出會讓歷史紀錄對不上
      name: nextName,
      icon: patch.icon !== undefined ? (String(patch.icon).trim() || '🏷️') : current.icon,
      order: patch.order !== undefined ? Number(patch.order) : current.order,
      keywords: patch.keywords !== undefined ? normalizeKeywords_(patch.keywords) : current.keywords.join(','),
      budget: patch.budget !== undefined ? Math.max(0, Number(patch.budget) || 0) : current.budget,
      archived: patch.archived !== undefined ? Boolean(patch.archived) : current.archived,
    };
    writeRow_(table, row._row, next);

    let renamed = 0;
    if (nextName !== current.name) {
      renamed = renameCategoryInRecords_(current.name, nextName, current.type);
    }

    const saved = toCategory_(Object.assign({ id: current.id }, next));
    saved.renamedRecords = renamed;
    return saved;
  });
}

/** 刪除分類；用到的紀錄搬到 reassignTo（預設「其他」）。 */
function deleteCategory(id, reassignTo) {
  return withLock_(function () {
    const table = categoryTable_();
    const row = findCategoryRow_(table, id);
    const category = toCategory_(row);

    const fallback = String(reassignTo || '').trim() || '其他';
    if (fallback === category.name) {
      throw ApiError('BAD_REQUEST', '搬移目標不能是要刪除的分類本身');
    }

    const moved = renameCategoryInRecords_(category.name, fallback, category.type);
    table.sheet.deleteRow(row._row);

    return { deleted: category, movedTo: fallback, movedRecords: moved };
  });
}

/** 依傳入的 id 順序重新編號，前端拖曳／上下移動後呼叫。 */
function reorderCategories(ids) {
  if (!Array.isArray(ids) || !ids.length) throw ApiError('BAD_REQUEST', '缺少排序清單');

  return withLock_(function () {
    const table = categoryTable_();
    const rows = readTable_(table);
    const byId = {};
    rows.forEach(function (row) { byId[String(row.id).trim()] = row; });

    ids.forEach(function (id, i) {
      const row = byId[String(id).trim()];
      if (row) writeRow_(table, row._row, { order: i + 1 });
    });
    return listCategories();
  });
}

/** 把紀錄裡的分類名稱換成新的，回傳改了幾筆。 */
function renameCategoryInRecords_(from, to, type) {
  const table = recordTable_();
  const lastRow = table.sheet.getLastRow();
  if (lastRow < 2) return 0;

  const categoryCol = table.index.category + 1;
  const typeCol = table.index.type + 1;
  const categories = table.sheet.getRange(2, categoryCol, lastRow - 1, 1).getValues();
  const types = table.sheet.getRange(2, typeCol, lastRow - 1, 1).getValues();

  let changed = 0;
  for (let i = 0; i < categories.length; i++) {
    if (String(categories[i][0]).trim() === from && normalizeType_(types[i][0]) === type) {
      categories[i][0] = to;
      changed += 1;
    }
  }
  if (changed) table.sheet.getRange(2, categoryCol, lastRow - 1, 1).setValues(categories);
  return changed;
}

function normalizeKeywords_(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,，、\s]+/);
  return list
    .map(function (s) { return String(s).trim().toLowerCase(); })
    .filter(function (s) { return s !== ''; })
    .slice(0, 20)
    .join(',');
}

/** 每個分類目前有幾筆紀錄（刪除前提醒用）。 */
function categoryUsage() {
  const counts = {};
  allRecords_().forEach(function (r) {
    const key = r.type + '|' + r.category;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

// ---------------------------------------------------------------- 統計

/** 期間內的收支總額、分類佔比、每日走勢。 */
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
    return { type: parts[0], category: parts[1], amount: round2_(byCategory[key]) };
  }).sort(function (a, b) { return b.amount - a.amount; });

  const daily = Object.keys(byDate).sort().map(function (d) { return byDate[d]; });

  return {
    from: range.from,
    to: range.to,
    count: result.total,
    expense: round2_(expense),
    income: round2_(income),
    balance: round2_(income - expense),
    categories: categories,
    daily: daily,
  };
}

/**
 * 統計頁需要的所有數字，一次算完一次回傳。
 * 前端只要打一次 API 就能畫出全部圖表。
 *
 * options: { month: 'yyyy-MM', months: 6 }
 */
function analytics(options) {
  const opts = options || {};
  const month = opts.month || currentMonth_();
  const monthsBack = Math.min(24, Math.max(2, Number(opts.months) || 6));

  const range = monthRange_(month);
  const firstMonth = shiftMonth_(month, -(monthsBack - 1));
  const windowFrom = monthRange_(firstMonth).from;

  const records = allRecords_().filter(function (r) {
    return r.date && r.date >= windowFrom && r.date <= range.to;
  });

  const current = records.filter(function (r) { return r.date >= range.from; });
  const prevMonth = shiftMonth_(month, -1);
  const prevRange = monthRange_(prevMonth);
  const previous = records.filter(function (r) {
    return r.date >= prevRange.from && r.date <= prevRange.to;
  });

  const categories = listCategories();
  const iconOf = {};
  categories.forEach(function (c) { iconOf[c.type + '|' + c.name] = c.icon; });

  return {
    month: month,
    from: range.from,
    to: range.to,
    totals: monthTotals_(current, month),
    previous: {
      month: prevMonth,
      expense: sumBy_(previous, 'expense'),
      income: sumBy_(previous, 'income'),
    },
    monthly: monthlySeries_(records, month, monthsBack),
    categories: categoryBreakdown_(current, previous, iconOf),
    weekday: weekdayPattern_(current),
    daily: dailySeries_(current, month),
    cumulative: {
      current: cumulativeSeries_(current, month),
      previous: cumulativeSeries_(previous, prevMonth),
    },
    topNotes: topNotes_(current),
    budgets: budgetProgress_(current, categories),
  };
}

function sumBy_(records, type) {
  return round2_(records.reduce(function (sum, r) {
    return r.type === type ? sum + r.amount : sum;
  }, 0));
}

function monthTotals_(records, month) {
  const expense = sumBy_(records, 'expense');
  const income = sumBy_(records, 'income');
  const days = daysInMonth_(month);
  const isCurrentMonth = month === currentMonth_();
  const elapsed = isCurrentMonth ? Number(today_().slice(8, 10)) : days;

  const activeDays = {};
  let largest = null;
  records.forEach(function (r) {
    if (r.type !== 'expense') return;
    activeDays[r.date] = true;
    if (!largest || r.amount > largest.amount) largest = r;
  });

  return {
    expense: expense,
    income: income,
    balance: round2_(income - expense),
    count: records.length,
    days: days,
    elapsedDays: elapsed,
    activeDays: Object.keys(activeDays).length,
    avgPerDay: round2_(elapsed ? expense / elapsed : 0),
    // 依目前速度推估的月底支出；已經過完的月份就是實際值
    projected: round2_(elapsed ? (expense / elapsed) * days : 0),
    largest: largest
      ? { amount: largest.amount, category: largest.category, note: largest.note, date: largest.date }
      : null,
  };
}

function monthlySeries_(records, month, monthsBack) {
  const buckets = {};
  for (let i = monthsBack - 1; i >= 0; i--) {
    const key = shiftMonth_(month, -i);
    buckets[key] = { month: key, expense: 0, income: 0 };
  }
  records.forEach(function (r) {
    const key = r.date.slice(0, 7);
    if (buckets[key]) buckets[key][r.type] += r.amount;
  });
  return Object.keys(buckets).sort().map(function (key) {
    const bucket = buckets[key];
    bucket.expense = round2_(bucket.expense);
    bucket.income = round2_(bucket.income);
    return bucket;
  });
}

function categoryBreakdown_(current, previous, iconOf) {
  const now = {};
  const before = {};
  let total = 0;

  current.forEach(function (r) {
    if (r.type !== 'expense') return;
    now[r.category] = (now[r.category] || 0) + r.amount;
    total += r.amount;
  });
  previous.forEach(function (r) {
    if (r.type !== 'expense') return;
    before[r.category] = (before[r.category] || 0) + r.amount;
  });

  return Object.keys(now).map(function (name) {
    const amount = now[name];
    const prev = before[name] || 0;
    return {
      category: name,
      icon: iconOf['expense|' + name] || '📦',
      amount: round2_(amount),
      share: total ? Math.round((amount / total) * 1000) / 10 : 0,
      previous: round2_(prev),
      delta: round2_(amount - prev),
      deltaPct: prev ? Math.round(((amount - prev) / prev) * 100) : null,
    };
  }).sort(function (a, b) { return b.amount - a.amount; });
}

function weekdayPattern_(records) {
  const buckets = [];
  for (let i = 0; i < 7; i++) buckets.push({ weekday: i, amount: 0, count: 0, days: 0 });

  const seen = {};
  records.forEach(function (r) {
    if (r.type !== 'expense') return;
    const weekday = weekdayOf_(r.date);
    buckets[weekday].amount += r.amount;
    buckets[weekday].count += 1;
    if (!seen[r.date]) {
      seen[r.date] = true;
      buckets[weekday].days += 1;
    }
  });

  return buckets.map(function (bucket) {
    bucket.amount = round2_(bucket.amount);
    bucket.average = round2_(bucket.days ? bucket.amount / bucket.days : 0);
    return bucket;
  });
}

function dailySeries_(records, month) {
  const days = daysInMonth_(month);
  const series = [];
  for (let day = 1; day <= days; day++) {
    series.push({ date: month + '-' + String(day).padStart(2, '0'), expense: 0, income: 0 });
  }
  records.forEach(function (r) {
    const day = Number(r.date.slice(8, 10));
    if (day >= 1 && day <= days) series[day - 1][r.type] += r.amount;
  });
  series.forEach(function (d) {
    d.expense = round2_(d.expense);
    d.income = round2_(d.income);
  });
  return series;
}

/** 累積支出（第 1 天到第 n 天），用來跟上個月同期比較。 */
function cumulativeSeries_(records, month) {
  const daily = dailySeries_(records, month);
  let running = 0;
  return daily.map(function (d) {
    running += d.expense;
    return round2_(running);
  });
}

/** 常買項目：把備註一樣的歸在一起。 */
function topNotes_(records) {
  const buckets = {};
  records.forEach(function (r) {
    if (r.type !== 'expense') return;
    const note = r.note.trim();
    if (!note) return;
    if (!buckets[note]) buckets[note] = { note: note, amount: 0, count: 0, category: r.category };
    buckets[note].amount += r.amount;
    buckets[note].count += 1;
  });

  return Object.keys(buckets)
    .map(function (key) {
      const item = buckets[key];
      item.amount = round2_(item.amount);
      return item;
    })
    .filter(function (item) { return item.count > 1 || item.amount > 0; })
    .sort(function (a, b) { return b.amount - a.amount; })
    .slice(0, 6);
}

/** 有設定預算的分類，算出使用率與狀態。 */
function budgetProgress_(records, categories) {
  const spent = {};
  records.forEach(function (r) {
    if (r.type !== 'expense') return;
    spent[r.category] = (spent[r.category] || 0) + r.amount;
  });

  return categories
    .filter(function (c) { return c.type === 'expense' && c.budget > 0; })
    .map(function (c) {
      const used = round2_(spent[c.name] || 0);
      const pct = Math.round((used / c.budget) * 100);
      return {
        category: c.name,
        icon: c.icon,
        budget: c.budget,
        spent: used,
        remaining: round2_(c.budget - used),
        pct: pct,
        status: pct >= 100 ? 'critical' : (pct >= 80 ? 'warning' : 'good'),
      };
    })
    .sort(function (a, b) { return b.pct - a.pct; });
}

// ---------------------------------------------------------------- 共用

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
    const table = getTable_(CONFIG.SHEET_LOGS, LOG_FIELDS);
    appendRow_(table, {
      time: nowIso_(),
      kind: kind,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    });
  } catch (err) {
    console.error('logEvent_ failed: ' + err);
  }
}
