/**
 * 分類管理：新增、改名、換圖示、設預算、設 LINE 關鍵字、排序、刪除。
 * 所有變更都會立刻寫回 Google Sheet，所以網頁改完，LINE 那邊馬上就吃得到。
 */
(function () {
  'use strict';

  const $ = App.$;
  const $$ = App.$$;
  const escapeHtml = App.escapeHtml;

  /** emoji 選單，照生活場景分組。找不到想要的就直接貼上任何 emoji。 */
  const EMOJI_GROUPS = [
    { name: '飲食', items: ['🍜', '🍚', '🍔', '🍕', '🍱', '🥐', '🍞', '🥗', '🍳', '☕', '🧋', '🍺', '🍰', '🍎', '🛒', '🍢'] },
    { name: '交通', items: ['🚌', '🚇', '🚕', '🚗', '⛽', '🅿️', '🚲', '✈️', '🚄', '🛵', '🚏', '🛴'] },
    { name: '生活', items: ['🏠', '💡', '💧', '🔥', '📶', '🧻', '🧺', '🛋️', '🔧', '🧹', '🪑', '🧴'] },
    { name: '購物', items: ['🛍️', '👕', '👟', '👜', '💄', '📱', '💻', '🎧', '⌚', '📦', '🎁', '💍'] },
    { name: '娛樂', items: ['🎮', '🎬', '🎤', '🎫', '🏖️', '⚽', '🏋️', '📷', '🎨', '🎲', '🎸', '🏕️'] },
    { name: '健康', items: ['💊', '🏥', '🦷', '👓', '💉', '🧘', '🩺', '🧴'] },
    { name: '學習', items: ['📚', '✏️', '🎓', '📝', '🖥️', '🔬', '🎼', '🗂️'] },
    { name: '收入', items: ['💼', '💰', '🏆', '📈', '🧰', '🏦', '🎯', '🤝', '🪙', '💵'] },
    { name: '其他', items: ['🐶', '🐱', '👶', '🎂', '🧧', '❤️', '🙏', '✈️', '🏷️', '❓'] },
  ];

  const state = {
    type: 'expense',
    editing: null,   // 正在編輯的分類，null = 新增
    icon: '🏷️',
    usage: {},
  };

  // ---------- 清單 ----------

  function render() {
    const host = $('#category-manager');
    if (!host) return;

    const list = App.state.categories.filter(function (c) { return c.type === state.type; });
    if (!list.length) {
      host.innerHTML = '<p class="empty">還沒有分類，按下面的「新增分類」建立第一個。</p>';
      return;
    }

    host.innerHTML = list.map(function (category, i) {
      const used = state.usage[category.type + '|' + category.name] || 0;
      const meta = [];
      if (category.budget) meta.push('預算 $' + App.money(category.budget));
      if (used) meta.push(used + ' 筆');
      if (category.keywords && category.keywords.length) {
        meta.push('關鍵字 ' + category.keywords.slice(0, 3).join('、') +
          (category.keywords.length > 3 ? '…' : ''));
      }

      return '<div class="cat-row" data-id="' + escapeHtml(category.id) + '">' +
        '<button class="cat-row__main" data-edit="' + escapeHtml(category.id) + '">' +
          '<span class="cat-row__icon">' + escapeHtml(category.icon) + '</span>' +
          '<span class="cat-row__text"><b>' + escapeHtml(category.name) + '</b>' +
            (meta.length ? '<small>' + escapeHtml(meta.join('　·　')) + '</small>' : '') +
          '</span>' +
        '</button>' +
        '<span class="cat-row__tools">' +
          '<button class="icon-btn" data-move="up" data-index="' + i + '"' +
            (i === 0 ? ' disabled' : '') + ' aria-label="上移">↑</button>' +
          '<button class="icon-btn" data-move="down" data-index="' + i + '"' +
            (i === list.length - 1 ? ' disabled' : '') + ' aria-label="下移">↓</button>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  function onShow() {
    render();
    // 用量只是輔助資訊，載入失敗就算了
    Api.categoryUsage().then(function (usage) {
      state.usage = usage || {};
      render();
    }).catch(function () { /* 忽略 */ });
  }

  async function move(index, direction) {
    const list = App.state.categories.filter(function (c) { return c.type === state.type; });
    const target = index + (direction === 'up' ? -1 : 1);
    if (target < 0 || target >= list.length) return;

    const reordered = list.slice();
    const moved = reordered.splice(index, 1)[0];
    reordered.splice(target, 0, moved);

    // 先在畫面上換位置，感覺比較即時；失敗再重讀
    const others = App.state.categories.filter(function (c) { return c.type !== state.type; });
    App.state.categories = state.type === 'expense'
      ? reordered.concat(others)
      : others.concat(reordered);
    render();

    try {
      App.state.categories = await Api.reorderCategories(reordered.map(function (c) { return c.id; }));
      App.renderCategoryChips();
      render();
    } catch (err) {
      App.toast(err.message, 'error');
      App.loadCategories();
    }
  }

  // ---------- 新增／編輯面板 ----------

  function buildEmojiPicker() {
    const tabs = $('#emoji-tabs');
    const grid = $('#emoji-grid');
    if (!tabs || tabs.dataset.ready) return;

    tabs.innerHTML = EMOJI_GROUPS.map(function (group, i) {
      return '<button class="emoji-tab' + (i === 0 ? ' is-active' : '') +
        '" data-group="' + i + '">' + group.name + '</button>';
    }).join('');
    tabs.dataset.ready = '1';

    const showGroup = function (index) {
      grid.innerHTML = EMOJI_GROUPS[index].items.map(function (emoji) {
        return '<button class="emoji" data-emoji="' + emoji + '">' + emoji + '</button>';
      }).join('');
      markSelected();
    };

    tabs.addEventListener('click', function (event) {
      const tab = event.target.closest('[data-group]');
      if (!tab) return;
      $$('.emoji-tab').forEach(function (t) { t.classList.toggle('is-active', t === tab); });
      showGroup(Number(tab.dataset.group));
    });

    grid.addEventListener('click', function (event) {
      const button = event.target.closest('[data-emoji]');
      if (!button) return;
      setIcon(button.dataset.emoji);
    });

    $('#category-icon').addEventListener('input', function (event) {
      const value = event.target.value.trim();
      if (value) setIcon(value, true);
    });

    showGroup(0);
  }

  function markSelected() {
    $$('#emoji-grid .emoji').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.emoji === state.icon);
    });
  }

  function setIcon(icon, fromInput) {
    state.icon = icon;
    $('#icon-preview').textContent = icon;
    if (!fromInput) $('#category-icon').value = '';
    markSelected();
  }

  function openNew(type) {
    state.editing = null;
    state.type = type || state.type;
    syncTypeTabs();

    $('#category-sheet-title').textContent = '新增' + (state.type === 'income' ? '收入' : '支出') + '分類';
    $('#category-name').value = '';
    $('#category-budget').value = '';
    $('#category-keywords').value = '';
    $('#category-icon').value = '';
    $('#category-delete').hidden = true;
    $('#category-error').hidden = true;
    buildEmojiPicker();
    setIcon(state.type === 'income' ? '💰' : '🏷️');
    $('#category-sheet').hidden = false;
    $('#category-name').focus();
  }

  function openEdit(id) {
    const category = App.state.categories.filter(function (c) { return c.id === id; })[0];
    if (!category) return;

    state.editing = category;
    $('#category-sheet-title').textContent = '編輯分類';
    $('#category-name').value = category.name;
    $('#category-budget').value = category.budget || '';
    $('#category-keywords').value = (category.keywords || []).join(', ');
    $('#category-icon').value = '';
    $('#category-delete').hidden = false;
    $('#category-error').hidden = true;
    buildEmojiPicker();
    setIcon(category.icon || '🏷️');
    $('#category-sheet').hidden = false;
  }

  function close() {
    $('#category-sheet').hidden = true;
    state.editing = null;
  }

  function showError(message) {
    const error = $('#category-error');
    error.textContent = message;
    error.hidden = false;
  }

  async function save() {
    const name = $('#category-name').value.trim();
    if (!name) return showError('請先輸入分類名稱');

    const payload = {
      name: name,
      icon: state.icon,
      budget: Number($('#category-budget').value) || 0,
      keywords: $('#category-keywords').value,
    };

    const button = $('#category-save');
    button.disabled = true;
    try {
      if (state.editing) {
        await Api.updateCategory(state.editing.id, payload);
        App.toast('已更新分類');
      } else {
        payload.type = state.type;
        await Api.addCategory(payload);
        App.toast('已新增分類 ' + state.icon + ' ' + name);
      }
      close();
      await App.loadCategories();
      await App.loadMonth();   // 改名會影響既有紀錄，重讀一次比較保險
      onShow();
    } catch (err) {
      showError(err.message);
    } finally {
      button.disabled = false;
    }
  }

  async function remove() {
    if (!state.editing) return;
    const used = state.usage[state.editing.type + '|' + state.editing.name] || 0;
    const message = used
      ? '刪除「' + state.editing.name + '」後，這 ' + used + ' 筆紀錄會改成「其他」。確定嗎？'
      : '確定要刪除「' + state.editing.name + '」嗎？';
    if (!window.confirm(message)) return;

    try {
      const result = await Api.deleteCategory(state.editing.id);
      close();
      await App.loadCategories();
      await App.loadMonth();
      onShow();
      App.toast(result.movedRecords
        ? '已刪除，' + result.movedRecords + ' 筆紀錄改到「' + result.movedTo + '」'
        : '已刪除分類');
    } catch (err) {
      showError(err.message);
    }
  }

  function syncTypeTabs() {
    $$('.type-switch__btn[data-cattype]').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.cattype === state.type);
    });
  }

  // ---------- 綁定 ----------

  $$('.type-switch__btn[data-cattype]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.type = button.dataset.cattype;
      syncTypeTabs();
      render();
    });
  });

  $('#category-manager').addEventListener('click', function (event) {
    const moveButton = event.target.closest('[data-move]');
    if (moveButton) {
      move(Number(moveButton.dataset.index), moveButton.dataset.move);
      return;
    }
    const editButton = event.target.closest('[data-edit]');
    if (editButton) openEdit(editButton.dataset.edit);
  });

  $('#category-add').addEventListener('click', function () { openNew(state.type); });
  $('#category-save').addEventListener('click', save);
  $('#category-delete').addEventListener('click', remove);
  $('#icon-preview').addEventListener('click', function () { $('#category-icon').focus(); });
  $$('#category-sheet [data-close]').forEach(function (element) {
    element.addEventListener('click', close);
  });

  App.views.categories = {
    render: render,
    onShow: onShow,
    openNew: openNew,
    openEdit: openEdit,
    close: close,
  };
})();
