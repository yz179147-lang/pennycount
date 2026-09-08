/**
 * 極簡 SVG 圖表工具（沒有任何第三方套件）。
 *
 * 幾個共同約定：
 * - 顏色一律用 CSS 變數（var(--chart-fill)…），所以深色／淺色模式自動跟著換。
 * - 每張圖都有 hover 提示，但數值一定也能從圖旁邊的清單讀到——
 *   提示只是加分，不是唯一的閱讀方式。
 * - 格線是一條淺色實線，不用虛線（虛線會被誤讀成「預測值」）。
 * - 這裡沒有圓餅／甜甜圈：品牌色只有紫粉一個色系，撐不出 6 段能分辨的顏色
 *   （實測相鄰兩段的色差遠低於可辨識門檻），所以分類佔比改用長度編碼的排行長條。
 */
const Charts = (function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    if (parent) parent.appendChild(node);
    return node;
  }

  function svgRoot(host, width, height) {
    host.innerHTML = '';
    const svg = el('svg', {
      viewBox: '0 0 ' + width + ' ' + height,
      width: '100%',
      height: height,
      preserveAspectRatio: 'none',
      role: 'img',
    }, host);
    svg.style.overflow = 'visible';
    return svg;
  }

  /** 頂端兩角圓角的長條（底部貼齊基準線，所以不做圓角）。 */
  function barPath(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, Math.max(h, 0));
    if (h <= 0.5) return '';
    return 'M' + x + ',' + (y + h) +
      'L' + x + ',' + (y + radius) +
      'Q' + x + ',' + y + ' ' + (x + radius) + ',' + y +
      'L' + (x + w - radius) + ',' + y +
      'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + radius) +
      'L' + (x + w) + ',' + (y + h) + 'Z';
  }

  // ---------- 共用的提示泡泡 ----------

  function attachTooltip(host) {
    let tip = host.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.hidden = true;
      host.appendChild(tip);
    }
    return {
      show: function (html, xRatio) {
        tip.innerHTML = html;
        tip.hidden = false;
        // 靠近右邊界時往左靠，避免被切掉
        tip.style.left = Math.min(92, Math.max(8, xRatio * 100)) + '%';
        tip.style.transform = 'translateX(-50%)';
      },
      hide: function () { tip.hidden = true; },
    };
  }

  /**
   * 直立長條圖。用在「近幾個月支出」與「各星期平均支出」。
   * options: { data: [{label, value, highlight}], format, height, label }
   */
  function bars(host, options) {
    const data = options.data || [];
    const format = options.format || String;
    const width = 320;
    const height = options.height || 120;
    const axis = 18;
    const plot = height - axis;

    const svg = svgRoot(host, width, height + 2);
    svg.setAttribute('aria-label', options.label || '長條圖');
    const tip = attachTooltip(host);

    const max = data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;
    const slot = width / Math.max(data.length, 1);
    const barWidth = Math.min(28, slot * 0.56);

    // 基準線：一條淺色實線
    el('line', {
      x1: 0, y1: plot, x2: width, y2: plot,
      stroke: 'var(--chart-axis)', 'stroke-width': 1,
    }, svg);

    data.forEach(function (d, i) {
      const h = (d.value / max) * (plot - 12);
      const x = i * slot + (slot - barWidth) / 2;
      const y = plot - h;
      const color = d.highlight ? 'var(--chart-fill)' : 'var(--chart-bar)';

      if (h > 0.5) {
        el('path', { d: barPath(x, y, barWidth, h, 4), fill: color }, svg);
      } else {
        // 沒有金額時留一條淺淺的底線，讓人知道那天是 0 而不是沒渲染
        el('rect', { x: x, y: plot - 2, width: barWidth, height: 2, fill: 'var(--chart-bar)', opacity: .45 }, svg);
      }

      el('text', {
        x: x + barWidth / 2, y: height - 4,
        'text-anchor': 'middle', fill: 'var(--chart-label)', 'font-size': 10,
      }, svg).textContent = d.label;

      // 只直接標示被強調的那一根，其他交給 hover（每根都標會變成噪音）
      if (d.highlight && d.value > 0) {
        el('text', {
          x: x + barWidth / 2, y: Math.max(y - 5, 9),
          'text-anchor': 'middle', fill: 'var(--chart-label-strong)',
          'font-size': 10, 'font-weight': 600,
        }, svg).textContent = format(d.value);
      }

      // 觸控目標放大到整個欄位寬度，不用精準點到細長條
      const hit = el('rect', {
        x: i * slot, y: 0, width: slot, height: height,
        fill: 'transparent', style: 'cursor:pointer',
      }, svg);
      const show = function () {
        tip.show('<b>' + d.label + '</b>　' + format(d.value), (i + 0.5) / data.length);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('click', show);
      hit.addEventListener('pointerleave', tip.hide);
    });

    return svg;
  }

  /**
   * 折線圖（可多條）。用在「本月 vs 上月累積支出」。
   * options: { series: [{name, values, color, dim}], labels, format, height }
   */
  function lines(host, options) {
    const series = (options.series || []).filter(function (s) { return s.values && s.values.length; });
    if (!series.length) { host.innerHTML = ''; return null; }

    const format = options.format || String;
    const width = 320;
    const height = options.height || 130;
    const axis = 16;
    const plot = height - axis;
    const length = series.reduce(function (m, s) { return Math.max(m, s.values.length); }, 0);
    const max = series.reduce(function (m, s) {
      return Math.max(m, s.values.reduce(function (n, v) { return Math.max(n, v); }, 0));
    }, 0) || 1;

    const svg = svgRoot(host, width, height + 2);
    svg.setAttribute('aria-label', options.label || '折線圖');
    const tip = attachTooltip(host);

    const xAt = function (i) { return length > 1 ? (i / (length - 1)) * width : width / 2; };
    const yAt = function (v) { return plot - (v / max) * (plot - 10); };

    // 兩條水平格線就夠了，多了會蓋過資料
    [0.5, 1].forEach(function (ratio) {
      el('line', {
        x1: 0, y1: yAt(max * ratio), x2: width, y2: yAt(max * ratio),
        stroke: 'var(--chart-grid)', 'stroke-width': 1,
      }, svg);
    });

    series.forEach(function (s) {
      const points = s.values.map(function (v, i) { return xAt(i) + ',' + yAt(v); }).join(' ');
      el('polyline', {
        points: points,
        fill: 'none',
        stroke: s.color || 'var(--chart-fill)',
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        opacity: s.dim ? 0.85 : 1,
        'stroke-dasharray': s.dashed ? '5 4' : '',
      }, svg);

      // 只在最後一點放一個圓點並直接標值
      const last = s.values.length - 1;
      if (!s.dim && s.values[last] > 0) {
        el('circle', {
          cx: xAt(last), cy: yAt(s.values[last]), r: 4,
          fill: s.color || 'var(--chart-fill)',
          stroke: 'var(--surface)', 'stroke-width': 2,
        }, svg);
      }
    });

    const crosshair = el('line', {
      x1: 0, y1: 0, x2: 0, y2: plot,
      stroke: 'var(--chart-axis)', 'stroke-width': 1, opacity: 0,
    }, svg);

    const overlay = el('rect', {
      x: 0, y: 0, width: width, height: height, fill: 'transparent', style: 'cursor:crosshair',
    }, svg);

    const locate = function (event) {
      const box = svg.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
      const i = Math.round(ratio * (length - 1));
      crosshair.setAttribute('x1', xAt(i));
      crosshair.setAttribute('x2', xAt(i));
      crosshair.setAttribute('opacity', 1);
      tip.show(
        '<b>' + ((options.labels && options.labels[i]) || (i + 1)) + '</b><br>' +
        series.map(function (s) {
          return '<span class="chart-tip__dot" style="background:' + (s.color || 'var(--chart-fill)') + '"></span>' +
            s.name + '　' + format(s.values[i] === undefined ? 0 : s.values[i]);
        }).join('<br>'),
        i / Math.max(length - 1, 1)
      );
    };

    overlay.addEventListener('pointermove', locate);
    overlay.addEventListener('pointerdown', locate);
    overlay.addEventListener('pointerleave', function () {
      crosshair.setAttribute('opacity', 0);
      tip.hide();
    });

    return svg;
  }

  return { bars: bars, lines: lines };
})();
