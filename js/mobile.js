(function (PLUGIN_ID) {
  'use strict';

  // 設定読込(JSON文字列を1キーに格納している)
  var saved = kintone.plugin.app.getConfig(PLUGIN_ID);
  var settings = null;
  try { settings = JSON.parse((saved && saved.config) || '{}'); } catch (e) { settings = null; }
  if (!settings || !settings.tables) { return; } // 未設定なら何もしない

  var STYLE_ID = 'kxc-mobile-style';
  var GROUP_CLASS = 'kxc-group';

  // ------------------------------------------------------------------
  // ヘルパー
  // ------------------------------------------------------------------
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (txt != null) { e.textContent = txt; }
    return e;
  }

  function addThousands(s) {
    var parts = String(s).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  // CALCの日付/時刻系フォーマット(数値として整形しない)
  var CALC_DATELIKE = { DATE: 1, DATETIME: 1, TIME: 1, HOUR_MINUTE: 1, DAY_HOUR_MINUTE: 1 };

  // 数値(NUMBER/CALC)を、フィールド設定(fmt)に従って整形する
  function formatNumeric(raw, type, fmt) {
    if (raw === '' || raw == null) { return ''; }
    fmt = fmt || {};
    // CALCの日付/時刻系は数値整形しない(日時のみローカル整形、それ以外はそのまま)
    if (type === 'CALC' && CALC_DATELIKE[fmt.format]) {
      return (fmt.format === 'DATETIME') ? formatDateTime(raw) : String(raw);
    }
    var n = Number(raw);
    if (isNaN(n)) { return String(raw); }

    // 桁区切りの要否はフィールド設定に従う(NUMBERはdigit / CALCはformat===NUMBER_DIGIT)
    var useDigit = (type === 'NUMBER') ? !!fmt.digit : (fmt.format === 'NUMBER_DIGIT');

    // 小数桁(displayScaleがあれば固定、なければ元の桁を保持)
    var s;
    var scale = (fmt.displayScale !== '' && fmt.displayScale != null) ? parseInt(fmt.displayScale, 10) : null;
    s = (scale != null && !isNaN(scale)) ? n.toFixed(scale) : String(raw);

    if (useDigit) { s = addThousands(s); }

    // 単位
    if (fmt.unit) { s = (fmt.unitPosition === 'BEFORE') ? (fmt.unit + s) : (s + fmt.unit); }
    return s;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // 日時(UTCのISO文字列)を端末ローカルの "YYYY-MM-DD HH:mm" に整形する
  function formatDateTime(raw) {
    if (raw == null || raw === '') { return ''; }
    var d = new Date(raw);
    if (isNaN(d.getTime())) { return String(raw); }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // リッチエディター(HTML文字列)をプレーンテキスト化する。
  // DOMParserはスクリプト実行や外部リソース取得を行わないため安全。
  function richToText(html) {
    var s = String(html);
    try {
      var doc = new DOMParser().parseFromString(s, 'text/html');
      return (doc && doc.body) ? (doc.body.textContent || '') : s;
    } catch (e) {
      return s.replace(/<[^>]*>/g, '');
    }
  }

  // リンク値から安全なhref文字列を生成する(javascript:等の危険スキームは無効化)
  function linkHref(value) {
    var s = String(value).trim();
    if (/^(https?|ftp|mailto|tel):/i.test(s)) { return s; }                 // 安全なスキームはそのまま
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { return 'mailto:' + s; }      // メールアドレス
    if (/^[+\d][\d\-() ]{5,}$/.test(s)) { return 'tel:' + s.replace(/[^\d+]/g, ''); } // 電話番号
    // スキーム無し or 不明スキームはWebとしてhttps補完(危険スキームはここで除去される)
    return 'https://' + s.replace(/^[a-z][a-z0-9+.\-]*:\/*/i, '');
  }

  // 添付ファイルのダウンロードURL(ゲストスペース対応)
  function fileBaseUrl() {
    try { return kintone.api.url('/k/v1/file.json', true); }
    catch (e) { return '/k/v1/file.json'; }
  }

  function isEmptyValue(field) {
    var v = field.value;
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  }

  function formatValue(field, fmt) {
    var t = field.type;
    var v = field.value;
    if (v == null) { return ''; }
    switch (t) {
      case 'NUMBER':
      case 'CALC':
        return formatNumeric(v, t, fmt);
      case 'DATETIME':
        return formatDateTime(v);
      case 'RICH_TEXT':
        return richToText(v);
      case 'CHECK_BOX':
      case 'MULTI_SELECT':
      case 'CATEGORY':
        return Array.isArray(v) ? v.join('、') : String(v);
      case 'USER_SELECT':
      case 'ORGANIZATION_SELECT':
      case 'GROUP_SELECT':
      case 'STATUS_ASSIGNEE':
        return Array.isArray(v) ? v.map(function (o) { return o.name; }).join('、') : String(v);
      case 'CREATOR':
      case 'MODIFIER':
        return (v && v.name) ? v.name : String(v);
      case 'FILE':
        return Array.isArray(v) ? v.map(function (o) { return o.name; }).join('、') : String(v);
      default:
        return String(v);
    }
  }

  // セル内容をDOMで構築する(リンク/添付ファイル/複数行はテキスト以外の描画が必要)
  function fillCell(container, field, fmt) {
    var t = field.type;
    var v = field.value;

    if (t === 'MULTI_LINE_TEXT') {
      String(v).split('\n').forEach(function (line, i) {
        if (i > 0) { container.appendChild(el('br')); }
        container.appendChild(document.createTextNode(line));
      });
      return;
    }

    if (t === 'LINK') {
      var a = el('a', 'kxc-link', String(v));
      a.href = linkHref(v);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      container.appendChild(a);
      return;
    }

    if (t === 'FILE' && Array.isArray(v)) {
      var base = fileBaseUrl();
      v.forEach(function (f, i) {
        if (i > 0) { container.appendChild(el('br')); }
        if (f && f.fileKey) {
          var fa = el('a', 'kxc-link', f.name);
          fa.href = base + '?fileKey=' + encodeURIComponent(f.fileKey);
          fa.target = '_blank';
          fa.rel = 'noopener noreferrer';
          container.appendChild(fa);
        } else {
          container.appendChild(document.createTextNode((f && f.name) || ''));
        }
      });
      return;
    }

    container.textContent = formatValue(field, fmt);
  }

  // レコード内の全サブテーブル(レコードのキー順)
  function recordSubtables(record) {
    var result = [];
    Object.keys(record).forEach(function (code) {
      var f = record[code];
      if (f && f.type === 'SUBTABLE') {
        result.push({ code: code, value: f.value || [] });
      }
    });
    return result;
  }

  // ネイティブのサブテーブルDOM(クラス名に "subtable" を含む最外殻要素)
  function findNativeSubtables() {
    var nodes = document.querySelectorAll('[class*="subtable" i]');
    var arr = Array.prototype.slice.call(nodes);
    return arr.filter(function (n) {
      return !arr.some(function (m) { return m !== n && m.contains(n); });
    });
  }

  // ------------------------------------------------------------------
  // スタイル注入(クラスは kxc- 接頭辞で衝突回避)
  // ------------------------------------------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) { return; }
    var css =
      '.' + GROUP_CLASS + '{margin:14px 8px;}' +
      '.' + GROUP_CLASS + '__title{display:flex;align-items:center;gap:6px;' +
        'font-size:14px;font-weight:700;color:#3498db;margin:6px 2px 6px;' +
        'padding-left:8px;border-left:4px solid #3498db;}' +
      '.' + GROUP_CLASS + '__count{font-size:12px;font-weight:600;color:#7b8794;}' +

      '.kxc-twrap{overflow-x:auto;-webkit-overflow-scrolling:touch;' +
        'border:1px solid #e3e7ea;border-radius:10px;background:#fff;}' +
      /* ヘッダー固定オプション時は縦スクロール領域にする */
      '.kxc-twrap--vscroll{max-height:70vh;overflow:auto;}' +

      /* width:max-content+min-width:100% で「狭い時は全幅/広い時は内容幅まで伸びて確実に横スクロール」 */
      /* border-collapse:separate は iOS Safari の sticky セル不具合を避けるため */
      '.kxc-table{border-collapse:separate;border-spacing:0;' +
        'width:max-content;min-width:100%;font-size:14px;}' +
      '.kxc-table th,.kxc-table td{padding:9px 12px;text-align:left;vertical-align:top;' +
        'border-bottom:1px solid #eef1f3;border-right:1px solid #f1f4f6;}' +
      '.kxc-table th:last-child,.kxc-table td:last-child{border-right:0;}' +
      '.kxc-table tbody tr:last-child td{border-bottom:0;}' +
      '.kxc-table thead th{background:#f4f8fb;color:#2c3e50;font-weight:700;font-size:13px;' +
        'border-bottom:2px solid #d8e0e6;}' +
      '.kxc-table tbody tr:nth-child(even) td{background:#fafbfc;}' +

      /* セル中身は内側divで幅をキャップ(td直接のmax-widthはiOSで効きにくい) */
      '.kxc-c{display:block;}' +
      '.kxc-c--num{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;}' +
      '.kxc-c--text,.kxc-c--head{white-space:normal;word-break:break-word;max-width:var(--kxc-wrap,46vw);}' +
      '.kxc-c--empty{color:#c0c8ce;}' +
      '.kxc-link{color:#3498db;text-decoration:underline;word-break:break-all;}' +

      /* オプション: ヘッダー行固定 */
      '.kxc-stickyhead thead th{position:sticky;top:0;z-index:2;}' +

      /* オプション: 先頭列固定 */
      '.kxc-fixcol th:first-child,.kxc-fixcol td:first-child{position:sticky;left:0;z-index:1;' +
        'min-width:7em;background:#fff;border-right:1px solid #d8e0e6;' +
        'box-shadow:2px 0 4px rgba(0,0,0,.05);}' +
      '.kxc-fixcol thead th:first-child{z-index:3;background:#f4f8fb;}' +
      '.kxc-fixcol tbody tr:nth-child(even) td:first-child{background:#fafbfc;}';

    var style = el('style');
    style.id = STYLE_ID;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // 表(テーブル)生成
  // ------------------------------------------------------------------
  function labelOf(conf, code) {
    return (conf.columnLabels && conf.columnLabels[code]) || code;
  }

  function buildTable(st, conf) {
    var rows = st.value;
    var group = el('div', GROUP_CLASS);
    group.setAttribute('data-code', st.code);

    var title = el('div', GROUP_CLASS + '__title');
    title.appendChild(document.createTextNode(conf.label || st.code));
    title.appendChild(el('span', GROUP_CLASS + '__count', '（' + rows.length + '件）'));
    group.appendChild(title);

    var wrapCls = 'kxc-twrap' + (conf.freezeHeader ? ' kxc-twrap--vscroll' : '');
    var wrap = el('div', wrapCls);

    if (rows.length === 0) {
      var none = el('div', 'kxc-c kxc-c--empty', '（データなし）');
      none.style.padding = '12px';
      wrap.appendChild(none);
      group.appendChild(wrap);
      return group;
    }

    // 列順は常にレコードのフィールド順(=フォーム順)に従う。
    // conf.columns は「どの列を表示するか」の集合としてのみ使う(並びは崩さない)。
    var natural = Object.keys(rows[0].value || {});
    var order;
    if (conf.columns && conf.columns.length) {
      var selected = {};
      conf.columns.forEach(function (c) { selected[c] = true; });
      order = natural.filter(function (c) { return selected[c]; });
    } else {
      order = natural;
    }
    if (order.length === 0) { order = natural; }

    // 固定する列が指定されていれば、その列を先頭へ移動して左固定する
    var freezeCode = conf.freezeColumn;
    var hasFreeze = !!freezeCode && order.indexOf(freezeCode) !== -1;
    if (hasFreeze) {
      order = [freezeCode].concat(order.filter(function (c) { return c !== freezeCode; }));
    }

    var formats = conf.columnFormats || {};

    // 数値列判定(右揃え用)。CALCの日付/時刻系は数値扱いしない
    var numericCol = {};
    order.forEach(function (code) {
      var f = rows[0].value[code];
      var fmt = formats[code] || {};
      numericCol[code] = !!f && (
        f.type === 'NUMBER' ||
        (f.type === 'CALC' && !CALC_DATELIKE[fmt.format])
      );
    });

    function colKind(code, ci) {
      if (numericCol[code]) { return 'num'; }
      return ci === 0 ? 'head' : 'text';
    }

    var tblCls = 'kxc-table' +
      (hasFreeze ? ' kxc-fixcol' : '') +
      (conf.freezeHeader ? ' kxc-stickyhead' : '');
    var table = el('table', tblCls);
    table.style.setProperty('--kxc-wrap', (conf.wrapWidth || 46) + 'vw');

    var thead = el('thead');
    var htr = el('tr');
    order.forEach(function (code, ci) {
      var th = el('th');
      th.appendChild(el('div', 'kxc-c kxc-c--' + colKind(code, ci), labelOf(conf, code)));
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (row) {
      var tr = el('tr');
      order.forEach(function (code, ci) {
        var td = el('td');
        var field = row.value[code];
        var empty = !field || isEmptyValue(field);
        var cls = 'kxc-c kxc-c--' + colKind(code, ci) + (empty ? ' kxc-c--empty' : '');
        var div = el('div', cls);
        if (empty) { div.textContent = '—'; }
        else { fillCell(div, field, formats[code]); }
        td.appendChild(div);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    wrap.appendChild(table);
    group.appendChild(wrap);
    return group;
  }

  // ------------------------------------------------------------------
  // 画面処理
  // ------------------------------------------------------------------
  function removeInjected() {
    var nodes = document.querySelectorAll('.' + GROUP_CLASS);
    Array.prototype.forEach.call(nodes, function (n) {
      if (n.parentNode) { n.parentNode.removeChild(n); }
    });
  }

  function renderDetail(record) {
    injectStyle();
    removeInjected();

    var subs = recordSubtables(record);
    if (subs.length === 0) { return; }
    var natives = findNativeSubtables();

    // DOM順とレコード順が一致する前提でindex対応(通常は一致)
    if (natives.length === subs.length) {
      subs.forEach(function (st, i) {
        var conf = settings.tables[st.code];
        if (!conf || conf.enabled === false) { return; } // 設定対象外はそのまま
        natives[i].style.display = 'none';
        natives[i].parentNode.insertBefore(buildTable(st, conf), natives[i]);
      });
    } else {
      // 安全のためスキップ(誤ったテーブルを隠さない)
      console.warn('[モバイル表形式] サブテーブル数とDOM数が不一致のため詳細描画をスキップしました。');
    }
  }

  // ------------------------------------------------------------------
  // イベント登録(閲覧=詳細画面のみ)
  // ------------------------------------------------------------------
  kintone.events.on('mobile.app.record.detail.show', function (event) {
    try { renderDetail(event.record); } catch (e) { console.error('[モバイル表形式] 詳細描画エラー', e); }
    return event;
  });

}(kintone.$PLUGIN_ID));
