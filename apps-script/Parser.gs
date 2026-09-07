/**
 * 把一句中文轉成一筆記帳資料或一個指令。
 *
 * 支援的寫法：
 *   午餐 120           → 支出 / 餐飲 / 120 / 備註「午餐」
 *   午餐120            → 同上（數字黏在後面也可以）
 *   星巴克 大杯拿鐵 180 → 支出 / 餐飲 / 180
 *   +45000 薪水        → 收入 / 薪水 / 45000
 *   收入 30000 接案     → 收入 / 兼職 / 30000
 *   昨天 加油 800      → 日期改成昨天
 *   9/1 房租 15000     → 指定日期
 *   #交通 120 高鐵      → 用 # 指定分類
 */

const COMMAND_PATTERNS = [
  { kind: 'help', words: ['說明', '幫助', 'help', '?', '？', '教學'] },
  { kind: 'today', words: ['今天', '今日', 'today'] },
  { kind: 'yesterday', words: ['昨天', '昨日'] },
  { kind: 'month', words: ['本月', '這個月', '這月', 'month', '月報'] },
  { kind: 'lastMonth', words: ['上個月', '上月'] },
  { kind: 'list', words: ['查詢', '紀錄', '記錄', 'list', '最近'] },
  { kind: 'stats', words: ['統計', '報表', '分析', 'stats'] },
  { kind: 'undo', words: ['刪除上一筆', '刪上一筆', '收回', 'undo', '取消上一筆'] },
];

function parseMessage_(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { kind: 'unknown' };

  const lower = text.toLowerCase();

  // 1) 刪除 <id>
  const deleteMatch = text.match(/^(?:刪除|刪掉|delete|del)\s*([0-9a-z]{4,})$/i);
  if (deleteMatch) return { kind: 'delete', id: deleteMatch[1] };

  // 2) 單一指令（整句就是指令才算，避免「今天午餐120」被當成查詢）
  for (let i = 0; i < COMMAND_PATTERNS.length; i++) {
    const pattern = COMMAND_PATTERNS[i];
    for (let j = 0; j < pattern.words.length; j++) {
      if (lower === pattern.words[j]) return { kind: pattern.kind };
    }
  }

  // 3) 其餘一律嘗試解析成一筆帳
  return parseRecordText_(text);
}

function parseRecordText_(rawText) {
  let text = String(rawText).trim();
  let date = today_();
  let type = null;
  let category = null;

  // 日期前綴：今天／昨天／前天／9/1／2026-09-01
  const dateWords = [
    { words: ['今天', '今日'], offset: 0 },
    { words: ['昨天', '昨日'], offset: -1 },
    { words: ['前天'], offset: -2 },
  ];
  for (let i = 0; i < dateWords.length; i++) {
    for (let j = 0; j < dateWords[i].words.length; j++) {
      const word = dateWords[i].words[j];
      if (text.indexOf(word) === 0) {
        date = shiftDays_(dateWords[i].offset);
        text = text.slice(word.length).trim();
      }
    }
  }
  const dateMatch = text.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2})\s+/);
  if (dateMatch) {
    date = normalizeDate_(dateMatch[1]);
    text = text.slice(dateMatch[0].length).trim();
  }

  // 明確指定收入／支出
  if (/^(收入|收|income)\s*/i.test(text)) {
    type = 'income';
    text = text.replace(/^(收入|收|income)\s*/i, '').trim();
  } else if (/^(支出|花|expense)\s*/i.test(text)) {
    type = 'expense';
    text = text.replace(/^(支出|花|expense)\s*/i, '').trim();
  } else if (/^\+/.test(text)) {
    type = 'income';
    text = text.replace(/^\+/, '').trim();
  } else if (/^-/.test(text)) {
    type = 'expense';
    text = text.replace(/^-/, '').trim();
  }

  // #分類
  const tagMatch = text.match(/#([^\s#]+)/);
  if (tagMatch) {
    category = tagMatch[1];
    text = text.replace(tagMatch[0], ' ').trim();
  }

  // 金額：取最後一個數字（可含逗號、小數）
  const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g);
  if (!numbers || !numbers.length) {
    return { kind: 'unknown', reason: 'NO_AMOUNT' };
  }
  const amountText = numbers[numbers.length - 1];
  const cut = text.lastIndexOf(amountText);
  const note = (text.slice(0, cut) + ' ' + text.slice(cut + amountText.length))
    .replace(/[元塊圓$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let amount;
  try {
    amount = normalizeAmount_(amountText);
  } catch (err) {
    return { kind: 'unknown', reason: 'NO_AMOUNT' };
  }

  // 沒指定分類就用關鍵字猜，順便決定收入／支出
  if (!category) {
    const guess = guessCategory_(note);
    if (guess) {
      category = guess.category;
      if (!type) type = guess.type;
    }
  }

  return {
    kind: 'record',
    record: {
      date: date,
      type: type || 'expense',
      category: category || '其他',
      amount: amount,
      note: note,
    },
  };
}

/** 依 CATEGORY_KEYWORDS 猜分類，猜不到回 null。 */
function guessCategory_(text) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;

  for (let i = 0; i < CATEGORY_KEYWORDS.length; i++) {
    const entry = CATEGORY_KEYWORDS[i];
    for (let j = 0; j < entry.words.length; j++) {
      if (haystack.indexOf(entry.words[j]) !== -1) {
        return { type: entry.type, category: entry.category };
      }
    }
  }
  return null;
}
