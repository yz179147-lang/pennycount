# PennyCount

用 **Google Sheet 當資料庫**、**Google Apps Script 當後端**的記帳系統。
一份資料，三個入口：手機／電腦網頁、iPhone 主畫面 App、LINE 聊天室。

```
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  網頁 / PWA    │   │  iPhone 主畫面  │   │  LINE 聊天室   │
│  記帳・紀錄・統計│   │（同一份 PWA）   │   │「午餐 120」    │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │  HTTPS / JSON     │                   │ webhook
        └───────────────────┴─────────┬─────────┘
                                      ▼
                    ┌──────────────────────────────┐
                    │  Google Apps Script（後端）    │
                    │  路由・驗證・解析・統計         │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │  Google Sheet（資料庫）        │
                    │  Records / Categories / Logs  │
                    └──────────────────────────────┘
```

## 目前完成的功能

**記帳介面**（`web/`）
- 大數字鍵盤、支出／收入切換、分類圖示、日期與備註
- 離線也能記：送不出去的先存在裝置裡，恢復連線自動補送

**紀錄介面**
- 依月份瀏覽，按日期分組並顯示每日小計
- 關鍵字搜尋、收支篩選；點任一筆可修改或刪除

**統計介面**
- 當月支出／收入／結餘、每日長條圖、分類佔比排行

**LINE 機器人**
- `午餐 120`、`星巴克 拿鐵 180`、`+45000 薪水`、`昨天 加油 800`、`9/1 房租 15000`、`#交通 120 高鐵`
- 查詢：`今天`／`昨天`／`最近`／`本月`／`上個月`／`統計`
- 刪除：`刪除 <id>`／`收回`
- 可選：每天固定時間推播當日收支

**iPhone**
- PWA + `apple-touch-icon`，Safari →「加入主畫面」後全螢幕開啟，沒有網址列

## 目錄結構

```
apps-script/        後端（貼進 Apps Script 編輯器，或用 clasp 推上去）
  Config.gs         設定、欄位定義、分類關鍵字
  WebApp.gs         doGet / doPost 進入點
  Api.gs            JSON API 路由與權杖檢查
  Store.gs          Google Sheet 讀寫（唯一碰試算表的地方）
  Parser.gs         中文語句 →一筆帳
  Line.gs           LINE webhook 與回覆訊息
  Setup.gs          setup()／示範資料／自我測試
  Util.gs           日期、金額、回應格式
web/                前端 PWA（純靜態，可放 GitHub Pages 或任何空間）
  index.html app.js api.js styles.css sw.js manifest.webmanifest icons/
docs/               安裝與使用文件
```

## 快速開始（約 10 分鐘）

1. **建立試算表**：Google Sheet 新增空白試算表 → 選單「擴充功能 → Apps Script」。
2. **貼上後端**：把 `apps-script/` 裡每個檔案照同名建立並貼進去，執行一次 `setup()`，
   記下它顯示的 `API_TOKEN`。
3. **部署**：「部署 → 新增部署作業 → 網頁應用程式」，執行身分選「我」、
   存取權選「任何人」，複製 `/exec` 網址。
4. **開前端**：把 `web/` 放上 GitHub Pages（本專案附了自動部署的 workflow），
   開啟後填入 `/exec` 網址與 `API_TOKEN` 即可開始記帳。
5. **（選用）接 LINE**：見 [docs/LINE-BOT.md](docs/LINE-BOT.md)。

詳細步驟與截圖說明：[docs/SETUP.md](docs/SETUP.md)　·　
API 規格：[docs/API.md](docs/API.md)　·　
iPhone 安裝：[docs/IPHONE.md](docs/IPHONE.md)

## 測試

改完程式不用部署就能先驗證：

```bash
npm test        # 後端：用假的 GAS 服務跑 Store / Parser / Api / LINE 全流程
npm run test:ui # 前端：假後端 + Chromium 走完記帳→紀錄→編輯→統計，截圖在 tests/shots/
                # 需要先 npm i -D playwright && npx playwright install chromium
```

在 Apps Script 編輯器裡也可以直接執行 `runSelfTest()`，結果看「執行紀錄」。

## 設計上的幾個取捨

- **前端只有一份**。網頁版和 iPhone App 版是同一套靜態檔案，靠 `fetch` 打後端 JSON API，
  不用維護兩套介面。
- **寫入用 `Content-Type: text/plain`**。Apps Script 不會回應 CORS preflight，
  text/plain 屬於簡單請求，是瀏覽器唯一能直接 POST 的方式。
- **日期以文字 `yyyy-MM-dd` 儲存**，避免試算表在不同時區被開啟時整批位移一天。
- **Apps Script 讀不到 HTTP header**，所以 LINE 的 `X-Line-Signature` 無法驗證；
  改用「網址帶密鑰 + userId 白名單」把關。

## 安全性須知

Web App 必須部署成「任何人」才能讓 LINE 和瀏覽器呼叫，等於這個網址是公開的。
保護方式：

- `setup()` 會自動產生 `API_TOKEN`，前端每次請求都要帶，沒帶就被拒絕。
- LINE webhook 網址帶 `key=<LINE_HOOK_KEY>`，並用 `LINE_ALLOWED_USER_IDS` 限制誰能記帳。
- 這些機密只存在「指令碼屬性」與你自己的裝置，**不要**寫進程式碼或 commit 進 repo。

## 後續路線圖

- [ ] LINE 圖文選單（Rich Menu）與 Flex Message 卡片化回覆
- [ ] 多帳本／多人共用（Records 已有 `user` 欄位可延伸）
- [ ] 預算設定與超支提醒（可用 Apps Script 時間觸發器推播）
- [ ] 匯出 CSV／月報自動寄信
