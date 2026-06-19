(function (PLUGIN_ID) {
  'use strict';

  // 設定はこの1キーにJSON文字列でまとめて保存する
  // (get/setConfigは「文字列のKey-Value」しか保存できないため)
  var CONFIG_KEY = 'config';

  // 取得したフィールド定義(保存時に各列のフォーマット情報を取り出すため保持)
  var loadedProps = {};

  function ready(fn) {
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function loadSettings() {
    var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
    var s = {};
    try { s = JSON.parse((saved && saved[CONFIG_KEY]) || '{}'); } catch (e) { s = {}; }
    s.tables = s.tables || {};
    return s;
  }

  ready(function () {
    var settings = loadSettings();

    var tablesEl = document.getElementById('kxc-tables');
    tablesEl.textContent = '読み込み中...';

    // フィールド定義(ラベル)と、フォームレイアウト(列の正しい並び順)を取得
    var appId = kintone.app.getId();
    Promise.all([
      kintone.api(kintone.api.url('/k/v1/app/form/fields.json', true), 'GET', { app: appId }),
      kintone.api(kintone.api.url('/k/v1/app/form/layout.json', true), 'GET', { app: appId })
    ]).then(function (res) {
      var properties = (res[0] && res[0].properties) || {};
      var orders = subtableFieldOrders((res[1] && res[1].layout) || []);
      renderTables(properties, orders, settings, tablesEl);
    }).catch(function (e) {
      tablesEl.textContent = 'フィールド情報の取得に失敗しました。';
      console.error('[モバイル表形式 設定]', e);
    });

    document.getElementById('kxc-save').addEventListener('click', save);
    document.getElementById('kxc-cancel').addEventListener('click', function () {
      window.location.href = '../../' + 'flow?app=' + kintone.app.getId() + '&mode=plugin';
    });
  });

  // form/layout.json から { サブテーブルコード: [フィールドコードの正しい並び] } を作る
  function subtableFieldOrders(layout) {
    var orders = {};
    (layout || []).forEach(function (row) {
      if (row.type === 'SUBTABLE' && row.code) {
        orders[row.code] = (row.fields || []).map(function (f) { return f.code; });
      } else if (row.type === 'GROUP' && row.layout) {
        var inner = subtableFieldOrders(row.layout);
        Object.keys(inner).forEach(function (k) { orders[k] = inner[k]; });
      }
    });
    return orders;
  }

  function renderTables(properties, orders, settings, container) {
    loadedProps = properties; // 保存時にフォーマット情報を取り出すため保持
    container.textContent = '';
    var subtableCodes = Object.keys(properties).filter(function (c) {
      return properties[c].type === 'SUBTABLE';
    });
    if (subtableCodes.length === 0) {
      container.appendChild(el('p', 'kxc-note', 'このアプリにはテーブル(サブテーブル)がありません。'));
      return;
    }
    subtableCodes.forEach(function (code) {
      container.appendChild(buildTableConfig(code, properties[code], orders[code], settings.tables[code] || {}));
    });
  }

  function buildTableConfig(code, prop, order, conf) {
    var box = el('fieldset', 'kxc-tbl');
    box.setAttribute('data-code', code);
    box.appendChild(el('legend', null, prop.label || code));

    box.appendChild(optionRow('enabled', 'このテーブルを表形式にする', conf.enabled !== false));

    var fields = prop.fields || {};
    // 列はフォームレイアウト順で並べる(layout取得失敗時はオブジェクトのキー順)
    var codes = (order && order.length) ? order.filter(function (c) { return fields[c]; }) : Object.keys(fields);
    Object.keys(fields).forEach(function (c) {
      if (codes.indexOf(c) === -1) { codes.push(c); } // 念のため漏れを末尾に追加
    });

    // 固定する列(ドロップダウン)。選んだ列は先頭へ寄せて左固定する。
    var freezeRow = el('div', 'kxc-row');
    var flab = el('label', null, '固定する列（横スクロール時に左へ固定。選んだ列は先頭に表示）：');
    var fsel = el('select', 'kxc-freeze kxc-select');
    var optNone = el('option', null, '固定しない');
    optNone.value = '';
    fsel.appendChild(optNone);
    codes.forEach(function (fc) {
      var o = el('option', null, fields[fc].label || fc);
      o.value = fc;
      if (conf.freezeColumn === fc) { o.selected = true; }
      fsel.appendChild(o);
    });
    flab.appendChild(fsel);
    freezeRow.appendChild(flab);
    box.appendChild(freezeRow);

    box.appendChild(optionRow('freezeHeader', 'ヘッダー行を固定する（縦スクロール時）', !!conf.freezeHeader));

    var wrapRow = el('div', 'kxc-row');
    var wlab = el('label', null, '文字列列の折返し最大幅(vw)：');
    var winput = el('input', 'kxc-wrap');
    winput.type = 'number';
    winput.min = '20';
    winput.max = '100';
    winput.value = (conf.wrapWidth != null ? conf.wrapWidth : 46);
    wlab.appendChild(winput);
    wrapRow.appendChild(wlab);
    box.appendChild(wrapRow);

    box.appendChild(el('div', 'kxc-subhead', '表示する列（チェックを外すと非表示。すべてチェックすると全列表示）'));
    var cols = el('div', 'kxc-cols');
    var selected = (conf.columns && conf.columns.length) ? conf.columns : null;
    codes.forEach(function (fc) {
      var checked = selected ? (selected.indexOf(fc) !== -1) : true;
      cols.appendChild(columnCheckbox(fc, fields[fc].label || fc, checked));
    });
    box.appendChild(cols);

    return box;
  }

  function optionRow(key, label, checked) {
    var row = el('div', 'kxc-row');
    var l = el('label');
    var c = el('input');
    c.type = 'checkbox';
    c.checked = !!checked;
    c.setAttribute('data-key', key);
    l.appendChild(c);
    l.appendChild(document.createTextNode(' ' + label));
    row.appendChild(l);
    return row;
  }

  function columnCheckbox(fc, label, checked) {
    var l = el('label', 'kxc-col');
    var c = el('input');
    c.type = 'checkbox';
    c.checked = checked;
    c.setAttribute('data-col', fc);
    c.setAttribute('data-label', label);
    l.appendChild(c);
    l.appendChild(document.createTextNode(' ' + label));
    return l;
  }

  function save() {
    var out = {
      tables: {}
    };

    var boxes = document.querySelectorAll('.kxc-tbl');
    Array.prototype.forEach.call(boxes, function (box) {
      var code = box.getAttribute('data-code');
      var conf = { columns: [], columnLabels: {}, columnFormats: {} };

      Array.prototype.forEach.call(box.querySelectorAll('input[data-key]'), function (c) {
        conf[c.getAttribute('data-key')] = c.checked;
      });

      conf.freezeColumn = box.querySelector('.kxc-freeze').value || '';
      conf.wrapWidth = Number(box.querySelector('.kxc-wrap').value) || 46;

      // 各列のフォーマット情報(桁区切り・単位・小数桁など)をフィールド定義から保存
      var tblFields = (loadedProps[code] && loadedProps[code].fields) || {};
      Object.keys(tblFields).forEach(function (fc) {
        var p = tblFields[fc];
        conf.columnFormats[fc] = {
          type: p.type,
          digit: p.digit === true || p.digit === 'true',   // NUMBER: 桁区切り表示
          format: p.format || '',                          // CALC: NUMBER / NUMBER_DIGIT / DATE ...
          displayScale: (p.displayScale != null ? String(p.displayScale) : ''),
          unit: p.unit || '',
          unitPosition: p.unitPosition || ''
        };
      });

      var anyUnchecked = false;
      var checkedCols = [];
      var labels = {};
      Array.prototype.forEach.call(box.querySelectorAll('input[data-col]'), function (c) {
        var fc = c.getAttribute('data-col');
        labels[fc] = c.getAttribute('data-label');
        if (c.checked) { checkedCols.push(fc); } else { anyUnchecked = true; }
      });
      // 全列チェック=「全列表示」とみなし columns は空配列にする
      conf.columns = anyUnchecked ? checkedCols : [];
      conf.columnLabels = labels;
      conf.label = box.querySelector('legend').textContent;

      out.tables[code] = conf;
    });

    var payload = {};
    payload[CONFIG_KEY] = JSON.stringify(out);
    // successCallbackを省略すると、保存後に自動でプラグイン一覧へ戻り完了メッセージが表示される
    // (独自のリダイレクトURLより、ゲストスペース等でも確実)
    kintone.plugin.app.setConfig(payload);
  }

}(kintone.$PLUGIN_ID));
