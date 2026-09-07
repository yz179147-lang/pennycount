# 接上 LINE Bot

做完 [SETUP.md](SETUP.md) 之後，再花 10 分鐘就能在 LINE 聊天室記帳。
資料和網頁版是同一份，記完馬上能在網頁上看到。

## 1. 建立 Messaging API Channel

1. 到 [LINE Developers Console](https://developers.line.biz/console/) 用 LINE 帳號登入。
2. 建立 **Provider**（隨便取名，例如自己的名字）。
3. 在 Provider 底下建立 **Channel → Messaging API**，填名稱（例如「我的記帳」）、
   類別隨意，同意條款後建立。

## 2. 取得金鑰並填進 Apps Script

在 Channel 頁面：

- **Messaging API 分頁** → 最下方 **Channel access token (long-lived)** → 按 **Issue** → 複製。

回到 Apps Script **專案設定 → 指令碼屬性**，新增：

| 屬性 | 值 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | 剛剛複製的長期存取權杖 |
| `LINE_ALLOWED_USER_IDS` | 先留空，第 4 步再填 |

（`LINE_HOOK_KEY` 在 `setup()` 時已自動產生，可從「PennyCount → 顯示金鑰與網址」查看。）

## 3. 設定 Webhook

Webhook URL 是「你的 `/exec` 網址」加上兩個參數：

```
https://script.google.com/macros/s/AKfy.../exec?route=line&key=<LINE_HOOK_KEY>
```

在 Channel 的 **Messaging API 分頁**：

1. **Webhook URL** 貼上上面的網址 → **Update**。
   （按 Verify 可能顯示錯誤，因為驗證請求沒有 events，不影響實際使用。）
2. **Use webhook** 打開。
3. 往下把 **Auto-reply messages**、**Greeting messages** 關掉，
   否則機器人會一直回官方罐頭訊息。

## 4. 加好友並鎖定只有自己能用

用 Messaging API 分頁的 QR code 加機器人好友，隨便傳一句話。
機器人會回覆你的 `userId`（因為白名單還是空的，第一次會直接放行並回覆說明）。

要知道自己的 userId：先把 `LINE_ALLOWED_USER_IDS` 填成 `x`（隨便一個值）再傳訊息，
機器人會回「這個帳本沒有開放給你使用。你的 userId：Uxxxxxxxx…」，
把那串 `U` 開頭的 ID 填回 `LINE_ALLOWED_USER_IDS` 即可。多人用逗號分隔。

> ⚠️ 留空代表任何加好友的人都能記到你的帳本裡，正式使用請務必填上。

## 5. 開始用

| 你打的話 | 結果 |
| --- | --- |
| `午餐 120` | 支出 · 餐飲 · 120 · 備註「午餐」 |
| `星巴克 大杯拿鐵 180` | 支出 · 餐飲 · 180 |
| `+45000 薪水` | 收入 · 薪水 · 45000 |
| `收入 30000 接案` | 收入 · 兼職 · 30000 |
| `昨天 加油 800` | 日期記成昨天 · 交通 |
| `9/1 房租 15000` | 指定日期 · 居住 |
| `#教育 1200 線上課程` | 用 `#` 直接指定分類 |
| `今天` / `昨天` / `最近` | 列出該區間的紀錄（含 id） |
| `本月` / `上個月` / `統計` | 收支總覽與支出前五名 |
| `刪除 a1b2c3d4` | 刪掉指定 id 的紀錄 |
| `收回` | 刪掉自己最後記的那一筆 |
| `說明` | 顯示用法 |

分類是用關鍵字猜的，對照表在 `apps-script/Config.gs` 的 `CATEGORY_KEYWORDS`，
想加自己的口頭禪（例如「全家」「大苑子」）直接改那份陣列即可，記得重新部署。

## 6.（選用）每天自動回報

Apps Script 左側 **觸發條件 → 新增觸發條件**：

- 函式：`sendDailySummary`
- 事件來源：時間驅動 → 日計時器 → 晚上 9 點到 10 點

每天就會把當天的收支推播到你的 LINE。

## 疑難排解

**傳訊息機器人完全沒反應**
1. 檢查 Webhook URL 的 `key` 是否和 `LINE_HOOK_KEY` 一致。
2. 改過後端程式碼後有沒有重新「部署新版本」（舊網址仍指向舊版）。
3. 打開試算表的 `Logs` 工作表，看有沒有 `line_reject` / `line_error`。

**回覆說「⚠️ 處理失敗」**
`Logs` 工作表裡有完整錯誤訊息，多半是 `LINE_CHANNEL_ACCESS_TOKEN` 沒填或過期。

**為什麼不驗證 X-Line-Signature？**
Apps Script 的 `doPost(e)` 拿不到 HTTP header，官方沒有提供這個能力，
所以改用網址密鑰 + userId 白名單。這對個人帳本足夠；
若要正式對外服務，建議改用 Cloud Functions 之類能讀 header 的環境。
