/*
 * 前端測試：起一個假後端 + 真的 Chromium，走完記帳→紀錄→編輯→統計→分類管理，
 * 截圖放在 tests/shots/。
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node tests/ui.test.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WEB = path.join(__dirname, '..', 'web');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const month = iso(today).slice(0, 7);
const shiftMonth = (delta) => {
  const d = new Date(today.getFullYear(), today.getMonth() + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
};
const daysIn = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();

// ---- 假後端（行為對齊 apps-script 的實作） ----
let seq = 0;
let db = [
  { id: 'aaa11111', date: month + '-03', type: 'expense', category: '餐飲', amount: 120, note: '午餐' },
  { id: 'aaa22222', date: month + '-03', type: 'expense', category: '交通', amount: 30, note: '捷運' },
  { id: 'aaa33333', date: month + '-05', type: 'expense', category: '居住', amount: 15000, note: '房租' },
  { id: 'aaa44444', date: month + '-05', type: 'income', category: '薪水', amount: 52000, note: '月薪' },
  { id: 'aaa55555', date: month + '-08', type: 'expense', category: '餐飲', amount: 180, note: '午餐' },
  { id: 'aaa66666', date: month + '-12', type: 'expense', category: '娛樂', amount: 390, note: '電影' },
  { id: 'bbb11111', date: shiftMonth(-1) + '-14', type: 'expense', category: '餐飲', amount: 900, note: '聚餐' },
].map((r) => Object.assign({ payment: '', source: 'web', user: '', createdAt: '', updatedAt: '' }, r));

let categories = [
  { id: 'c1', type: 'expense', name: '餐飲', icon: '🍜', order: 1, keywords: ['午餐'], budget: 2000, archived: false },
  { id: 'c2', type: 'expense', name: '交通', icon: '🚌', order: 2, keywords: [], budget: 0, archived: false },
  { id: 'c3', type: 'expense', name: '購物', icon: '🛍️', order: 3, keywords: [], budget: 0, archived: false },
  { id: 'c4', type: 'expense', name: '娛樂', icon: '🎮', order: 4, keywords: [], budget: 0, archived: false },
  { id: 'c5', type: 'expense', name: '居住', icon: '🏠', order: 5, keywords: [], budget: 0, archived: false },
  { id: 'c6', type: 'expense', name: '其他', icon: '📦', order: 99, keywords: [], budget: 0, archived: false },
  { id: 'c7', type: 'income', name: '薪水', icon: '💼', order: 1, keywords: [], budget: 0, archived: false },
  { id: 'c8', type: 'income', name: '其他', icon: '📦', order: 99, keywords: [], budget: 0, archived: false },
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function analytics(ym) {
  const inMonth = (m) => db.filter((r) => r.date.slice(0, 7) === m);
  const current = inMonth(ym);
  const prevMonth = (() => {
    const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  })();
  const previous = inMonth(prevMonth);
  const sum = (rows, type) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);

  const days = daysIn(ym);
  const elapsed = ym === month ? today.getDate() : days;
  const expense = sum(current, 'expense');
  const byCategory = {};
  const prevByCategory = {};
  current.forEach((r) => { if (r.type === 'expense') byCategory[r.category] = (byCategory[r.category] || 0) + r.amount; });
  previous.forEach((r) => { if (r.type === 'expense') prevByCategory[r.category] = (prevByCategory[r.category] || 0) + r.amount; });

  const daily = [];
  for (let d = 1; d <= days; d++) daily.push({ date: ym + '-' + pad(d), expense: 0, income: 0 });
  current.forEach((r) => { daily[Number(r.date.slice(8)) - 1][r.type] += r.amount; });
  const cum = (rows, m) => {
    const arr = [];
    let run = 0;
    for (let d = 1; d <= daysIn(m); d++) {
      run += rows.filter((r) => r.type === 'expense' && r.date === m + '-' + pad(d)).reduce((s, r) => s + r.amount, 0);
      arr.push(run);
    }
    return arr;
  };

  const weekday = [0, 1, 2, 3, 4, 5, 6].map((w) => {
    const rows = current.filter((r) => r.type === 'expense' &&
      new Date(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)) - 1, Number(r.date.slice(8))).getDay() === w);
    const amount = rows.reduce((s, r) => s + r.amount, 0);
    const uniqueDays = new Set(rows.map((r) => r.date)).size || 1;
    return { weekday: w, amount, count: rows.length, days: uniqueDays, average: Math.round(amount / uniqueDays) };
  });

  const notes = {};
  current.forEach((r) => {
    if (r.type !== 'expense' || !r.note) return;
    if (!notes[r.note]) notes[r.note] = { note: r.note, amount: 0, count: 0, category: r.category };
    notes[r.note].amount += r.amount;
    notes[r.note].count += 1;
  });

  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const m = shiftMonth(-i);
    monthly.push({ month: m, expense: sum(inMonth(m), 'expense'), income: sum(inMonth(m), 'income') });
  }

  const largest = current.filter((r) => r.type === 'expense').sort((a, b) => b.amount - a.amount)[0];

  return {
    month: ym,
    from: ym + '-01',
    to: ym + '-' + daysIn(ym),
    totals: {
      expense, income: sum(current, 'income'), balance: sum(current, 'income') - expense,
      count: current.length, days, elapsedDays: elapsed,
      activeDays: new Set(current.filter((r) => r.type === 'expense').map((r) => r.date)).size,
      avgPerDay: Math.round(expense / elapsed), projected: Math.round((expense / elapsed) * days),
      largest: largest ? { amount: largest.amount, category: largest.category, note: largest.note, date: largest.date } : null,
    },
    previous: { month: prevMonth, expense: sum(previous, 'expense'), income: sum(previous, 'income') },
    monthly,
    categories: Object.keys(byCategory).map((name) => ({
      category: name,
      icon: (categories.find((c) => c.name === name && c.type === 'expense') || {}).icon || '📦',
      amount: byCategory[name],
      share: Math.round((byCategory[name] / (expense || 1)) * 1000) / 10,
      previous: prevByCategory[name] || 0,
      delta: byCategory[name] - (prevByCategory[name] || 0),
      deltaPct: null,
    })).sort((a, b) => b.amount - a.amount),
    weekday,
    daily,
    cumulative: { current: cum(current, ym), previous: cum(previous, prevMonth) },
    topNotes: Object.values(notes).sort((a, b) => b.amount - a.amount).slice(0, 6),
    budgets: categories.filter((c) => c.type === 'expense' && c.budget > 0).map((c) => {
      const spent = byCategory[c.name] || 0;
      const pct = Math.round((spent / c.budget) * 100);
      return {
        category: c.name, icon: c.icon, budget: c.budget, spent,
        remaining: c.budget - spent, pct,
        status: pct >= 100 ? 'critical' : (pct >= 80 ? 'warning' : 'good'),
      };
    }).sort((a, b) => b.pct - a.pct),
  };
}

function api(params, body, res) {
  const p = Object.assign({}, params, body || {});
  const send = (payload) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(payload));
  };
  const fail = (code, message) => send({ ok: false, error: { code, message } });

  switch (p.action) {
    case 'ping':
      return send({ ok: true, data: { service: 'PennyCount', today: iso(today), timeZone: 'Asia/Taipei' } });

    case 'listCategories':
      return send({ ok: true, data: categories.slice().sort((a, b) =>
        a.type !== b.type ? (a.type === 'expense' ? -1 : 1) : a.order - b.order) });

    case 'categoryUsage': {
      const counts = {};
      db.forEach((r) => { counts[r.type + '|' + r.category] = (counts[r.type + '|' + r.category] || 0) + 1; });
      return send({ ok: true, data: counts });
    }

    case 'addCategory': {
      if (!String(p.name || '').trim()) return fail('BAD_REQUEST', '分類名稱不能空白');
      if (categories.some((c) => c.type === p.type && c.name === p.name)) {
        return fail('CONFLICT', '已經有這個分類了');
      }
      const category = {
        id: 'new' + (++seq), type: p.type, name: p.name, icon: p.icon || '🏷️',
        order: 50 + seq,
        keywords: String(p.keywords || '').split(/[,，、\s]+/).filter(Boolean),
        budget: Number(p.budget) || 0, archived: false,
      };
      categories.push(category);
      return send({ ok: true, data: category });
    }

    case 'updateCategory': {
      const category = categories.find((c) => c.id === p.id);
      if (!category) return fail('NOT_FOUND', '找不到分類');
      const oldName = category.name;
      if (p.name !== undefined) category.name = p.name;
      if (p.icon !== undefined) category.icon = p.icon;
      if (p.budget !== undefined) category.budget = Number(p.budget) || 0;
      if (p.keywords !== undefined) category.keywords = String(p.keywords).split(/[,，、\s]+/).filter(Boolean);
      let renamed = 0;
      if (oldName !== category.name) {
        db.forEach((r) => {
          if (r.category === oldName && r.type === category.type) { r.category = category.name; renamed++; }
        });
      }
      return send({ ok: true, data: Object.assign({ renamedRecords: renamed }, category) });
    }

    case 'deleteCategory': {
      const category = categories.find((c) => c.id === p.id);
      if (!category) return fail('NOT_FOUND', '找不到分類');
      let moved = 0;
      db.forEach((r) => {
        if (r.category === category.name && r.type === category.type) { r.category = '其他'; moved++; }
      });
      categories = categories.filter((c) => c.id !== p.id);
      return send({ ok: true, data: { deleted: category, movedTo: '其他', movedRecords: moved } });
    }

    case 'reorderCategories': {
      (p.ids || []).forEach((id, i) => {
        const category = categories.find((c) => c.id === id);
        if (category) category.order = i + 1;
      });
      return send({ ok: true, data: categories.slice().sort((a, b) =>
        a.type !== b.type ? (a.type === 'expense' ? -1 : 1) : a.order - b.order) });
    }

    case 'listRecords': {
      const items = db.filter((r) => !p.month || r.date.slice(0, 7) === p.month)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return send({ ok: true, data: { items, total: items.length, offset: 0, limit: 500 } });
    }

    case 'addRecord': {
      const record = {
        id: 'rec' + (++seq), date: p.date, type: p.type, category: p.category,
        amount: Number(p.amount), note: p.note || '', payment: '', source: 'web',
        user: '', createdAt: '', updatedAt: '',
      };
      db.push(record);
      return send({ ok: true, data: record });
    }

    case 'updateRecord': {
      const record = db.find((r) => r.id === p.id);
      if (!record) return fail('NOT_FOUND', '找不到紀錄');
      Object.assign(record, { amount: Number(p.amount), category: p.category, date: p.date, note: p.note });
      return send({ ok: true, data: record });
    }

    case 'deleteRecord': {
      const i = db.findIndex((r) => r.id === p.id);
      const [removed] = db.splice(i, 1);
      return send({ ok: true, data: removed });
    }

    case 'analytics':
      return send({ ok: true, data: analytics(p.month || month) });

    default:
      return fail('UNKNOWN_ACTION', p.action);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/exec') {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => api(Object.fromEntries(url.searchParams), JSON.parse(raw || '{}'), res));
      return;
    }
    return api(Object.fromEntries(url.searchParams), null, res);
  }
  const file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

// ---- 測試 ----
(async () => {
  await new Promise((r) => server.listen(4321, r));
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });

  const errors = [];
  context.on('weberror', (e) => errors.push('pageerror: ' + e.error().message));

  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });


  // 1) 首次啟動的設定畫面
  await page.goto('http://localhost:4321/index.html');
  await page.waitForSelector('#onboarding:not([hidden])');
  await shot('1-onboarding');

  await page.fill('#setup-url', 'http://example.com');
  await page.click('#setup-save');
  const errVisible = await page.isVisible('#setup-error');

  // 2) 進入 App（測試環境用本機假後端，所以直接寫 localStorage）
  await page.evaluate(() => {
    localStorage.setItem('pennycount.url', 'http://localhost:4321/exec');
    localStorage.setItem('pennycount.token', 'test-token');
  });
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#categories .chip').length > 1);
  await shot('2-entry');

  // 3) 記一筆
  for (const key of ['2', '4', '5']) await page.click(`.key[data-key="${key}"]`);
  const amountShown = await page.textContent('#amount');
  await page.click('.chip:has-text("交通")');
  await page.fill('#entry-note', '高鐵回家');
  await page.click('#save');
  await page.waitForSelector('.toast:not([hidden])');
  const toastText = await page.textContent('#toast');

  // 4) 紀錄頁
  await page.click('.tab[data-tab="records"]');
  await page.waitForSelector('.record-list .row');
  const rowCount = await page.locator('.record-list .row').count();
  await shot('3-records');

  await page.fill('#search', '房租');
  const filtered = await page.locator('.record-list .row').count();
  await page.fill('#search', '');

  // 5) 編輯一筆
  await page.locator('.record-list .row').first().click();
  await page.waitForSelector('#sheet:not([hidden])');
  await page.fill('#edit-amount', '999');
  await page.click('#edit-save');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  const hasUpdated = (await page.textContent('.record-list')).includes('999');

  // 6) 統計頁：每張圖都要畫出來
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#chart-donut svg circle');
  const charts = {
    hero: await page.locator('.hero').count(),
    tiles: await page.locator('.tile').count(),
    cumulative: await page.locator('#chart-cumulative polyline').count(),
    monthly: await page.locator('#chart-monthly text').count(),   // 6 個月標籤 + 被強調那根的數值
    donut: await page.locator('#chart-donut circle').count(),
    weekday: await page.locator('#chart-weekday path').count(),
    budgets: await page.locator('.budget').count(),
    notes: await page.locator('.note-row').count(),
    catLines: await page.locator('.cat-line').count(),
  };
  await shot('4-stats-top');
  await page.evaluate(() => { document.querySelector('#chart-donut').scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(150);
  await shot('4b-stats-mid');
  await page.evaluate(() => { document.querySelector('#chart-weekday').scrollIntoView(); });
  await page.waitForTimeout(150);
  await shot('5-stats-bottom');

  // 圖表提示：hover 一根長條要出現數字
  await page.locator('#chart-monthly rect[fill="transparent"]').last().hover();
  await page.waitForSelector('#chart-monthly ~ .chart-tip, .chart .chart-tip:not([hidden])');
  const tipText = await page.locator('.chart-tip:not([hidden])').first().textContent();

  // 7) 分類管理：新增 → 出現在記帳頁
  await page.click('.tab[data-tab="settings"]');
  await page.click('#open-categories');
  await page.waitForSelector('.cat-row');
  const beforeCount = await page.locator('.cat-row').count();
  await shot('6-categories');

  await page.click('#category-add');
  await page.waitForSelector('#category-sheet:not([hidden])');
  await page.fill('#category-name', '早午餐');
  await page.click('.emoji-tab:has-text("飲食")');
  await page.click('.emoji[data-emoji="🥐"]');
  await page.fill('#category-budget', '3000');
  await page.fill('#category-keywords', '蛋餅, 三明治');
  await shot('7-category-editor');
  await page.click('#category-save');
  await page.waitForSelector('#category-sheet', { state: 'hidden' });
  await page.waitForFunction((n) => document.querySelectorAll('.cat-row').length === n + 1, beforeCount);
  const newRow = await page.locator('.cat-row:has-text("早午餐")').textContent();

  // 自訂 emoji：直接貼上
  await page.click('.cat-row:has-text("早午餐") [data-edit]');
  await page.waitForSelector('#category-sheet:not([hidden])');
  await page.fill('#category-icon', '🫓');
  const previewIcon = await page.textContent('#icon-preview');
  await page.click('#category-save');
  await page.waitForSelector('#category-sheet', { state: 'hidden' });

  // 排序：把最後一個往上移
  const firstBefore = await page.locator('.cat-row .cat-row__text b').first().textContent();
  await page.locator('.cat-row').nth(1).locator('[data-move="up"]').click();
  await page.waitForTimeout(250);
  const firstAfter = await page.locator('.cat-row .cat-row__text b').first().textContent();

  // 新分類要出現在記帳頁的分類列
  await page.click('.tab[data-tab="entry"]');
  const chipNames = await page.locator('#categories .chip__name').allTextContents();

  // 從記帳頁的「＋新增」直接開分類編輯器
  await page.click('.chip--add');
  await page.waitForSelector('#category-sheet:not([hidden])');
  const opensNew = await page.textContent('#category-sheet-title');
  await page.click('#category-cancel');

  // 收入分類是另一組
  await page.click('.type-switch__btn[data-cattype="income"]');
  const incomeRows = await page.locator('.cat-row .cat-row__text b').allTextContents();

  // 8) 刪除分類：紀錄要被搬到「其他」
  await page.click('.type-switch__btn[data-cattype="expense"]');
  page.once('dialog', (d) => d.accept());
  await page.click('.cat-row:has-text("娛樂") [data-edit]');
  await page.waitForSelector('#category-sheet:not([hidden])');
  await page.click('#category-delete');
  await page.waitForSelector('#category-sheet', { state: 'hidden' });
  await page.click('.tab[data-tab="records"]');
  await page.waitForSelector('.record-list .row');
  const afterDelete = await page.textContent('#record-list');

  // 9) 淺色模式的統計頁
  const light = await context.newPage();
  await light.emulateMedia({ colorScheme: 'light' });
  await light.goto('http://localhost:4321/index.html');
  await light.waitForSelector('#app:not([hidden])');
  await light.click('.tab[data-tab="stats"]');
  await light.waitForSelector('#chart-donut svg circle');
  await light.screenshot({ path: path.join(SHOTS, '8-stats-light.png') });

  const results = {
    '亂填網址會擋下': errVisible === true,
    '鍵盤輸入 245': amountShown === '245',
    '存檔後有提示': /已記一筆/.test(toastText),
    '紀錄頁有資料列': rowCount >= 6,
    '搜尋只剩 1 筆': filtered === 1,
    '編輯後金額更新': hasUpdated,
    '統計：大數字': charts.hero === 1,
    '統計：四個指標': charts.tiles === 4,
    '統計：累積雙線': charts.cumulative === 2,
    '統計：月度長條 6 個月': charts.monthly >= 6,
    '統計：甜甜圈': charts.donut >= 3,
    '統計：星期長條': charts.weekday >= 1,
    '統計：預算進度': charts.budgets >= 1,
    '統計：常買項目': charts.notes >= 1,
    '統計：分類排行': charts.catLines >= 3,
    '圖表 hover 有數字': /\$/.test(tipText || ''),
    '新增分類成功': /早午餐/.test(newRow) && /3,000|3000/.test(newRow),
    '貼上自訂 emoji': previewIcon === '🫓',
    '排序有生效': firstBefore !== firstAfter,
    '新分類出現在記帳頁': chipNames.some((n) => n.includes('早午餐')),
    '＋新增開啟編輯器': /新增/.test(opensNew),
    '收入分類是另一組': incomeRows.some((n) => n.includes('薪水')) && !incomeRows.some((n) => n.includes('餐飲')),
    '刪除分類後紀錄改成其他': !/娛樂/.test(afterDelete) && /其他/.test(afterDelete),
    '沒有 JS 錯誤': errors.length === 0,
  };

  console.log('');
  let bad = 0;
  Object.entries(results).forEach(([k, v]) => {
    if (!v) bad++;
    console.log((v ? '  ✓ ' : '  ✗ ') + k);
  });
  if (errors.length) console.log('\n錯誤：\n' + errors.join('\n'));
  console.log(bad ? `\n❌ ${bad} 項失敗\n` : '\n✅ 前端全部通過\n');

  await browser.close();
  server.close();
  process.exit(bad ? 1 : 0);
})();
