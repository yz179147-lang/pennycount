# 安裝指南

從零到可以記帳，大約 10 分鐘。全程只需要一個 Google 帳號。

---

## 步驟 1：建立試算表與後端

1. 開 [sheets.new](https://sheets.new) 建立空白試算表，命名例如「我的帳本」。
2. 選單 **擴充功能 → Apps Script**，會開啟一個綁定這張表的指令碼專案。
3. 把左側預設的 `Code.gs` 刪掉，依序建立以下檔案（左側 ➕ → 指令碼），
   檔名要一致，內容從本專案 `apps-script/` 複製貼上：

   | 建立的檔名 | 對應本專案檔案 |
   | --- | --- |
   | `Config.gs` | `apps-script/Config.gs` |
   | `Util.gs` | `apps-script/Util.gs` |
   | `Store.gs` | `apps-script/Store.gs` |
   | `Api.gs` | `apps-script/Api.gs` |
   | `WebApp.gs` | `apps-script/WebApp.gs` |
   | `Parser.gs` | `apps-script/Parser.gs` |
   | `Line.gs` | `apps-script/Line.gs` |
   | `Setup.gs` | `apps-script/Setup.gs` |

4. 左側 **專案設定** → 勾選「在編輯器中顯示 `appsscript.json` 資訊清單檔案」，
   然後把 `apps-script/appsscript.json` 的內容整份貼上覆蓋。
   （時區預設 `Asia/Taipei`，要改成其他時區就改這裡。）

> 偏好用指令列的話：`npm i -g @google/clasp` → `clasp login` →
> 複製 `.clasp.json.example` 成 `.clasp.json` 填入 scriptId → `clasp push`。

## 步驟 2：初始化

在編輯器上方的函式下拉選單選 **`setup`**，按 **執行**。
第一次會要求授權（畫面會說「這個應用程式未經驗證」→ 進階 → 前往…），
授權對象是你自己寫的指令碼，同意即可。

執行完會在「執行紀錄」顯示：

```
安裝完成 ✅
API_TOKEN（前端首次開啟時要輸入）：xxxxxxxxxxxx
LINE_HOOK_KEY（webhook 網址的 key 參數）：xxxxxxxx
```

**把 `API_TOKEN` 記下來。** 之後忘記可以在試算表選單
「PennyCount → 顯示金鑰與網址」查看（重新整理試算表後才會出現這個選單）。

此時試算表會多出三張工作表：

| 工作表 | 用途 |
| --- | --- |
| `Records` | 所有帳目。欄位：id / date / type / category / amount / note / payment / source / user / createdAt / updatedAt |
| `Categories` | 分類設定，見下表 |
| `Logs` | LINE webhook 的錯誤紀錄，除錯用 |

`Categories` 的欄位：

| 欄位 | 說明 |
| --- | --- |
| `id` | 系統產生，不要手動改（改名時靠它認人） |
| `type` | `expense` 或 `income` |
| `name` | 顯示名稱，12 字以內 |
| `icon` | 任何 emoji |
| `order` | 排序，小的排前面 |
| `keywords` | 逗號分隔。LINE 上打到這些字就會自動歸到這一類 |
| `budget` | 每月預算，0 = 不設定。統計頁會顯示進度條 |
| `archived` | `TRUE` = 收起來不再出現在選單，但歷史紀錄保留 |

> 這三張表都是**依表頭名稱**對應欄位，不是靠位置。
> 你可以自己調換欄位順序、或在右邊加自己的欄位，程式不會弄壞它們。
>
> 分類平常在**網頁的「設定 → 管理分類」**維護就好（可以挑 emoji、設預算、調順序），
> 不需要手動編輯這張表。

想先看看畫面長怎樣，可以執行 `seedDemoData()` 塞三個月的假資料
（統計頁的月度趨勢才有東西可看），之後手動刪掉整批 `source = sheet` 的列即可。

## 步驟 3：部署成 Web App

**部署 → 新增部署作業 → 類型選「網頁應用程式」**

| 欄位 | 選擇 |
| --- | --- |
| 執行身分 | **我**（資料寫進你的試算表） |
| 具有應用程式存取權的使用者 | **任何人** |

> 必須選「任何人」，因為 LINE 伺服器和瀏覽器都是以匿名身分呼叫。
> 網址本身等於公開，安全性靠 `API_TOKEN` 與 `LINE_HOOK_KEY` 把關。

複製產生的網址（結尾是 `/exec`），瀏覽器打開應該看到「PennyCount API」說明頁，
加上 `?action=ping` 會回傳 JSON，代表後端正常。

⚠️ **之後每次改後端程式碼，都要「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選『新版本』→ 部署」，
否則線上跑的還是舊版。**

> 只改指令碼屬性（`API_TOKEN`、`LINE_ALLOWED_USER_IDS`…）不用重新部署，
> 那些是執行時才讀的。

## 步驟 4：發佈前端

### 方式 A：GitHub Pages（推薦，iPhone 要用這個）

1. 把這個 repo 推上 GitHub。
2. **Settings → Pages → Source** 選 **GitHub Actions**。
3. 推送任何 `web/` 底下的變更，`.github/workflows/pages.yml` 會自動部署，
   網址是 `https://<帳號>.github.io/<repo>/`。

### 方式 B：本機直接開

`web/index.html` 用瀏覽器開啟即可運作（Service Worker 在 `file://` 下不會啟用，
其他功能正常）。要完整測試 PWA 可以在 `web/` 執行 `python3 -m http.server 8080`。

## 步驟 5：連線

第一次開啟前端會出現設定畫面：

- **Apps Script 網頁應用程式網址**：步驟 3 的 `/exec` 網址
- **存取碼**：步驟 2 的 `API_TOKEN`

按「連線」，成功就進入記帳畫面。這兩項只存在這台裝置的 `localStorage`，
換裝置要重新輸入（設定頁可隨時修改）。

---

## 指令碼屬性一覽

**專案設定 → 指令碼屬性**，全部都是選填（`setup()` 會自動產生前兩項）：

| 屬性 | 說明 |
| --- | --- |
| `API_TOKEN` | 前端存取碼。留空 = 不驗證（只建議測試時） |
| `LINE_HOOK_KEY` | LINE webhook 網址的 `key` 參數 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Channel 的長期存取權杖 |
| `LINE_ALLOWED_USER_IDS` | 允許記帳的 LINE userId，逗號分隔。留空 = 不限制 |
| `SPREADSHEET_ID` | 指定另一張試算表；留空 = 用綁定的那張 |
| `WEB_APP_URL` | 前端網址，填了之後後端說明頁會出現連結 |

## 常見問題

**開啟前端顯示「後端回應不是 JSON」**
部署時存取權沒選「任何人」，請求被導去 Google 登入頁了。回到「管理部署作業」改掉。

**「權杖錯誤，請重新輸入存取碼」**
前端的存取碼和指令碼屬性的 `API_TOKEN` 不一致，到設定頁重新貼一次。

**改了程式卻沒生效**
沒有建立新版本部署，見步驟 3 的提醒。

**日期少了一天**
`appsscript.json` 的 `timeZone` 要和你所在時區一致（台灣是 `Asia/Taipei`）。

**多人同時記帳會不會撞到**
不會，所有寫入都經過 `LockService`，一次只有一個請求能改試算表。
