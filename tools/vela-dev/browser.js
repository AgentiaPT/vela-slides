/* Vela local folder browser — client code.
 *
 * This file is served as an external same-origin script so the browser page
 * can run under a strict CSP with no 'unsafe-inline'. Keep it that way: do
 * not inline any of this back into the HTML.
 *
 * SECURITY INVARIANT — code and data are kept strictly separate:
 *   - Deck data (names, titles) reaches the DOM only via `textContent`,
 *     `dataset`, or a URL-typed property. Never `innerHTML`, never
 *     concatenated into markup, never into an inline `on*` attribute.
 *   - Behaviour is bound with `addEventListener` only. A row's identity
 *     travels in `data-name`, which the delegated handler reads back as a
 *     plain string.
 * A filename is attacker-controlled input (decks are shared/downloaded
 * artifacts), so a value that reaches a code context is executable. Building
 * nodes instead of markup means there is no code context to reach.
 */
(function () {
  'use strict';

  var listEl = document.getElementById('deck-list');
  var countEl = document.getElementById('deck-count');
  var folderEl = document.getElementById('folder-path');
  var searchEl = document.getElementById('search-input');

  var allDecks = [];
  var sortCol = 'modified';
  var sortAsc = false;

  var COLUMNS = [
    { key: 'title', label: 'Title' },
    { key: 'name', label: 'File' },
    { key: 'slides', label: 'Slides', right: true },
    { key: 'size', label: 'Size', right: true },
    { key: 'modified', label: 'Modified' }
  ];

  // ── Helpers ──────────────────────────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function deckUrl(name) {
    // URL encoder in a genuine URL sink — the correct pairing. This value is
    // only ever assigned to `a.href` / `location.assign()`, never embedded in
    // markup or a script context.
    // encodeURIComponent throws URIError on a lone surrogate, which a filename
    // with undecodable bytes can carry. The server drops those names, but this
    // must not depend on that: an unhandled throw here escapes renderList and
    // blanks the entire listing, so one bad name would hide every good deck.
    try {
      return '/deck/' + encodeURIComponent(name);
    } catch (e) {
      return null;
    }
  }

  function sortKey(deck) {
    // Titles come from deck JSON and can be any type. `(d.title || '').toLowerCase()`
    // throws on a truthy non-string, which silently kills search and sorting.
    var t = typeof deck.title === 'string' ? deck.title : '';
    return (t || (typeof deck.name === 'string' ? deck.name : '')).toLowerCase();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    var d = new Date(iso);
    var diff = (new Date() - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString();
  }

  function sortDecks(decks) {
    var col = sortCol;
    return decks.slice().sort(function (a, b) {
      var va, vb;
      if (col === 'title') { va = sortKey(a); vb = sortKey(b); }
      else if (col === 'name') { va = String(a.name).toLowerCase(); vb = String(b.name).toLowerCase(); }
      else if (col === 'slides') { va = a.slides; vb = b.slides; }
      else if (col === 'size') { va = a.size; vb = b.size; }
      else { va = a.modified; vb = b.modified; }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  function setSort(col) {
    if (sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = (col === 'title' || col === 'name'); }
    renderList();
  }

  // ── Rendering (nodes, never markup) ──────────────────────────────────

  function emptyState(icon, msg) {
    var wrap = el('div', 'empty-state');
    wrap.appendChild(el('div', 'icon', icon));
    wrap.appendChild(el('div', 'msg', msg));
    return wrap;
  }

  function buildHead() {
    var tr = document.createElement('tr');
    COLUMNS.forEach(function (col) {
      var th = el('th', sortCol === col.key ? 'sorted' : null, col.label + ' ');
      if (col.right) th.style.textAlign = 'right';
      th.dataset.sort = col.key;  // which column, as data — resolved by the delegated handler
      th.appendChild(el('span', 'sort-arrow', sortCol !== col.key ? '⇅' : (sortAsc ? '▲' : '▼')));
      tr.appendChild(th);
    });
    var spacer = el('th');
    spacer.style.width = '60px';
    tr.appendChild(spacer);
    var thead = document.createElement('thead');
    thead.appendChild(tr);
    return thead;
  }

  function buildRow(deck) {
    var tr = el('tr', 'deck-row');
    tr.dataset.name = deck.name;  // identity as data — never interpolated into code

    var tdTitle = el('td', 'col-title');
    var label = typeof deck.title === 'string' && deck.title ? deck.title : deck.name;
    var href = deckUrl(deck.name);
    var link = el(href ? 'a' : 'span', null, label);
    if (href) link.href = href;   // un-encodable name: render inert, never a dead link
    tdTitle.appendChild(link);
    tr.appendChild(tdTitle);

    tr.appendChild(el('td', 'col-file', deck.name));
    tr.appendChild(el('td', 'col-slides', deck.slides));
    tr.appendChild(el('td', 'col-size', formatSize(deck.size)));

    var tdModified = el('td', 'col-modified', formatDate(deck.modified));
    tdModified.title = deck.modified;  // property assignment, not attribute markup
    tr.appendChild(tdModified);

    var tdBadge = el('td', 'col-badge');
    if (deck.compact) tdBadge.appendChild(el('span', 'deck-badge', 'compact'));
    tr.appendChild(tdBadge);

    return tr;
  }

  function renderList() {
    var q = searchEl.value.toLowerCase().trim();
    var filtered = q ? allDecks.filter(function (d) {
      return sortKey(d).indexOf(q) !== -1 ||
             String(d.name).toLowerCase().indexOf(q) !== -1;
    }) : allDecks;

    var sorted = sortDecks(filtered);
    countEl.textContent = (q ? sorted.length + '/' : '') + allDecks.length +
                          ' deck' + (allDecks.length !== 1 ? 's' : '');

    if (!sorted.length) {
      listEl.replaceChildren(q
        ? emptyState('🔍', 'No decks match "' + q + '"')
        : emptyState('📂', 'No .vela deck files found in this folder.'));
      return;
    }

    var table = document.createElement('table');
    table.appendChild(buildHead());
    var tbody = document.createElement('tbody');
    sorted.forEach(function (deck) { tbody.appendChild(buildRow(deck)); });
    table.appendChild(tbody);
    listEl.replaceChildren(table);
  }

  // ── Behaviour (listeners only, no inline handlers) ───────────────────

  listEl.addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]');
    if (th) { setSort(th.dataset.sort); return; }

    var row = e.target.closest('tr.deck-row');
    if (!row) return;
    if (e.target.closest('a')) return;  // let the anchor handle its own navigation
    var href = deckUrl(row.dataset.name);
    if (href) window.location.assign(href);
  });

  searchEl.addEventListener('input', renderList);

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault(); searchEl.focus(); searchEl.select();
    }
    if (e.key === 'Escape' && document.activeElement === searchEl) {
      searchEl.value = ''; renderList(); searchEl.blur();
    }
  });

  // ── Data ─────────────────────────────────────────────────────────────

  function fetchDecks() {
    fetch('/api/decks')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        folderEl.textContent = data.folder;
        allDecks = Array.isArray(data.decks)
          ? data.decks.filter(function (d) { return d && typeof d.name === 'string'; })
          : [];
        renderList();
      })
      .catch(function (err) {
        listEl.replaceChildren(emptyState('⚠️', 'Error loading decks: ' + err.message));
      });
  }

  fetchDecks();
  setInterval(fetchDecks, 3000);
})();
