/**
 * 與 Apps Script 後端溝通的薄薄一層。
 *
 * 兩個重點：
 * 1. 一律用 POST + Content-Type: text/plain。Apps Script 不會回應 CORS preflight，
 *    text/plain 屬於「簡單請求」不會觸發 preflight，這是唯一能從瀏覽器直接打的方式；
 *    而且把存取碼放在 body 而不是網址，密鑰才不會留在瀏覽器歷史與各種紀錄裡。
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

  /**
   * 所有請求都走 POST + text/plain。
   *
   * 讀取原本是 GET，但那會把存取碼帶進網址，於是它會留在瀏覽器歷史紀錄、
   * Apps Script 的執行紀錄，以及你截圖或分享畫面的時候。改成放進 request body
   * 之後，網址就再也不會出現密鑰。
   *
   * 用 text/plain 而不是 application/json 是因為 Apps Script 不回應 CORS
   * preflight，只有「簡單請求」打得進去。
   */
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

    ping: function () { return post('ping'); },
    listRecords: function (filter) { return post('listRecords', filter); },
    summary: function (filter) { return post('summary', filter); },
    analytics: function (filter) { return post('analytics', filter); },

    addRecord: function (record) { return write('addRecord', record, { queueable: true }); },
    updateRecord: function (id, patch) { return write('updateRecord', Object.assign({ id: id }, patch)); },
    deleteRecord: function (id) { return write('deleteRecord', { id: id }); },

    listCategories: function () { return post('listCategories'); },
    categoryUsage: function () { return post('categoryUsage'); },
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
