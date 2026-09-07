/*
 * 前端測試：起一個假後端 + 真的 Chromium，走完記帳→紀錄→編輯→統計流程，
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
const iso = (d) => d.toISOString().slice(0, 10);
const month = iso(today).slice(0, 7);

let seq = 0;
const db = [
  { id: 'aaa11111', date: month + '-03', type: 'expense', category: '餐飲', amount: 120, note: '午餐', payment: '', source: 'line', user: '', createdAt: '', updatedAt: '' },
  { id: 'aaa22222', date: month + '-03', type: 'expense', category: '交通', amount: 30, note: '捷運', payment: '', source: 'web', user: '', createdAt: '', updatedAt: '' },
  { id: 'aaa33333', date: month + '-05', type: 'expense', category: '居住', amount: 15000, note: '房租', payment: '', source: 'web', user: '', createdAt: '', updatedAt: '' },
  { id: 'aaa44444', date: month + '-05', type: 'income', category: '薪水', amount: 52000, note: '月薪', payment: '', source: 'web', user: '', createdAt: '', updatedAt: '' },
];
const categories = [
  { type: 'expense', name: '餐飲', icon: '🍜', order: 1 },
  { type: 'expense', name: '交通', icon: '🚌', order: 2 },
  { type: 'expense', name: '購物', icon: '🛍️', order: 3 },
  { type: 'expense', name: '娛樂', icon: '🎮', order: 4 },
  { type: 'expense', name: '居住', icon: '🏠', order: 5 },
  { type: 'expense', name: '其他', icon: '📦', order: 99 },
  { type: 'income', name: '薪水', icon: '💼', order: 1 },
  { type: 'income', name: '獎金', icon: '🏆', order: 2 },
  { type: 'income', name: '其他', icon: '📦', order: 99 },
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function api(req, params, body, res) {
  const p = Object.assign({}, params, body || {});
  const send = (payload) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(payload));
  };
  switch (p.action) {
    case 'ping': return send({ ok: true, data: { service: 'PennyCount', today: iso(today), timeZone: 'Asia/Taipei' } });
    case 'listCategories': return send({ ok: true, data: categories });
    case 'listRecords': {
      const items = db.filter((r) => !p.month || r.date.slice(0, 7) === p.month)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return send({ ok: true, data: { items, total: items.length, offset: 0, limit: 500 } });
    }
    case 'addRecord': {
      const rec = {
        id: 'new' + String(++seq).padStart(5, '0'),
        date: p.date, type: p.type, category: p.category, amount: Number(p.amount),
        note: p.note || '', payment: '', source: 'web', user: '', createdAt: '', updatedAt: '',
      };
      db.push(rec);
      return send({ ok: true, data: rec });
    }
    case 'updateRecord': {
      const rec = db.find((r) => r.id === p.id);
      if (!rec) return send({ ok: false, error: { code: 'NOT_FOUND', message: '找不到' } });
      Object.assign(rec, { amount: Number(p.amount), category: p.category, date: p.date, note: p.note });
      return send({ ok: true, data: rec });
    }
    case 'deleteRecord': {
      const i = db.findIndex((r) => r.id === p.id);
      const [removed] = db.splice(i, 1);
      return send({ ok: true, data: removed });
    }
    default: return send({ ok: false, error: { code: 'UNKNOWN_ACTION', message: p.action } });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/exec') {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => api(req, Object.fromEntries(url.searchParams), JSON.parse(raw || '{}'), res));
      return;
    }
    return api(req, Object.fromEntries(url.searchParams), null, res);
  }
  const file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

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

  // 1) 首次啟動的設定畫面
  await page.goto('http://localhost:4321/index.html');
  await page.waitForSelector('#onboarding:not([hidden])');
  await page.screenshot({ path: path.join(SHOTS, '1-onboarding.png') });

  // 網址驗證要擋掉亂填的值
  await page.fill('#setup-url', 'http://example.com');
  await page.click('#setup-save');
  const errVisible = await page.isVisible('#setup-error');

  // 2) 用合法設定進入（測試環境用本機假後端，所以直接寫 localStorage）
  await page.evaluate(() => {
    localStorage.setItem('pennycount.url', 'http://localhost:4321/exec');
    localStorage.setItem('pennycount.token', 'test-token');
  });
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#categories .chip').length > 0);
  await page.screenshot({ path: path.join(SHOTS, '2-entry.png') });

  // 3) 按鍵盤輸入 245，選「交通」，存檔
  for (const key of ['2', '4', '5']) await page.click(`.key[data-key="${key}"]`);
  const amountShown = await page.textContent('#amount');
  await page.click('.chip:has-text("交通")');
  await page.fill('#entry-note', '高鐵回家');
  await page.click('#save');
  await page.waitForSelector('.toast:not([hidden])');
  const toastText = await page.textContent('#toast');
  await page.screenshot({ path: path.join(SHOTS, '3-saved.png') });

  // 4) 紀錄頁
  await page.click('.tab[data-tab="records"]');
  await page.waitForSelector('.record-list .row');
  const rowCount = await page.locator('.record-list .row').count();
  await page.screenshot({ path: path.join(SHOTS, '4-records.png') });

  // 搜尋過濾
  await page.fill('#search', '房租');
  const filtered = await page.locator('.record-list .row').count();
  await page.fill('#search', '');

  // 5) 點一筆開編輯 → 改金額
  await page.locator('.record-list .row').first().click();
  await page.waitForSelector('#sheet:not([hidden])');
  await page.screenshot({ path: path.join(SHOTS, '5-edit.png') });
  await page.fill('#edit-amount', '999');
  await page.click('#edit-save');
  await page.waitForSelector('#sheet', { state: 'hidden' });
  const hasUpdated = (await page.textContent('.record-list')).includes('999');

  // 6) 統計頁
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#category-bars .cat');
  const barCount = await page.locator('#daily-chart .bar').count();
  await page.screenshot({ path: path.join(SHOTS, '6-stats.png') });

  // 7) 收入模式：分類要換一組
  await page.click('.tab[data-tab="entry"]');
  await page.click('.type-switch__btn[data-type="income"]');
  const incomeChips = await page.locator('#categories .chip').allTextContents();

  // 8) 設定頁 + 淺色模式
  await page.click('.tab[data-tab="settings"]');
  await page.click('#cfg-test');
  await page.waitForFunction(() => document.querySelector('#cfg-status').textContent.includes('連線正常'));
  await page.screenshot({ path: path.join(SHOTS, '7-settings.png') });

  const light = await context.newPage();
  await light.emulateMedia({ colorScheme: 'light' });
  await light.goto('http://localhost:4321/index.html');
  await light.waitForSelector('#app:not([hidden])');
  await light.click('.tab[data-tab="records"]');
  await light.waitForSelector('.record-list .row');
  await light.screenshot({ path: path.join(SHOTS, '8-light-records.png') });

  const results = {
    '亂填網址會擋下': errVisible === true,
    '鍵盤輸入 245': amountShown === '245',
    '存檔後有提示': /已記一筆/.test(toastText),
    '紀錄頁有資料列': rowCount >= 5,
    '搜尋只剩 1 筆': filtered === 1,
    '編輯後金額更新': hasUpdated,
    '每日長條圖天數': barCount >= 28,
    '收入分類切換': incomeChips.join('').includes('薪水') && !incomeChips.join('').includes('餐飲'),
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
