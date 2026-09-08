/**
 * 在第一次繪製前套用使用者選過的主題，否則選深色的人每次開啟都會先閃一下白畫面。
 *
 * 這幾行刻意獨立成一個檔案而不是寫在 <head> 裡：內容安全政策（CSP）才能維持
 * script-src 'self'，不必為了一段 inline script 開放 'unsafe-inline'。
 */
try {
  var savedTheme = localStorage.getItem('pennycount.theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    document.documentElement.dataset.theme = savedTheme;
  }
} catch (err) {
  /* 私密模式讀不到 localStorage，維持跟隨系統 */
}
