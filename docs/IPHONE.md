# 裝到 iPhone 上

## 加入主畫面（最實際的做法）

1. 用 **Safari**（一定要 Safari，Chrome 加的書籤不會全螢幕）開啟你的 GitHub Pages 網址。
2. 下方 **分享** 按鈕 → **加入主畫面** → 命名「記帳」→ 加入。
3. 主畫面會出現圖示，點開後沒有網址列、沒有分頁列，跟 App 一樣。

已經處理好的細節：

- `display: standalone` + `apple-mobile-web-app-capable`：全螢幕開啟
- `apple-touch-icon.png`：主畫面圖示
- `env(safe-area-inset-*)`：瀏海與底部 Home 指示條不會蓋到內容
- `maximum-scale=1`：點輸入框不會整頁放大
- Service Worker 快取介面：飛航模式也打得開
- 離線記帳先存在裝置，回到有網路時自動補送（設定頁可看待送出筆數）

> 為什麼不直接把 Apps Script 的 `/exec` 加到主畫面？
> 那個網址是包在 Google 的 iframe 裡，Apple 的 meta 標籤吃不到，開起來仍有網址列，
> 也不能安裝 Service Worker。所以前端獨立放在 GitHub Pages，只把資料交給 Apps Script。

## Android

Chrome 開啟 → 選單 → 「安裝應用程式」／「加到主畫面」，同一份 manifest 就會生效。

## 想變成真正上架的 App？

現在這份 PWA 已經涵蓋 95% 的日常需求。若之後真的需要上架：

| 做法 | 說明 |
| --- | --- |
| **捷徑 App** | iOS「捷徑」可做一個記帳捷徑打同一個 API，能加到桌面小工具、用 Siri 語音記帳 |
| **Capacitor 包裝** | `npx cap init` 把 `web/` 包成 iOS 專案送 App Store，程式碼不用改 |
| **原生重寫** | 只有在需要小工具、Live Activity 等系統整合時才值得 |

不論哪一種，後端與資料格式都不用動——這也是把 API 和介面拆開的原因。

## 常見狀況

**加到主畫面後開起來還是有網址列**
不是用 Safari 加的，或加的是 `/exec` 網址而不是 GitHub Pages 網址。

**改了程式但手機上還是舊畫面**
Service Worker 有快取。把 App 從主畫面刪掉重加，或在 `sw.js` 把 `CACHE` 的
`pennycount-v1` 改成 `v2` 再部署。

**每次開都要重新輸入存取碼**
設定存在 `localStorage`，iOS 清除 Safari 資料時會一併清掉，重新輸入即可。
