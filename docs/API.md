# JSON API 規格

後端網址就是 Apps Script 部署後的 `/exec`。所有回應都是：

```jsonc
{ "ok": true,  "data": { } }
{ "ok": false, "error": { "code": "UNAUTHORIZED", "message": "權杖錯誤，請重新輸入存取碼" } }
```

## 呼叫方式

**唯讀（GET）**：`ping`、`listRecords`、`getRecord`、`listCategories`、`summary`

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

| action | 方法 | 參數 | 回傳 |
| --- | --- | --- | --- |
| `ping` | GET | — | `{ service, time, timeZone, today }` |
| `listRecords` | GET | `month` 或 `from`/`to`、`type`、`category`、`keyword`、`limit`、`offset` | `{ items[], total, offset, limit }` |
| `getRecord` | GET | `id` | record |
| `summary` | GET | `month` 或 `from`/`to` | 見下方 |
| `listCategories` | GET | — | `[{ type, name, icon, order }]` |
| `addRecord` | POST | `date`、`type`、`category`、`amount`、`note`、`payment` | 建立好的 record |
| `updateRecord` | POST | `id` + 要修改的欄位 | 更新後的 record |
| `deleteRecord` | POST | `id` | 被刪除的 record |
| `addCategory` | POST | `type`、`name`、`icon`、`order` | 分類 |

### record 物件

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

### summary 回傳

```jsonc
{
  "from": "2026-09-01", "to": "2026-09-30",
  "count": 42, "expense": 18234, "income": 52000, "balance": 33766,
  "categories": [{ "type": "expense", "category": "居住", "amount": 15000 }],
  "daily":      [{ "date": "2026-09-01", "expense": 320, "income": 0 }]
}
```

## 錯誤碼

| code | 意思 |
| --- | --- |
| `BAD_REQUEST` | 參數不合法（金額、日期、缺 id） |
| `UNAUTHORIZED` | `token` 不對 |
| `NOT_FOUND` | 找不到該 id |
| `UNKNOWN_ACTION` | action 名稱打錯 |
| `METHOD_NOT_ALLOWED` | 寫入類 action 用 GET 呼叫 |
| `BUSY` | 20 秒內拿不到寫入鎖，重試即可 |
| `NO_SPREADSHEET` | 指令碼沒綁試算表也沒設 `SPREADSHEET_ID` |
| `INTERNAL` | 其他例外，細節在 Apps Script 的執行紀錄 |

## LINE Webhook

`POST /exec?route=line&key=<LINE_HOOK_KEY>`
不走上面的 token 驗證，也永遠回 200（LINE 只看狀態碼）；錯誤寫進 `Logs` 工作表。
