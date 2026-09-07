/**
 * PennyCount 前端主程式（無框架，純 DOM）。
 * 資料流：載入月份 → state.records → render 各畫面。所有寫入都會先打後端再更新 state。
 */
(function () {
  'use strict';

  const $ = function (selector) { return document.querySelector(selector); };
  const $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

  const state = {
    view: 'entry',
    month: monthKey(new Date()),
    type: 'expense',
    amount: '0',
    category: '',
    categories: [],
    records: [],
    editing: null,
    loading: false,
  };

  // ---------- 小工具 ----------

  function monthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function todayKey() {
    const now = new Date();
    return monthKey(now) + '-' + String(now.getDate()).padStart(2, '0');
  }

  function money(value) {
    const number = Number(value) || 0;
    return number.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  }

  function weekdayOf(dateText) {
    const parts = dateText.split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return '日一二三四五六'[date.getDay()];
  }

  let toastTimer = null;
  function toast(message, kind) {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  // ---------- 啟動 ----------

  function boot() {
    bindEvents();

    if (!Api.config.isReady) {
      $('#onboarding').hidden = false;
      return;
    }
    startApp();
  }

  async function startApp() {
    $('#onboarding').hidden = true;
    $('#app').hidden = false;
    $('#month').value = state.month;
    $('#entry-date').value = todayKey();
    $('#cfg-url').value = Api.config.url;
    $('#cfg-token').value = Api.config.token;
    renderOutbox();

    await loadCategories();
    await loadMonth();
    flushOutbox();
  }

  async function loadCategories() {
    try {
      state.categories = await Api.listCategories();
    } catch (err) {
      // 後端連不上時仍給一組預設分類，至少介面不會空白
      state.categories = [
        { type: 'expense', name: '餐飲', icon: '🍜' },
        { type: 'expense', name: '交通', icon: '🚌' },
        { type: 'expense', name: '購物', icon: '🛍️' },
        { type: 'expense', name: '其他', icon: '📦' },
        { type: 'income', name: '薪水', icon: '💼' },
        { type: 'income', name: '其他', icon: '📦' },
      ];
      toast(err.message, 'error');
    }
    renderCategories();
  }

  async function loadMonth() {
    if (state.loading) return;
    state.loading = true;
    try {
      const result = await Api.listRecords({ month: state.month, limit: 500 });
      state.records = result.items;
      renderAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.loading = false;
    }
  }

  // ---------- 記帳頁 ----------

  function renderCategories() {
    const wrap = $('#categories');
    const list = state.categories.filter(function (c) { return c.type === state.type; });

    if (!list.some(function (c) { return c.name === state.category; })) {
      state.category = list.length ? list[0].name : '';
    }

    wrap.innerHTML = list.map(function (c) {
      const active = c.name === state.category ? ' is-active' : '';
      return '<button class="chip' + active + '" data-category="' + escapeAttr(c.name) + '">' +
        '<span class="chip__icon">' + (c.icon || '🏷️') + '</span>' +
        '<span class="chip__name">' + escapeHtml(c.name) + '</span></button>';
    }).join('');
  }

  function setAmount(next) {
    state.amount = next;
    $('#amount').textContent = next;
  }

  function pressKey(key) {
    let value = state.amount;
    if (key === 'del') {
      value = value.length > 1 ? value.slice(0, -1) : '0';
    } else if (key === '.') {
      if (value.indexOf('.') === -1) value += '.';
    } else {
      if (value === '0') value = key;
      else value += key;
      const decimals = value.split('.')[1];
      if (decimals && decimals.length > 2) return;
      if (value.replace('.', '').length > 9) return;
    }
    setAmount(value);
  }

  async function saveRecord() {
    const amount = Number(state.amount);
    if (!amount) {
      toast('請先輸入金額', 'error');
      return;
    }

    const record = {
      date: $('#entry-date').value || todayKey(),
      type: state.type,
      category: state.category || '其他',
      amount: amount,
      note: $('#entry-note').value.trim(),
    };

    const button = $('#save');
    button.disabled = true;
    try {
      const saved = await Api.addRecord(record);
      if (saved.date.slice(0, 7) === state.month) {
        state.records.unshift(saved);
        renderAll();
      }
      toast('已記一筆 ' + (record.type === 'income' ? '收入' : '支出') + ' $' + money(amount));
      resetEntry();
    } catch (err) {
      if (err.queued) {
        toast(err.message);
        resetEntry();
        renderOutbox();
      } else {
        toast(err.message, 'error');
      }
    } finally {
      button.disabled = false;
    }
  }

  function resetEntry() {
    setAmount('0');
    $('#entry-note').value = '';
  }

  // ---------- 紀錄頁 ----------

  function visibleRecords() {
    const keyword = $('#search').value.trim().toLowerCase();
    const type = $('#filter-type').value;
    return state.records.filter(function (r) {
      if (type && r.type !== type) return false;
      if (keyword) {
        const haystack = (r.note + ' ' + r.category).toLowerCase();
        if (haystack.indexOf(keyword) === -1) return false;
      }
      return true;
    });
  }

  function renderRecords() {
    const list = $('#record-list');
    const records = visibleRecords();

    if (!records.length) {
      list.innerHTML = '<p class="empty">這個月還沒有紀錄，去「記帳」新增第一筆吧。</p>';
      return;
    }

    const groups = {};
    records.forEach(function (r) {
      if (!groups[r.date]) groups[r.date] = [];
      groups[r.date].push(r);
    });

    list.innerHTML = Object.keys(groups).sort().reverse().map(function (date) {
      const items = groups[date];
      let expense = 0;
      let income = 0;
      items.forEach(function (r) {
        if (r.type === 'income') income += r.amount;
        else expense += r.amount;
      });

      const head = '<div class="day"><span class="day__date">' + date.slice(5) +
        ' 週' + weekdayOf(date) + '</span><span class="day__sum">' +
        (income ? '收 ' + money(income) + '　' : '') + '支 ' + money(expense) + '</span></div>';

      const rows = items.map(function (r) {
        const icon = iconOf(r.type, r.category);
        return '<button class="row" data-id="' + escapeAttr(r.id) + '">' +
          '<span class="row__icon">' + icon + '</span>' +
          '<span class="row__main"><b>' + escapeHtml(r.category) + '</b>' +
          (r.note ? '<small>' + escapeHtml(r.note) + '</small>' : '') + '</span>' +
          '<span class="row__amount ' + (r.type === 'income' ? 'is-income' : 'is-expense') + '">' +
          (r.type === 'income' ? '+' : '-') + money(r.amount) + '</span></button>';
      }).join('');

      return '<section class="group">' + head + rows + '</section>';
    }).join('');
  }

  function iconOf(type, name) {
    const match = state.categories.filter(function (c) {
      return c.type === type && c.name === name;
    })[0];
    return (match && match.icon) || (type === 'income' ? '💰' : '📦');
  }

  // ---------- 統計頁 ----------

  function totals(records) {
    let expense = 0;
    let income = 0;
    records.forEach(function (r) {
      if (r.type === 'income') income += r.amount;
      else expense += r.amount;
    });
    return { expense: expense, income: income, balance: income - expense };
  }

  function renderSummary() {
    const sum = totals(state.records);
    $('#sum-expense').textContent = money(sum.expense);
    $('#sum-income').textContent = money(sum.income);
    $('#sum-balance').textContent = money(sum.balance);
    $('#stat-expense').textContent = '$' + money(sum.expense);
    $('#stat-income').textContent = '$' + money(sum.income);
    $('#stat-balance').textContent = '$' + money(sum.balance);
  }

  function renderStats() {
    const expenses = state.records.filter(function (r) { return r.type === 'expense'; });

    // 每日長條圖
    const parts = state.month.split('-');
    const days = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
    const perDay = new Array(days).fill(0);
    expenses.forEach(function (r) {
      const day = Number(r.date.slice(8, 10));
      if (day >= 1 && day <= days) perDay[day - 1] += r.amount;
    });
    const peak = Math.max.apply(null, perDay.concat([1]));

    $('#daily-chart').innerHTML = perDay.map(function (value, index) {
      const height = Math.round((value / peak) * 100);
      const label = (index + 1) + ' 日：$' + money(value);
      return '<div class="bar" title="' + escapeAttr(label) + '" aria-label="' + escapeAttr(label) + '">' +
        '<div class="bar__fill" style="height:' + Math.max(value ? 4 : 0, height) + '%"></div></div>';
    }).join('');

    // 分類佔比
    const byCategory = {};
    expenses.forEach(function (r) {
      byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
    });
    const total = Object.keys(byCategory).reduce(function (acc, key) { return acc + byCategory[key]; }, 0);
    const sorted = Object.keys(byCategory).sort(function (a, b) { return byCategory[b] - byCategory[a]; });

    $('#category-bars').innerHTML = sorted.length
      ? sorted.map(function (name) {
        const amount = byCategory[name];
        const pct = total ? Math.round((amount / total) * 100) : 0;
        return '<div class="cat">' +
          '<div class="cat__head"><span>' + iconOf('expense', name) + ' ' + escapeHtml(name) + '</span>' +
          '<span>$' + money(amount) + '　' + pct + '%</span></div>' +
          '<div class="cat__track"><div class="cat__fill" style="width:' + pct + '%"></div></div></div>';
      }).join('')
      : '<p class="empty">這個月還沒有支出紀錄。</p>';
  }

  function renderAll() {
    renderSummary();
    renderRecords();
    renderStats();
  }

  // ---------- 編輯 ----------

  function openEditor(id) {
    const record = state.records.filter(function (r) { return r.id === id; })[0];
    if (!record) return;
    state.editing = record;

    $('#edit-amount').value = record.amount;
    $('#edit-date').value = record.date;
    $('#edit-note').value = record.note;
    $('#edit-category').innerHTML = state.categories
      .filter(function (c) { return c.type === record.type; })
      .map(function (c) {
        const selected = c.name === record.category ? ' selected' : '';
        return '<option value="' + escapeAttr(c.name) + '"' + selected + '>' +
          (c.icon || '') + ' ' + escapeHtml(c.name) + '</option>';
      }).join('');

    $('#sheet').hidden = false;
  }

  function closeEditor() {
    $('#sheet').hidden = true;
    state.editing = null;
  }

  async function submitEdit() {
    if (!state.editing) return;
    const patch = {
      amount: Number($('#edit-amount').value),
      category: $('#edit-category').value,
      date: $('#edit-date').value,
      note: $('#edit-note').value.trim(),
    };
    if (!patch.amount) {
      toast('金額不正確', 'error');
      return;
    }

    try {
      const updated = await Api.updateRecord(state.editing.id, patch);
      state.records = state.records.map(function (r) {
        return r.id === updated.id ? updated : r;
      }).filter(function (r) {
        return r.date.slice(0, 7) === state.month;
      });
      closeEditor();
      renderAll();
      toast('已更新');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function removeEditing() {
    if (!state.editing) return;
    if (!window.confirm('確定要刪除這筆紀錄嗎？')) return;

    const id = state.editing.id;
    try {
      await Api.deleteRecord(id);
      state.records = state.records.filter(function (r) { return r.id !== id; });
      closeEditor();
      renderAll();
      toast('已刪除');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- 設定 / outbox ----------

  function renderOutbox() {
    $('#outbox-count').textContent = Api.outboxSize();
  }

  async function flushOutbox(silent) {
    if (!Api.outboxSize()) {
      renderOutbox();
      return;
    }
    const sent = await Api.flushOutbox();
    renderOutbox();
    if (sent) {
      if (!silent) toast('已補送 ' + sent + ' 筆離線紀錄');
      loadMonth();
    }
  }

  function switchView(name) {
    state.view = name;
    $$('.view').forEach(function (section) {
      section.hidden = section.dataset.view !== name;
    });
    $$('.tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.dataset.tab === name);
    });
  }

  function shiftMonth(delta) {
    const parts = state.month.split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
    state.month = monthKey(date);
    $('#month').value = state.month;
    loadMonth();
  }

  // ---------- 事件綁定 ----------

  function bindEvents() {
    $('#setup-save').addEventListener('click', async function () {
      const url = $('#setup-url').value.trim();
      const token = $('#setup-token').value.trim();
      const error = $('#setup-error');
      error.hidden = true;

      if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) {
        error.textContent = '網址看起來不對，應該以 script.google.com 開頭、/exec 結尾。';
        error.hidden = false;
        return;
      }

      Api.config.url = url;
      Api.config.token = token;
      try {
        await Api.ping();
        startApp();
      } catch (err) {
        Api.config.clear();
        error.textContent = err.message;
        error.hidden = false;
      }
    });

    $$('.type-switch__btn').forEach(function (button) {
      button.addEventListener('click', function () {
        state.type = button.dataset.type;
        $$('.type-switch__btn').forEach(function (b) {
          b.classList.toggle('is-active', b === button);
        });
        document.body.dataset.type = state.type;
        renderCategories();
      });
    });

    $('#categories').addEventListener('click', function (event) {
      const chip = event.target.closest('[data-category]');
      if (!chip) return;
      state.category = chip.dataset.category;
      renderCategories();
    });

    $$('.key').forEach(function (key) {
      key.addEventListener('click', function () { pressKey(key.dataset.key); });
    });

    $('#save').addEventListener('click', saveRecord);

    $$('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchView(tab.dataset.tab); });
    });

    $('#month-prev').addEventListener('click', function () { shiftMonth(-1); });
    $('#month-next').addEventListener('click', function () { shiftMonth(1); });
    $('#month').addEventListener('change', function () {
      state.month = $('#month').value || monthKey(new Date());
      loadMonth();
    });

    $('#search').addEventListener('input', renderRecords);
    $('#filter-type').addEventListener('change', renderRecords);

    $('#record-list').addEventListener('click', function (event) {
      const row = event.target.closest('[data-id]');
      if (row) openEditor(row.dataset.id);
    });

    $('#edit-save').addEventListener('click', submitEdit);
    $('#edit-delete').addEventListener('click', removeEditing);
    $$('#sheet [data-close]').forEach(function (el) {
      el.addEventListener('click', closeEditor);
    });

    $('#cfg-save').addEventListener('click', function () {
      Api.config.url = $('#cfg-url').value;
      Api.config.token = $('#cfg-token').value;
      $('#cfg-status').textContent = '已儲存，重新載入資料中…';
      loadCategories().then(loadMonth);
    });

    $('#cfg-test').addEventListener('click', async function () {
      $('#cfg-status').textContent = '測試中…';
      try {
        const info = await Api.ping();
        $('#cfg-status').textContent = '連線正常：' + info.service + '，後端日期 ' + info.today;
      } catch (err) {
        $('#cfg-status').textContent = '連線失敗：' + err.message;
      }
    });

    $('#outbox-flush').addEventListener('click', function () { flushOutbox(); });

    $('#cfg-reset').addEventListener('click', function () {
      if (!window.confirm('清除後需要重新輸入網址與存取碼，確定嗎？')) return;
      Api.config.clear();
      location.reload();
    });

    window.addEventListener('online', function () { flushOutbox(true); });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('#sheet').hidden) closeEditor();
    });
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function escapeAttr(text) {
    return escapeHtml(text);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 離線快取失敗不影響使用 */ });
    });
  }

  document.body.dataset.type = state.type;
  boot();
})();
