# JSON API 規格

後端網址就是 Apps Script 部署後的 `/exec`。所有回應都是：

```jsonc
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "權杖錯誤，請重新輸入存取碼" } }
```

## 呼叫方式

**唯讀（GET）**：`ping`、`listRecords`、`getRecord`、`listCategories`、`categoryUsage`、
`summary`、`analytics`

```
GET /exec?action=listRecords&token=<API_TOKEN>&month=2026-09
```

**寫入（POST）**：其餘 action 一律走 POST，body 是 JSON 字串。
從瀏覽器呼叫時 **`Content-Type` 必須是 `text/plain`**——Apps Script 不回應 CORS
preflight，只有簡單請求打得進去：

```js
await fetch(url, {
  method: 'POST',
  redirect: 'follow',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'addRecord', token: TOKEN, amount: 120, category: '餐飲', note: '午餐' }),
});
```

`curl` 測試：

```bash
curl -L -X POST "$EXEC_URL" \
  -H 'Content-Type: text/plain' \
  -d '{"action":"addRecord","token":"'"$TOKEN"'","amount":120,"category":"餐飲","note":"午餐"}'
```

（`-L` 不能省：Apps Script 會 302 轉址到 `googleusercontent.com` 才回內容。）

## Action 一覽

### 紀錄

| action | 方法 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `ping` | GET | — | `{ service, version, time, timeZone, today, month }` |
| `listRecords` | GET | `month` 或 `from`/`to`、`type`、`category`、`keyword`、`limit`、`offset` | `{ items[], total, offset, limit }` |
| `getRecord` | GET | `id` | record |
| `addRecord` | POST | `date`、`type`、`category`、`amount`、`note`、`payment` | 建立好的 record |
| `updateRecord` | POST | `id` + 要修改的欄位 | 更新後的 record |
| `deleteRecord` | POST | `id` | 被刪除的 record |

### 分類

| action | 方法 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `listCategories` | GET | `includeArchived` | `[category]` |
| `categoryUsage` | GET | — | `{ "expense\|餐飲": 12, … }` 各分類的紀錄筆數 |
| `addCategory` | POST | `type`、`name`、`icon`、`keywords`、`budget` | category |
| `updateCategory` | POST | `id` + `name`／`icon`／`keywords`／`budget`／`order`／`archived` | category（改名時附 `renamedRecords`） |
| `deleteCategory` | POST | `id`、`reassignTo`（預設「其他」） | `{ deleted, movedTo, movedRecords }` |
| `reorderCategories` | POST | `ids`（新的順序陣列） | 重排後的 `[category]` |

### 統計

| action | 方法 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `summary` | GET | `month` 或 `from`/`to` | 收支總額與分類小計（LINE 用的輕量版） |
| `analytics` | GET | `month`、`months`（往回看幾個月，預設 6） | 統計頁需要的全部數字，見下方 |

## 資料格式

### record

```jsonc
{
  "id": "a1b2c3d4",          // 8 碼，LINE 上刪除時用
  "date": "2026-09-07",      // yyyy-MM-dd
  "type": "expense",         // expense | income
  "category": "餐飲",
  "amount": 120,             // 一律正數，正負由 type 決定
  "note": "午餐",
  "payment": "",             // 付款方式／帳戶，選填
  "source": "web",           // web | line | sheet
  "user": "",                // email 或 LINE userId
  "createdAt": "2026-09-07T04:20:00.000Z",
  "updatedAt": "2026-09-07T04:20:00.000Z"
}
```

寫入時的寬鬆處理：`date` 可以是 `2026/9/7`、`9/7` 或省略（=今天）；
`amount` 接受 `"1,200"`、`"$99"`；`type` 接受 `收入`／`支出`／`+`／`-`。

### category

```jsonc
{
  "id": "ca1b2c3",
  "type": "expense",
  "name": "早午餐",
  "icon": "🥐",              // 任何 emoji
  "order": 3,                // 小的排前面
  "keywords": ["蛋餅", "三明治"],  // LINE 自動分類用
  "budget": 3000,            // 每月預算，0 = 不設定
  "archived": false
}
```

- 改名（`updateCategory` 帶 `name`）會**同步把既有紀錄的分類名稱一起換掉**，
  回傳的 `renamedRecords` 是被改動的筆數。
- 刪除分類時，用到它的紀錄會改成 `reassignTo`（預設「其他」）而不是被刪掉。
- `type` 不允許修改：把收入分類改成支出會讓歷史紀錄對不上。

### analytics 回傳

```jsonc
{
  "month": "2026-09", "from": "2026-09-01", "to": "2026-09-30",
  "totals": {
    "expense": 16574, "income": 52000, "balance": 35426, "count": 7,
    "days": 30, "elapsedDays": 8, "activeDays": 4,
    "avgPerDay": 2071.75,        // 支出 ÷ 已過天數
    "projected": 62152.5,        // 照目前速度推估的月底支出
    "largest": { "amount": 15000, "category": "居住", "note": "房租", "date": "2026-09-05" }
  },
  "previous": { "month": "2026-08", "expense": 900, "income": 0 },
  "monthly":  [{ "month": "2026-04", "expense": 0, "income": 0 }],     // 近 N 個月
  "categories": [{ "category": "居住", "icon": "🏠", "amount": 15000,
                   "share": 90.5, "previous": 0, "delta": 15000, "deltaPct": null }],
  "weekday":  [{ "weekday": 0, "amount": 0, "count": 0, "days": 0, "average": 0 }],  // 0 = 週日
  "daily":    [{ "date": "2026-09-01", "expense": 0, "income": 0 }],
  "cumulative": { "current": [0, 0, 150], "previous": [0, 0, 0] },     // 逐日累積支出
  "topNotes": [{ "note": "午餐", "amount": 300, "count": 2, "category": "餐飲" }],
  "budgets":  [{ "category": "餐飲", "icon": "🍜", "budget": 2000, "spent": 300,
                 "remaining": 1700, "pct": 15, "status": "good" }]      // good|warning|critical
}
```

一次呼叫就足以畫出整個統計頁，前端不需要再自己撈全部紀錄來算。

## 錯誤碼

| code | 意思 |
| --- | --- |
| `BAD_REQUEST` | 參數不合法（金額、日期、分類名稱、缺 id） |
| `UNAUTHORIZED` | `token` 不對 |
| `NOT_FOUND` | 找不到該 id |
| `CONFLICT` | 分類改名撞到既有名稱 |
| `UNKNOWN_ACTION` | action 名稱打錯 |
| `METHOD_NOT_ALLOWED` | 寫入類 action 用 GET 呼叫 |
| `BUSY` | 20 秒內拿不到寫入鎖，重試即可 |
| `NO_SPREADSHEET` | 指令碼沒綁試算表也沒設 `SPREADSHEET_ID` |
| `INTERNAL` | 其他例外，細節在 Apps Script 的執行紀錄 |

## LINE Webhook

`POST /exec?route=line&key=<LINE_HOOK_KEY>`
不走上面的 token 驗證，也永遠回 200（LINE 只看狀態碼）；錯誤寫進 `Logs` 工作表。
