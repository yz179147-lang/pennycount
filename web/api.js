/**
 * 與 Apps Script 後端溝通的薄薄一層。
 *
 * 兩個重點：
 * 1. 寫入用 POST + Content-Type: text/plain。Apps Script 不會回應 CORS preflight，
 *    text/plain 屬於「簡單請求」不會觸發 preflight，這是唯一能從瀏覽器直接打的方式。
 * 2. 離線或送出失敗時，寫入請求會進 outbox（localStorage），連線恢復後自動補送。
 */
const Api = (function () {
  const KEY_URL = 'pennycount.url';
  const KEY_TOKEN = 'pennycount.token';
  const KEY_OUTBOX = 'pennycount.outbox';

  const config = {
    get url() { return localStorage.getItem(KEY_URL) || ''; },
    set url(value) { localStorage.setItem(KEY_URL, String(value || '').trim()); },
    get token() { return localStorage.getItem(KEY_TOKEN) || ''; },
    set token(value) { localStorage.setItem(KEY_TOKEN, String(value || '').trim()); },
    get isReady() { return Boolean(config.url); },
    clear() {
      localStorage.removeItem(KEY_URL);
      localStorage.removeItem(KEY_TOKEN);
    },
  };

  function readOutbox() {
    try {
      return JSON.parse(localStorage.getItem(KEY_OUTBOX) || '[]');
    } catch (err) {
      return [];
    }
  }

  function writeOutbox(items) {
    localStorage.setItem(KEY_OUTBOX, JSON.stringify(items));
  }

  function queue(action, params) {
    const items = readOutbox();
    items.push({ action: action, params: params, queuedAt: new Date().toISOString() });
    writeOutbox(items);
  }

  /** 唯讀查詢：GET + query string。 */
  async function get(action, params) {
    const url = new URL(config.url);
    url.searchParams.set('action', action);
    if (config.token) url.searchParams.set('token', config.token);
    Object.keys(params || {}).forEach(function (key) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });

    const response = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return unwrap(await response.text());
  }

  /** 寫入：POST + text/plain（避免 CORS preflight）。 */
  async function post(action, params) {
    const body = Object.assign({ action: action, token: config.token }, params || {});
    const response = await fetch(config.url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return unwrap(await response.text());
  }

  function unwrap(text) {
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      // 多半是被導到 Google 登入頁：部署時存取權沒選「任何人」
      throw new Error('後端回應不是 JSON，請確認部署的存取權設定為「任何人」。');
    }
    if (!payload.ok) {
      const error = new Error((payload.error && payload.error.message) || '未知錯誤');
      error.code = payload.error && payload.error.code;
      throw error;
    }
    return payload.data;
  }

  /** 寫入動作的包裝：失敗且看起來是網路問題時，丟進 outbox。 */
  async function write(action, params, options) {
    try {
      return await post(action, params);
    } catch (err) {
      const queueable = (options && options.queueable) && !err.code;
      if (queueable) {
        queue(action, params);
        const offline = new Error('目前離線，已排入待送出清單。');
        offline.queued = true;
        throw offline;
      }
      throw err;
    }
  }

  return {
    config: config,

    ping: function () { return get('ping'); },
    listRecords: function (filter) { return get('listRecords', filter); },
    summary: function (filter) { return get('summary', filter); },
    analytics: function (filter) { return get('analytics', filter); },

    addRecord: function (record) { return write('addRecord', record, { queueable: true }); },
    updateRecord: function (id, patch) { return write('updateRecord', Object.assign({ id: id }, patch)); },
    deleteRecord: function (id) { return write('deleteRecord', { id: id }); },

    listCategories: function () { return get('listCategories'); },
    categoryUsage: function () { return get('categoryUsage'); },
    addCategory: function (category) { return write('addCategory', category); },
    updateCategory: function (id, patch) { return write('updateCategory', Object.assign({ id: id }, patch)); },
    deleteCategory: function (id, reassignTo) { return write('deleteCategory', { id: id, reassignTo: reassignTo }); },
    reorderCategories: function (ids) { return write('reorderCategories', { ids: ids }); },

    outboxSize: function () { return readOutbox().length; },

    /** 逐筆補送 outbox，回傳成功筆數。 */
    flushOutbox: async function () {
      const items = readOutbox();
      if (!items.length || !config.isReady) return 0;

      const remaining = [];
      let sent = 0;
      for (const item of items) {
        try {
          await post(item.action, item.params);
          sent += 1;
        } catch (err) {
          if (err.code) continue;   // 資料本身有問題（例如金額不合法），丟掉不再重試
          remaining.push(item);     // 網路問題，留著下次再送
        }
      }
      writeOutbox(remaining);
      return sent;
    },
  };
})();
