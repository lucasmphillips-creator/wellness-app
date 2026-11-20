/* Site editor: edit text, leave notes, export a change request for developers.
   Changes are saved in this browser (localStorage) until exported or reset. */
(function () {
  'use strict';
  var PREFIX = 'pse-edits:';
  var PAGE = (decodeURIComponent(location.pathname).split('/').pop() || 'index.html');
  if (!/\.html?$/.test(PAGE)) PAGE += '.html';
  var KEY = PREFIX + PAGE;
  var SITE = 'primarysquare.com';

  var BLOCK = /^(H1|H2|H3|H4|H5|H6|P|LI|BLOCKQUOTE|FIGCAPTION|TD|TH|DT|DD|LABEL|BUTTON|SUMMARY|LEGEND|CAPTION)$/;
  var INLINE = /^(SPAN|A|STRONG|EM|B|I|U|SMALL|SUP|SUB|MARK|BR|ABBR|TIME|CITE|Q|S|DEL|INS)$/;

  var mode = 'browse';           // browse | edit | note
  var data = load();             // { changes: { path: change } }
  var editing = null, editStart = '';            // element currently contentEditable
  var originals = new WeakMap(); // element -> original innerHTML (this session)

  /* ---------- storage ---------- */
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.changes) return d; } catch (e) {}
    return { page: PAGE, title: document.title, changes: {} };
  }
  function save() {
    data.title = document.title;
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; }
    catch (e) { toast('Could not save — browser storage is full or blocked. Export now so nothing is lost.'); return false; }
  }
  function allPages() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) {
          var d = JSON.parse(localStorage.getItem(k));
          if (d && d.changes && Object.keys(d.changes).length) out.push(d);
        }
      }
    } catch (e) {}
    if (!out.some(function (d) { return d.page === PAGE; }) && Object.keys(data.changes).length) out.push(data);
    var order = ['index.html', 'about.html', 'for-providers.html', 'marketplace.html', 'waitlist.html', 'privacy-policy.html', 'terms.html'];
    out.sort(function (a, b) { return (order.indexOf(a.page) + 99) % 99 - (order.indexOf(b.page) + 99) % 99; });
    return out;
  }

  /* ---------- locating elements ---------- */
  function cssPath(el) {
    var parts = [];
    for (var n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) { parts.unshift('#' + CSS.escape(n.id)); return parts.join(' > '); }
      var i = 1, s = n;
      while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i++;
      parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    parts.unshift('body');
    return parts.join(' > ');
  }
  function find(path, doc) { try { return (doc || document).querySelector(path); } catch (e) { return null; } }
  function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function where(el) {
    var sec = el.closest('section, header, footer, nav, main, form');
    var label = '';
    if (sec) {
      var h = sec.querySelector('h1, h2, h3');
      label = h ? '“' + clip(originals.has(h) ? textOf(originals.get(h)) : textOf(h.innerHTML), 60) + '”' : '';
      if (!label && sec.id) label = '#' + sec.id;
      if (!label) label = sec.tagName.toLowerCase();
      var kind = { HEADER: 'Header', FOOTER: 'Footer', NAV: 'Navigation', FORM: 'Form' }[sec.tagName];
      if (kind) label = kind + (label && label !== sec.tagName.toLowerCase() ? ' ' + label : '');
      else label = 'Section ' + label;
    }
    var layout = el.closest('.mst') ? 'Mobile layout' : el.closest('.dst') ? 'Desktop layout' : 'All screen sizes';
    return { section: label || 'Page', layout: layout };
  }
  function hasDirectText(n) {
    for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) return true;
    return false;
  }
  function pickText(t) {
    if (t.closest('svg')) t = t.closest('svg').parentElement;
    var inlineBest = null;
    for (var n = t; n && n !== document.body; n = n.parentElement) {
      if (BLOCK.test(n.tagName)) return n;
      if (INLINE.test(n.tagName)) { if (clean(n.textContent)) inlineBest = n; continue; }
      if (hasDirectText(n)) return n;
      break;
    }
    return inlineBest;
  }
  function isUI(el) { return el && el.closest && el.closest('#pse-ui, .pse-modal-wrap, .pse-toast'); }

  /* ---------- re-apply saved changes on load ---------- */
  function applySaved() {
    var missing = 0;
    Object.keys(data.changes).forEach(function (p) {
      var c = data.changes[p], el = find(p);
      if (!el) { missing++; return; }
      if (!originals.has(el)) originals.set(el, c.beforeHTML != null ? c.beforeHTML : el.innerHTML);
      if (c.afterHTML != null && c.afterHTML !== c.beforeHTML) el.innerHTML = c.afterHTML;
      if (c.newImage && el.tagName === 'IMG') { el.removeAttribute('srcset'); el.src = c.newImage; }
      mark(el, c);
    });
    if (missing) toast(missing + ' saved change(s) could not be placed on this page — they are still included in the export.');
  }
  function mark(el, c) {
    el.classList.toggle('pse-changed', !!(c && c.afterHTML != null && c.afterHTML !== c.beforeHTML) || !!(c && c.newImage));
    el.classList.toggle('pse-noted', !!(c && c.note));
  }

  /* ---------- text editing ---------- */
  function startEdit(el) {
    if (editing === el) return;
    stopEdit();
    if (!originals.has(el)) {
      var saved = data.changes[cssPath(el)];
      originals.set(el, saved && saved.beforeHTML != null ? saved.beforeHTML : el.innerHTML);
    }
    editing = el; editStart = el.innerHTML;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.classList.add('pse-editing');
    el.focus();
  }
  function stopEdit() {
    var el = editing; if (!el) return;
    editing = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    el.classList.remove('pse-editing');
    record(el);
  }
  function entry(el) {
    var p = cssPath(el), c = data.changes[p];
    if (!c) {
      var w = where(el);
      var before = originals.has(el) ? originals.get(el) : el.innerHTML;
      c = { path: p, tag: el.tagName.toLowerCase(), section: w.section, layout: w.layout,
            beforeHTML: before, beforeText: textOf(before), ts: Date.now() };
      if (el.tagName === 'IMG') { c.beforeHTML = null; c.tag = 'img'; c.image = el.getAttribute('src'); c.alt = el.getAttribute('alt') || ''; }
      else { var bgi = bgOf(el); if (bgi) c.bgImage = bgi; }
    }
    return c;
  }
  function bgOf(el) {
    for (var n = el, i = 0; n && n !== document.body && i < 4; n = n.parentElement, i++) {
      var m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(n).backgroundImage || '');
      if (m) { var u = m[1]; var k = u.indexOf('site-assets/'); return k >= 0 ? u.slice(k) : u; }
    }
    return '';
  }
  function textOf(html) {
    var d = document.createElement('div');
    d.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n$&');
    return d.textContent.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  function prune(c) {
    var changed = c.afterHTML != null && c.afterHTML !== c.beforeHTML;
    if (!changed) { delete c.afterHTML; delete c.afterText; }
    if (!changed && !c.note && !c.newImage) { delete data.changes[c.path]; return false; }
    data.changes[c.path] = c; return true;
  }
  function record(el) {
    var c = entry(el);
    c.afterHTML = el.innerHTML; c.afterText = textOf(el.innerHTML);
    c.ts = Date.now();
    prune(c); mark(el, data.changes[c.path]); save(); refresh();
  }
  function revert(path) {
    var c = data.changes[path], el = find(path);
    if (el) {
      if (c.beforeHTML != null) el.innerHTML = c.beforeHTML;
      if (c.newImage && el.tagName === 'IMG') el.src = c.image;
      mark(el, null);
    }
    delete data.changes[path]; save(); refresh();
  }

  /* ---------- notes & image replacement ---------- */
  function openNote(el) {
    stopEdit();
    var c = entry(el), isImg = el.tagName === 'IMG';
    var bg = !isImg && (c.bgImage || bgOf(el));
    var what = isImg ? 'Photo / image' + (c.alt ? ' — “' + clip(c.alt, 70) + '”' : '') + ' (' + c.image + ')'
      : (clip(el.innerText, 90) || '<' + c.tag + '> element') + (bg ? ' · background image: ' + bg : '');
    var wrap = h('div', 'pse-modal-wrap');
    wrap.innerHTML =
      '<div class="pse-modal" role="dialog" aria-label="Add a note">' +
      '<h3>Note for the developers</h3>' +
      '<p class="pse-where"></p><p class="pse-what"></p>' +
      '<textarea rows="5" placeholder="e.g. Replace this photo with a picture of our team · Make this button green · Remove this section"></textarea>' +
      (isImg || bg ? '<label class="pse-file">Attach a replacement image (optional) <input type="file" accept="image/*"></label><img class="pse-preview" alt="">' : '') +
      '<div class="pse-row"><button class="pse-btn pse-ghost" data-act="cancel">Cancel</button>' +
      (c.note || c.newImage ? '<button class="pse-btn pse-ghost" data-act="remove">Remove note</button>' : '') +
      '<button class="pse-btn pse-primary" data-act="save">Save note</button></div></div>';
    wrap.querySelector('.pse-where').textContent = PAGE + ' · ' + c.section + ' · ' + c.layout;
    wrap.querySelector('.pse-what').textContent = what;
    var ta = wrap.querySelector('textarea'); ta.value = c.note || '';
    var newImg = c.newImage || null, prev = wrap.querySelector('.pse-preview');
    if (prev && newImg) { prev.src = newImg; prev.style.display = 'block'; }
    var fi = wrap.querySelector('input[type=file]');
    if (fi) fi.onchange = function () {
      var f = fi.files[0]; if (!f) return;
      shrink(f, function (url) { newImg = url; c.newImageName = f.name; prev.src = url; prev.style.display = 'block'; });
    };
    wrap.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (e.target === wrap || act === 'cancel') return wrap.remove();
      if (act === 'remove') { c.note = ''; if (c.newImage && isImg) el.src = c.image; delete c.newImage; delete c.newImageName; }
      if (act === 'save') {
        c.note = ta.value.trim();
        if (newImg && isImg) { c.newImage = newImg; el.removeAttribute('srcset'); el.src = newImg; }
      }
      if (act === 'remove' || act === 'save') {
        c.ts = Date.now();
        if (!data.changes[c.path] && c.beforeHTML != null) c.beforeHTML = el.innerHTML;
        prune(c); mark(el, data.changes[c.path]); save(); refresh(); wrap.remove();
      }
    });
    document.body.appendChild(wrap);
    ta.focus();
  }
  function shrink(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/jpeg', 0.85));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  }

  /* ---------- event handling ---------- */
  var hoverEl = null;
  function target(e) {
    var t = e.target; if (!t || t.nodeType !== 1 || isUI(t)) return null;
    if (mode === 'edit') return pickText(t);
    if (mode === 'note') return t.closest('svg') ? t.closest('svg').parentElement : t;
    return null;
  }
  document.addEventListener('mouseover', function (e) {
    if (mode === 'browse') return;
    var t = target(e);
    if (hoverEl && hoverEl !== t) hoverEl.classList.remove('pse-hover');
    hoverEl = t; if (t && t !== editing) t.classList.add('pse-hover');
  }, true);
  document.addEventListener('click', function (e) {
    if (mode === 'browse' || isUI(e.target)) return;
    var t = target(e);
    if (mode === 'edit' && editing && editing.contains(e.target)) { e.preventDefault(); return; }
    e.preventDefault(); e.stopPropagation();
    if (!t) { stopEdit(); return; }
    if (hoverEl) hoverEl.classList.remove('pse-hover');
    if (mode === 'edit') startEdit(t); else openNote(t);
  }, true);
  document.addEventListener('submit', function (e) { if (mode !== 'browse') e.preventDefault(); }, true);
  document.addEventListener('keydown', function (e) {
    if (!editing) return;
    if (e.key === 'Escape') {
      editing.innerHTML = editStart;
      stopEdit(); e.preventDefault();
    } else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); stopEdit(); }
  }, true);
  document.addEventListener('paste', function (e) {
    if (!editing || !editing.contains(e.target)) return;
    e.preventDefault();
    var txt = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, txt);
  }, true);
  document.addEventListener('focusout', function (e) { if (editing && e.target === editing) setTimeout(function () { if (editing && document.activeElement !== editing) stopEdit(); }, 0); }, true);

  /* ---------- toolbar UI ---------- */
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var ui = h('div', null); ui.id = 'pse-ui';
  ui.innerHTML =
    '<div class="pse-bar">' +
    '<div class="pse-seg" role="group" aria-label="Mode">' +
    '<button data-mode="browse" title="Click around the site normally">Browse</button>' +
    '<button data-mode="edit" title="Click any text to rewrite it">Edit text</button>' +
    '<button data-mode="note" title="Click anything (photos, buttons, sections) to leave a note">Add note</button></div>' +
    '<button class="pse-btn pse-ghost pse-list-btn" data-act="list">Changes <span class="pse-count">0</span></button>' +
    '<button class="pse-btn pse-primary" data-act="export">Send to developers</button>' +
    '<button class="pse-btn pse-ghost pse-min" data-act="min" title="Hide toolbar" aria-label="Hide toolbar">–</button>' +
    '</div>' +
    '<div class="pse-hint"></div>' +
    '<div class="pse-panel" hidden><div class="pse-panel-head"><strong>Your changes</strong>' +
    '<button class="pse-btn pse-ghost" data-act="close">Close</button></div><div class="pse-items"></div>' +
    '<div class="pse-panel-foot"><button class="pse-btn pse-ghost" data-act="page">Download this edited page (.html)</button>' +
    '<button class="pse-btn pse-ghost pse-danger" data-act="reset">Discard all changes</button></div></div>' +
    '<button class="pse-fab" data-act="max" hidden>✎ Edit site</button>';
  var HINTS = {
    browse: 'Browsing normally. Choose <b>Edit text</b> or <b>Add note</b> to start making changes.',
    edit: 'Click any text to rewrite it. <b>Enter</b> saves · <b>Shift+Enter</b> new line · <b>Esc</b> cancels.',
    note: 'Click anything — a photo, button, background or section — to leave a note or attach a replacement image.'
  };
  function setMode(m) {
    stopEdit(); mode = m;
    if (hoverEl) { hoverEl.classList.remove('pse-hover'); hoverEl = null; }
    document.documentElement.classList.toggle('pse-on', m !== 'browse');
    ui.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
    ui.querySelector('.pse-hint').innerHTML = HINTS[m];
    try { sessionStorage.setItem('pse-mode', m); } catch (e) {}
  }
  ui.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var m = b.getAttribute('data-mode'), act = b.getAttribute('data-act');
    if (m) return setMode(m);
    if (act === 'list') { var p = ui.querySelector('.pse-panel'); p.hidden = !p.hidden; refresh(); }
    if (act === 'close') ui.querySelector('.pse-panel').hidden = true;
    if (act === 'export') exportReport();
    if (act === 'page') downloadPage();
    if (act === 'reset') {
      if (!confirm('Discard every change and note on ALL pages? This cannot be undone.')) return;
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf(PREFIX) === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (er) {}
      location.reload();
    }
    if (act === 'min') { ui.querySelector('.pse-bar').hidden = true; ui.querySelector('.pse-hint').hidden = true; ui.querySelector('.pse-panel').hidden = true; ui.querySelector('.pse-fab').hidden = false; setMode('browse'); }
    if (act === 'max') { ui.querySelector('.pse-bar').hidden = false; ui.querySelector('.pse-hint').hidden = false; ui.querySelector('.pse-fab').hidden = true; }
    if (act === 'jump') { var el = find(b.getAttribute('data-path')); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('pse-flash'); setTimeout(function () { el.classList.remove('pse-flash'); }, 1800); } else toast('That spot is not visible on this page (it may be in the other screen-size layout).'); }
    if (act === 'undo') revert(b.getAttribute('data-path'));
    if (act === 'note') { var el2 = find(b.getAttribute('data-path')); if (el2) openNote(el2); }
  });
  function refresh() {
    var pages = allPages(), total = 0;
    pages.forEach(function (d) { total += Object.keys(d.changes).length; });
    ui.querySelector('.pse-count').textContent = total;
    var box = ui.querySelector('.pse-items'); if (ui.querySelector('.pse-panel').hidden) return;
    var mine = Object.keys(data.changes).map(function (k) { return data.changes[k]; }).sort(function (a, b) { return a.ts - b.ts; });
    var html = '';
    if (!mine.length) html += '<p class="pse-empty">No changes on this page yet.</p>';
    mine.forEach(function (c) {
      html += '<div class="pse-item"><div class="pse-meta">' + esc(c.section) + ' · ' + esc(c.layout) + '</div>';
      if (c.afterHTML != null) html += '<div class="pse-before">' + esc(clip(c.beforeText, 140)) + '</div><div class="pse-after">' + esc(clip(c.afterText, 140)) + '</div>';
      else if (c.tag === 'img' || c.newImage) html += '<div class="pse-after">Image' + (c.alt ? ': ' + esc(clip(c.alt, 80)) : '') + (c.newImage ? ' — replacement attached' : '') + '</div>';
      if (c.note) html += '<div class="pse-note">Note: ' + esc(clip(c.note, 200)) + '</div>';
      html += '<div class="pse-row"><button class="pse-link" data-act="jump" data-path="' + esc(c.path) + '">Show</button>' +
        '<button class="pse-link" data-act="note" data-path="' + esc(c.path) + '">' + (c.note ? 'Edit note' : 'Add note') + '</button>' +
        '<button class="pse-link" data-act="undo" data-path="' + esc(c.path) + '">Undo</button></div></div>';
    });
    var others = pages.filter(function (d) { return d.page !== PAGE; });
    if (others.length) html += '<p class="pse-empty">Also saved: ' + others.map(function (d) { return '<a href="' + esc(d.page) + '">' + esc(d.page) + '</a> (' + Object.keys(d.changes).length + ')'; }).join(', ') + '</p>';
    box.innerHTML = html;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function toast(msg) {
    var t = h('div', 'pse-toast'); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 4200);
  }

  /* ---------- export ---------- */
  function wordDiff(a, b) {
    var A = (a || '').split(/(\s+)/), B = (b || '').split(/(\s+)/);
    if (A.length * B.length > 250000) return { a: esc(a), b: esc(b) };
    var n = A.length, m = B.length, L = [];
    for (var i = 0; i <= n; i++) { L.push(new Uint16Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var oa = '', ob = ''; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { oa += esc(A[i]); ob += esc(B[j]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { oa += '<del>' + esc(A[i++]) + '</del>'; }
      else { ob += '<ins>' + esc(B[j++]) + '</ins>'; }
    }
    while (i < n) oa += '<del>' + esc(A[i++]) + '</del>';
    while (j < m) ob += '<ins>' + esc(B[j++]) + '</ins>';
    return { a: oa.replace(/<\/del>(\s*)<del>/g, '$1'), b: ob.replace(/<\/ins>(\s*)<ins>/g, '$1') };
  }
  function exportReport() {
    stopEdit();
    var pages = allPages(), total = 0;
    pages.forEach(function (d) { total += Object.keys(d.changes).length; });
    if (!total) return toast('No changes yet. Use Edit text or Add note first.');
    var who = '';
    try { who = localStorage.getItem('pse-author') || ''; } catch (e) {}
    who = prompt('Your name (shown on the change request):', who);
    if (who === null) return;
    try { localStorage.setItem('pse-author', who); } catch (e) {}
    var date = new Date(), ds = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    var n = 0, body = '', text = 'Website change request — ' + SITE + '\nFrom: ' + who + ' · ' + ds + '\n' + total + ' change(s)\n';
    pages.forEach(function (d) {
      var list = Object.keys(d.changes).map(function (k) { return d.changes[k]; }).sort(function (a, b) { return a.ts - b.ts; });
      body += '<section class="pg"><h2>' + esc(d.page) + ' <span>' + esc(d.title || '') + '</span></h2>';
      text += '\n=== ' + d.page + ' ===\n';
      list.forEach(function (c) {
        n++;
        var kind = c.afterHTML != null ? 'Text change' : c.newImage ? 'Image replacement' : 'Note';
        body += '<article><div class="hd"><span class="num">' + n + '</span><span class="kind k-' + kind.split(' ')[0].toLowerCase() + '">' + kind + '</span>' +
          '<span class="loc">' + esc(c.section) + ' · ' + esc(c.layout) + '</span></div>';
        text += '\n' + n + '. [' + kind + '] ' + c.section + ' · ' + c.layout + '\n';
        if (c.afterHTML != null) {
          var df = wordDiff(c.beforeText, c.afterText);
          body += '<div class="cmp"><div><label>Current</label><p class="old">' + df.a + '</p></div><div><label>Change to</label><p class="new">' + df.b + '</p></div></div>';
          text += '   Current:   ' + c.beforeText + '\n   Change to: ' + c.afterText + '\n';
        }
        if (c.tag === 'img' || c.newImage) {
          body += '<div class="imgs"><figure><label>Current image</label><code>' + esc(c.image || c.bgImage || '(see note)') + '</code>' + (c.alt ? '<figcaption>' + esc(c.alt) + '</figcaption>' : '') + '</figure>' +
            (c.newImage ? '<figure><label>Replacement' + (c.newImageName ? ' (' + esc(c.newImageName) + ')' : '') + '</label><img src="' + c.newImage + '" alt="Replacement image"><a download="' + esc((c.newImageName || 'replacement').replace(/\.[^.]+$/, '') + '.jpg') + '" href="' + c.newImage + '">Download image</a></figure>' : '') + '</div>';
          text += '   Image: ' + (c.image || c.bgImage || '') + (c.newImage ? '  → replacement attached in the report file' : '') + '\n';
        } else if (c.afterHTML == null) {
          body += '<p class="ctx">Element: “' + esc(clip(c.beforeText, 200)) + '”' + (c.bgImage ? ' · background image <code>' + esc(c.bgImage) + '</code>' : '') + '</p>';
          text += '   Element: ' + clip(c.beforeText, 200) + (c.bgImage ? ' (background image ' + c.bgImage + ')' : '') + '\n';
        }
        if (c.note) { body += '<p class="note"><b>Note:</b> ' + esc(c.note).replace(/\n/g, '<br>') + '</p>'; text += '   Note: ' + c.note + '\n'; }
        body += '<details><summary>Developer details</summary><dl><dt>Selector</dt><dd><code>' + esc(c.path) + '</code></dd>' +
          (c.afterHTML != null ? '<dt>Current HTML</dt><dd><pre>' + esc(c.beforeHTML) + '</pre></dd><dt>New HTML</dt><dd><pre>' + esc(c.afterHTML) + '</pre></dd>' : '') +
          '</dl></details></article>';
      });
      body += '</section>';
    });
    var json = JSON.stringify({ site: SITE, author: who, created: date.toISOString(), pages: pages }).replace(/</g, '\\u003c');
    var doc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Change request — ' + esc(SITE) + ' — ' + esc(ds) + '</title><style>' + REPORT_CSS + '</style></head><body><main>' +
      '<header><p class="eyebrow">Website change request</p><h1>' + esc(SITE) + '</h1><p class="sub">Requested by <b>' + esc(who || '—') + '</b> · ' + esc(ds) + ' · <b>' + total + '</b> change' + (total === 1 ? '' : 's') + ' across ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + '</p>' +
      '<p class="help">Each item shows where it is, the current wording and the requested wording (removed words struck through, added words highlighted). The site has separate <b>desktop</b> and <b>mobile</b> versions of most sections — each item says which one was edited; please apply wording changes to both unless noted. Open “Developer details” for the exact CSS selector and HTML. The full change list is also embedded in this file as JSON (<code>#change-data</code>).</p></header>' +
      body + '</main><script type="application/json" id="change-data">' + json + '<\/script></body></html>';
    download(doc, 'primarysquare-change-request-' + date.toISOString().slice(0, 10) + '.html', 'text/html');
    var done = function (copied) { toast('Change request downloaded' + (copied ? ' and a plain-text summary copied to your clipboard (paste it into the email body)' : '') + '. Attach the file to an email to your developers.'); };
    try { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
  }
  function download(str, name, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([str], { type: type }));
    a.download = name; ui.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function downloadPage() {
    stopEdit();
    if (typeof window.PSE_PRISTINE !== 'string') return toast('Original page source not available.');
    var doc = new DOMParser().parseFromString(window.PSE_PRISTINE, 'text/html');
    var miss = 0;
    Object.keys(data.changes).forEach(function (p) {
      var c = data.changes[p], el = find(p, doc);
      if (!el) { miss++; return; }
      if (c.afterHTML != null && c.afterHTML !== c.beforeHTML) el.innerHTML = c.afterHTML;
      if (c.newImage && el.tagName === 'IMG') { el.removeAttribute('srcset'); el.setAttribute('src', c.newImage); }
    });
    doc.querySelectorAll('[data-pse]').forEach(function (n) { n.remove(); });
    download('<!DOCTYPE html>\n' + doc.documentElement.outerHTML, PAGE.replace(/\.html?$/, '') + '-edited.html', 'text/html');
    toast('Edited copy of ' + PAGE + ' downloaded' + (miss ? ' (' + miss + ' change(s) could not be placed)' : '') + '. Notes are only in the change request.');
  }
  var REPORT_CSS = [
    ':root{--ink:#1f2a44;--mut:#5b6478;--line:#e3e6ee;--bg:#f6f7fb;--card:#fff;--del:#fde2e2;--delc:#9b1c1c;--ins:#d9f5e3;--insc:#11603a;--acc:#2f5bd3}',
    '@media (prefers-color-scheme:dark){:root{--ink:#e8ebf3;--mut:#a2a9ba;--line:#2c3346;--bg:#121622;--card:#1a1f2e;--del:#4a1f24;--delc:#ffb3b3;--ins:#163d29;--insc:#9ff0c0;--acc:#8aa8ff}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    'main{max-width:960px;margin:0 auto;padding:40px 16px 80px}header{margin-bottom:28px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:var(--mut);margin:0}',
    'h1{font-size:34px;margin:4px 0 6px}.sub{margin:0 0 12px}.help{color:var(--mut);font-size:14px;max-width:72ch}',
    '.pg h2{font-size:20px;margin:36px 0 12px;border-bottom:2px solid var(--line);padding-bottom:6px}.pg h2 span{font-weight:400;color:var(--mut);font-size:14px}',
    'article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:12px 0}',
    '.hd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.num{font-weight:700;min-width:28px;height:28px;border-radius:14px;background:var(--ink);color:var(--card);display:inline-flex;align-items:center;justify-content:center;font-size:13px}',
    '.kind{font-size:12px;font-weight:600;padding:3px 9px;border-radius:99px;border:1px solid var(--line)}.k-text{color:var(--acc)}.k-image{color:var(--insc)}.loc{color:var(--mut);font-size:14px}',
    '.cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:640px){.cmp{grid-template-columns:1fr}}',
    'label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-bottom:4px}.cmp p{margin:0;padding:10px 12px;border-radius:8px;background:var(--bg);white-space:pre-wrap;overflow-wrap:anywhere}',
    'del{background:var(--del);color:var(--delc)}ins{background:var(--ins);color:var(--insc);text-decoration:none}',
    '.note{background:#fff6d6;color:#5a4500;border-radius:8px;padding:10px 12px;margin:12px 0 0}@media (prefers-color-scheme:dark){.note{background:#3a3112;color:#ffe9a3}}',
    '.ctx{color:var(--mut);margin:0}.imgs{display:flex;gap:16px;flex-wrap:wrap}.imgs figure{margin:0;flex:1 1 240px}.imgs img{max-width:100%;border-radius:8px;display:block;margin:6px 0}',
    'code,pre{font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:var(--bg);padding:8px;border-radius:6px;margin:0}',
    'details{margin-top:12px;font-size:14px}summary{cursor:pointer;color:var(--mut)}dl{margin:8px 0 0}dt{font-weight:600;margin-top:8px}dd{margin:2px 0 0}a{color:var(--acc)}',
    '@media print{details{display:none}article{break-inside:avoid}}'
  ].join('\n');

  /* ---------- start ---------- */
  function init() {
    document.body.appendChild(ui);
    applySaved();
    var m = 'browse'; try { m = sessionStorage.getItem('pse-mode') || 'browse'; } catch (e) {}
    setMode(m); refresh();
    var seen = false; try { seen = localStorage.getItem('pse-welcome'); } catch (e) {}
    if (!seen) {
      var w = h('div', 'pse-modal-wrap');
      w.innerHTML = '<div class="pse-modal"><h3>Edit your website</h3><ol>' +
        '<li><b>Edit text</b> — click any heading, paragraph or button and type. Changes are highlighted.</li>' +
        '<li><b>Add note</b> — click a photo, button or section to describe a change or attach a new image.</li>' +
        '<li><b>Send to developers</b> — downloads one file listing every change across all pages, ready to email.</li></ol>' +
        '<p class="pse-small">Your edits are saved in this browser as you go, so you can close it and come back. Most sections have separate desktop and mobile versions — narrow the browser window to edit the mobile one.</p>' +
        '<div class="pse-row"><button class="pse-btn pse-primary" data-act="ok">Get started</button></div></div>';
      w.addEventListener('click', function (e) { if (e.target === w || (e.target.getAttribute && e.target.getAttribute('data-act') === 'ok')) { w.remove(); try { localStorage.setItem('pse-welcome', '1'); } catch (er) {} } });
      document.body.appendChild(w);
    }
  }
  window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf(PREFIX) === 0) refresh(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
