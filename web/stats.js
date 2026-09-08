/**
 * 統計頁：把後端 analytics 一次算好的數字畫成圖。
 *
 * 圖表的挑選原則（參考常見記帳 App 的做法）：
 * - 只有一個數字的事情就用大數字，不要硬畫圖
 * - 想知道「花去哪」→ 分類佔比（甜甜圈 + 排行，超過 5 類併成「其他」）
 * - 想知道「有沒有比上個月兇」→ 累積支出雙線對比
 * - 想知道「長期趨勢」→ 近 6 個月長條
 * - 想知道「消費習慣」→ 星期別平均、常買項目
 * - 想知道「還能花多少」→ 預算進度條
 */
(function () {
  'use strict';

  const $ = App.$;
  const escapeHtml = App.escapeHtml;
  const money = App.money;

  const cache = { month: null, data: null };
  let loading = false;

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  function invalidate() {
    cache.month = null;
    cache.data = null;
  }

  async function render() {
    const host = $('#stats-body');
    if (!host) return;

    if (cache.month === App.state.month && cache.data) {
      paint(host, cache.data);
      return;
    }
    if (loading) return;

    loading = true;
    host.classList.add('is-loading');   // 重新抓資料時維持舊畫面淡出，不要骨架閃爍
    if (!host.innerHTML) host.innerHTML = '<p class="empty">載入中…</p>';

    try {
      const data = await Api.analytics({ month: App.state.month, months: 6 });
      cache.month = App.state.month;
      cache.data = data;
      paint(host, data);
    } catch (err) {
      host.innerHTML = '<p class="empty">統計載入失敗：' + escapeHtml(err.message) + '</p>';
    } finally {
      loading = false;
      host.classList.remove('is-loading');
    }
  }

  function paint(host, data) {
    if (!data.totals.count) {
      host.innerHTML = '<p class="empty">這個月還沒有紀錄，記幾筆之後就會看到分析。</p>';
      return;
    }

    host.innerHTML = [
      headlineCard(data),
      trackingCard(data),
      cumulativeCard(data),
      monthlyCard(data),
      categoryCard(data),
      budgetCard(data),
      weekdayCard(data),
      notesCard(data),
    ].filter(Boolean).join('');

    drawCharts(data);
  }

  // ---------- 各張卡片 ----------

  function headlineCard(data) {
    const diff = data.totals.expense - data.previous.expense;
    const hasPrevious = data.previous.expense > 0;
    const pct = hasPrevious ? Math.round((diff / data.previous.expense) * 100) : 0;
    const trend = hasPrevious
      ? '<span class="delta ' + (diff > 0 ? 'is-up' : 'is-down') + '">' +
        (diff > 0 ? '↑' : '↓') + ' ' + Math.abs(pct) + '%　比上月' +
        (diff > 0 ? '多' : '少') + ' $' + money(Math.abs(diff)) + '</span>'
      : '<span class="muted">上個月沒有資料可比較</span>';

    return '<section class="card card--hero">' +
      '<span class="card__label">本月支出</span>' +
      '<b class="hero">$' + money(data.totals.expense) + '</b>' +
      trend +
      '<div class="hero__split">' +
        '<span>收入 <b class="is-income">$' + money(data.totals.income) + '</b></span>' +
        '<span>結餘 <b>$' + money(data.totals.balance) + '</b></span>' +
      '</div>' +
    '</section>';
  }

  function trackingCard(data) {
    const t = data.totals;
    const largest = t.largest
      ? escapeHtml(t.largest.category) + ' $' + money(t.largest.amount)
      : '—';

    return '<section class="tiles">' +
      tile('日均支出', '$' + money(t.avgPerDay), t.elapsedDays + ' 天以來') +
      tile('月底預估', '$' + money(t.projected), '照目前速度') +
      tile('記帳天數', t.activeDays + ' / ' + t.elapsedDays, '共 ' + t.count + ' 筆') +
      tile('最大單筆', largest, t.largest ? t.largest.date.slice(5) : '—') +
    '</section>';
  }

  function tile(label, value, caption) {
    return '<div class="tile">' +
      '<span class="tile__label">' + escapeHtml(label) + '</span>' +
      '<b class="tile__value">' + value + '</b>' +
      '<span class="tile__caption">' + escapeHtml(caption) + '</span>' +
    '</div>';
  }

  function cumulativeCard(data) {
    return chartCard('累積支出　本月 vs 上月',
      '<div class="legend">' +
        legendItem('var(--series-1)', '本月') +
        legendItem('var(--chart-bar)', data.previous.month) +
      '</div>' +
      '<div class="chart" id="chart-cumulative"></div>',
      '走勢在上月線之上，代表這個月花得比較快。');
  }

  function monthlyCard(data) {
    return chartCard('近 ' + data.monthly.length + ' 個月支出',
      '<div class="chart" id="chart-monthly"></div>');
  }

  function categoryCard(data) {
    if (!data.categories.length) return '';

    // 甜甜圈最多 5 段 + 「其他」，超過人眼就分不出來了
    const top = data.categories.slice(0, 5);
    const rest = data.categories.slice(5);
    const restTotal = rest.reduce(function (sum, c) { return sum + c.amount; }, 0);

    const rows = data.categories.map(function (c, i) {
      const color = i < 5 ? 'var(--series-' + (i + 1) + ')' : 'var(--chart-bar)';
      const delta = c.previous
        ? '<span class="delta ' + (c.delta > 0 ? 'is-up' : 'is-down') + '">' +
          (c.delta > 0 ? '↑' : '↓') + ' $' + money(Math.abs(c.delta)) + '</span>'
        : '<span class="delta is-new">新增</span>';

      return '<div class="cat-line">' +
        '<span class="cat-line__dot" style="background:' + color + '"></span>' +
        '<span class="cat-line__name">' + escapeHtml(c.icon + ' ' + c.category) + '</span>' +
        '<span class="cat-line__amount">$' + money(c.amount) + '</span>' +
        '<span class="cat-line__share">' + c.share + '%</span>' +
        delta +
      '</div>';
    }).join('');

    return chartCard('分類佔比',
      '<div class="donut-wrap"><div class="chart chart--donut" id="chart-donut"></div></div>' +
      '<div class="cat-lines">' + rows + '</div>',
      restTotal ? '「其他」是排名 6 之後的 ' + rest.length + ' 個分類合計。' : '');
  }

  function budgetCard(data) {
    if (!data.budgets.length) {
      return '<section class="card card--tip">還沒有設定預算。到「設定 → 管理分類」給常花的分類設一個每月上限，' +
        '這裡就會出現進度條，LINE 也會在超支時提醒你。</section>';
    }

    const rows = data.budgets.map(function (b) {
      const width = Math.min(100, b.pct);
      const mark = b.status === 'critical' ? '⛔' : (b.status === 'warning' ? '⚠️' : '✅');
      return '<div class="budget">' +
        '<div class="budget__head">' +
          '<span>' + escapeHtml(mark + ' ' + b.icon + ' ' + b.category) + '</span>' +
          '<span class="budget__num">$' + money(b.spent) + ' / ' + money(b.budget) +
            '　<b>' + b.pct + '%</b></span>' +
        '</div>' +
        '<div class="budget__track">' +
          '<div class="budget__fill is-' + b.status + '" style="width:' + width + '%"></div>' +
        '</div>' +
        '<span class="budget__caption">' +
          (b.remaining >= 0 ? '還可以花 $' + money(b.remaining) : '已超支 $' + money(-b.remaining)) +
        '</span>' +
      '</div>';
    }).join('');

    return '<section class="card"><h2 class="card__title">預算進度</h2>' + rows + '</section>';
  }

  function weekdayCard(data) {
    const busiest = data.weekday.slice().sort(function (a, b) { return b.average - a.average; })[0];
    const caption = busiest && busiest.average
      ? '週' + WEEKDAYS[busiest.weekday] + '平均花最多（$' + money(busiest.average) + '）。'
      : '';
    return chartCard('星期消費習慣', '<div class="chart" id="chart-weekday"></div>', caption);
  }

  function notesCard(data) {
    if (!data.topNotes.length) {
      return '<section class="card card--tip">記帳時多寫一點備註（例如店名、品項），' +
        '這裡就會統計出你最常花錢的項目。</section>';
    }
    const max = data.topNotes[0].amount || 1;
    const rows = data.topNotes.map(function (n) {
      return '<div class="note-row">' +
        '<div class="note-row__head">' +
          '<span>' + escapeHtml(n.note) + '<small>　' + escapeHtml(n.category) + '．' + n.count + ' 次</small></span>' +
          '<b>$' + money(n.amount) + '</b>' +
        '</div>' +
        '<div class="note-row__track"><div class="note-row__fill" style="width:' +
          Math.round((n.amount / max) * 100) + '%"></div></div>' +
      '</div>';
    }).join('');

    return '<section class="card"><h2 class="card__title">常買項目</h2>' + rows + '</section>';
  }

  function chartCard(title, body, caption) {
    return '<section class="card">' +
      '<h2 class="card__title">' + escapeHtml(title) + '</h2>' +
      body +
      (caption ? '<p class="card__caption">' + escapeHtml(caption) + '</p>' : '') +
    '</section>';
  }

  function legendItem(color, label) {
    return '<span class="legend__item">' +
      '<span class="legend__dot" style="background:' + color + '"></span>' + escapeHtml(label) + '</span>';
  }

  // ---------- 畫圖 ----------

  function drawCharts(data) {
    const fmt = function (v) { return '$' + money(v); };

    // 累積支出：本月 vs 上月（上月用灰色，是背景參考不是主角）
    const days = data.daily.length;
    const labels = data.daily.map(function (d) { return d.date.slice(5); });
    Charts.lines($('#chart-cumulative'), {
      labels: labels,
      format: fmt,
      label: '本月與上月的累積支出對比',
      series: [
        { name: data.previous.month, values: data.cumulative.previous.slice(0, days), color: 'var(--chart-bar)', dim: true },
        { name: '本月', values: data.cumulative.current.slice(0, todayIndex(data, days)), color: 'var(--series-1)' },
      ],
    });

    Charts.bars($('#chart-monthly'), {
      format: fmt,
      label: '近幾個月的支出',
      data: data.monthly.map(function (m) {
        return {
          label: m.month.slice(5) + '月',
          value: m.expense,
          highlight: m.month === data.month,
        };
      }),
    });

    const donutHost = $('#chart-donut');
    if (donutHost) {
      const top = data.categories.slice(0, 5).map(function (c, i) {
        return { label: c.category, value: c.amount, color: 'var(--series-' + (i + 1) + ')' };
      });
      const restTotal = data.categories.slice(5)
        .reduce(function (sum, c) { return sum + c.amount; }, 0);
      if (restTotal > 0) top.push({ label: '其他', value: restTotal, color: 'var(--chart-bar)' });

      Charts.donut(donutHost, {
        segments: top,
        format: fmt,
        label: '各分類支出佔比',
        center: { value: '$' + money(data.totals.expense), caption: '本月支出' },
      });
    }

    // 強調花最多的那一天，跟下面那句說明對得起來
    const busiest = data.weekday.reduce(function (best, w) {
      return (!best || w.average > best.average) ? w : best;
    }, null);
    Charts.bars($('#chart-weekday'), {
      format: fmt,
      label: '各星期的平均支出',
      data: data.weekday.map(function (w) {
        return {
          label: WEEKDAYS[w.weekday],
          value: w.average,
          highlight: busiest && w.weekday === busiest.weekday && w.average > 0,
        };
      }),
    });
  }

  /** 當月只畫到「今天」，不要讓線一路平躺到月底。 */
  function todayIndex(data, days) {
    const today = new Date();
    const nowMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    return data.month === nowMonth ? Math.min(today.getDate(), days) : days;
  }

  App.views.stats = {
    render: render,
    onShow: render,
    invalidate: invalidate,
  };
})();
