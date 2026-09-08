/**
 * 把一句中文轉成一筆記帳資料或一個指令。
 *
 * 記帳：
 *   午餐 120           → 支出 / 餐飲 / 120 / 備註「午餐」
 *   午餐120            → 同上（數字黏在後面也可以）
 *   星巴克 大杯拿鐵 180 → 支出 / 餐飲 / 180
 *   +45000 薪水        → 收入 / 薪水 / 45000
 *   昨天 加油 800      → 日期改成昨天
 *   9/1 房租 15000     → 指定日期
 *   #交通 120 高鐵      → 用 # 指定分類
 *
 * 分類管理：
 *   分類                → 列出全部分類
 *   新增分類 🍔 早午餐   → 建立支出分類
 *   新增收入分類 💰 獎金 → 建立收入分類
 *   刪除分類 早午餐      → 刪除（既有紀錄搬到「其他」）
 *   預算 餐飲 8000       → 設定每月預算
 */

const COMMAND_PATTERNS = [
  { kind: 'help', words: ['說明', '幫助', 'help', '?', '？', '教學'] },
  { kind: 'today', words: ['今天', '今日', 'today'] },
  { kind: 'yesterday', words: ['昨天', '昨日'] },
  { kind: 'month', words: ['本月', '這個月', '這月', 'month', '月報'] },
  { kind: 'lastMonth', words: ['上個月', '上月'] },
  { kind: 'list', words: ['查詢', '紀錄', '記錄', 'list', '最近'] },
  { kind: 'stats', words: ['統計', '報表', 'stats'] },
  { kind: 'habits', words: ['分析', '習慣', '消費習慣', 'insight'] },
  { kind: 'budget', words: ['預算', 'budget'] },
  { kind: 'categories', words: ['分類', '分類清單', 'categories'] },
  { kind: 'undo', words: ['刪除上一筆', '刪上一筆', '收回', 'undo', '取消上一筆'] },
];

function parseMessage_(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { kind: 'unknown' };

  const lower = text.toLowerCase();

  // 1) 刪除 <id>
  const deleteMatch = text.match(/^(?:刪除|刪掉|delete|del)\s*([0-9a-z]{4,})$/i);
  if (deleteMatch) return { kind: 'delete', id: deleteMatch[1] };

  // 2) 分類管理（要放在單一指令之前，因為都以「分類」開頭）
  const categoryCommand = parseCategoryCommand_(text);
  if (categoryCommand) return categoryCommand;

  // 3) 單一指令（整句就是指令才算，避免「今天午餐120」被當成查詢）
  for (let i = 0; i < COMMAND_PATTERNS.length; i++) {
    const pattern = COMMAND_PATTERNS[i];
    for (let j = 0; j < pattern.words.length; j++) {
      if (lower === pattern.words[j]) return { kind: pattern.kind };
    }
  }

  // 4) 其餘一律嘗試解析成一筆帳
  return parseRecordText_(text);
}

/** 抓出訊息裡的第一個 emoji（含變體選擇符），用來把「🍔 早午餐」拆開。 */
const EMOJI_PATTERN = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/u;

/** 新增／刪除分類、設定預算。 */
function parseCategoryCommand_(text) {
  let match = text.match(/^(?:新增|加|新)(收入|支出)?分類\s+(.+)$/);
  if (match) {
    const type = match[1] === '收入' ? 'income' : 'expense';
    const rest = match[2].trim();

    // 允許「🍔 早午餐」或「早午餐 🍔」兩種寫法
    const emoji = rest.match(EMOJI_PATTERN);
    const name = rest.replace(EMOJI_PATTERN, '').replace(/\s+/g, ' ').trim();
    return {
      kind: 'addCategory',
      category: { type: type, name: name, icon: emoji ? emoji[0] : '' },
    };
  }

  match = text.match(/^(?:刪除|移除|刪掉)(?:收入|支出)?分類\s+(.+)$/);
  if (match) return { kind: 'deleteCategory', name: match[1].trim() };

  match = text.match(/^(?:預算|budget)\s+(\S+)\s+([\d,]+)$/i);
  if (match) {
    return { kind: 'setBudget', name: match[1].trim(), amount: match[2] };
  }

  return null;
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
    const guess = guessCategory_(note, type);
    if (guess) {
      category = guess.name;
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

/**
 * 依「使用者自訂的分類」猜分類：
 * 1. 備註裡直接出現分類名稱（例如「餐飲 120」）
 * 2. 命中該分類的 keywords
 * 猜不到回 null。分類與關鍵字都來自 Categories 工作表，
 * 所以使用者在網頁上新增的分類，LINE 這邊立刻就會用到。
 */
function guessCategory_(text, preferredType) {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;

  const categories = listCategories().filter(function (c) {
    return !preferredType || c.type === preferredType;
  });

  for (let i = 0; i < categories.length; i++) {
    if (haystack.indexOf(categories[i].name.toLowerCase()) !== -1) return categories[i];
  }

  let best = null;
  categories.forEach(function (category) {
    category.keywords.forEach(function (word) {
      if (haystack.indexOf(word) === -1) return;
      // 比對到比較長的關鍵字時視為更精準（「加油」勝過「油」）
      if (!best || word.length > best.length) {
        best = { length: word.length, category: category };
      }
    });
  });
  return best ? best.category : null;
}
