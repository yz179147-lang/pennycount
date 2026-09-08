/**
 * 啟動點：等 api / charts / app / categories / stats 都載入並註冊完成後才開始跑。
 *
 * 這一行刻意獨立成檔案而不是寫在 HTML 裡，內容安全政策才能維持
 * script-src 'self'，不必為了一行程式開放 'unsafe-inline'。
 */
App.boot();
