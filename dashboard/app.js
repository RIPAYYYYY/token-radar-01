// LaunchScope's dashboard. It reads window.SCOPE (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable and sortable table, a per-protocol detail drawer that recomputes
// the row's implied value from the snapshot figures in the open, and the calibration behind the
// model. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.SCOPE;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model, recomputed in the open: the peer multiple is the category's median market-cap-per-TVL
  // among live-token protocols, shrunk toward the global median by the category's peer count; the
  // other three factors come from the row's own figures and the stated constants.
  function shrunk(catStats, globalStats, key) {
    if (!catStats || !catStats.peers) return globalStats[key];
    var w = catStats.peers / (catStats.peers + DATA.model.shrink_k);
    return w * catStats[key] + (1 - w) * globalStats[key];
  }
  function factorsOf(row) {
    var m = DATA.model;
    var cat = row.category ? DATA.calibration.by_category[row.category] : undefined;
    var multiple = Math.min(shrunk(cat, DATA.calibration.global, 'median'), DATA.calibration.winsor_cap);
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.momentum_floor_pct, m.momentum_cap_pct);
    var momentum = 1 + (growth / 100) * m.momentum_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + m.maturity_range * Math.sqrt(clamp(age, 0, m.maturity_days) / m.maturity_days);
    var breadth = 1 + m.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_extra);
    return {
      multiple: multiple, momentum: momentum, maturity: maturity, breadth: breadth,
      implied: Math.max(1, Math.round(row.tvl_usd * multiple * momentum * maturity * breadth)),
      peers: cat ? cat.peers : 0,
    };
  }
  function scoreParts(row) {
    var m = DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    return [
      { label: 'Size', pts: 30 * clamp((Math.log10(Math.max(row.tvl_usd, 1)) - Math.log10(5e6)) / (Math.log10(5e9) - Math.log10(5e6)), 0, 1), max: 30 },
      { label: 'Momentum', pts: 25 * clamp(((row.change_7d || 0) + 20) / 70, 0, 1), max: 25 },
      { label: 'Maturity', pts: 20 * clamp(age / m.maturity_days, 0, 1), max: 20 },
      { label: 'Breadth', pts: 15 * clamp((row.chains || []).length / 12, 0, 1), max: 15 },
      { label: 'Peer depth', pts: 10 * clamp((row.model ? row.model.peers : 0) / 20, 0, 1), max: 10 },
    ];
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    try {
      if (next) window.history.replaceState(null, '', '#' + next);
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* a file page may refuse history writes; the view still works */ }
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'multiple') { av = a.model.multiple; bv = b.model.multiple; }
      else if (key === 'score') { av = a.radar_score; bv = b.radar_score; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'scope-mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'Launch', el('em', { text: 'Scope' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', null, 'snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'model ', el('b', { text: DATA.model_version })),
        el('span', null, 'calibrated on ', el('b', { text: DATA.calibration.global.peers + ' live-token protocols' }))
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Protocols with no token yet, ranked by what that token could be worth' }),
        el('p', null,
          'LaunchScope prices a launch that has not happened: each protocol that ', el('b', { text: 'records no token' }),
          ' is valued at the market-cap-per-TVL multiple its own category\'s live-token protocols actually trade at, adjusted for its seven-day momentum, its age and its chain breadth. ',
          'The house watchlist is the floor, not the ceiling: the board adds every early candidate below it. Implied value is this board\'s own claim, never a promise.'
        )
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', null, String(DATA.watchlist_size), el('small', { text: ' / ' + DATA.watchlist_size }))),
        el('div', { class: 'stat' }, el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Early finds below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Board implied total' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'stat' }, el('span', { text: 'Global peer multiple' }), el('b', { text: fmtMult(DATA.calibration.global.median) })),
        el('div', { class: 'stat' }, el('span', { text: 'Already trading, set aside' }), el('b', { text: String(DATA.live_total) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var watchBtn = el('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': state.watch ? 'true' : 'false' },
      el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Watchlist only');
    watchBtn.addEventListener('click', function () { state.watch = !state.watch; writeHash(); render(); });
    var boardTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'board'; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Scope' }), watchBtn),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, boardTab, liveTab)),
      el('span', { class: 'count', text: state.tab === 'board' ? visibleRows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' of ' + DATA.live_total + ' trading' })
    );
  }

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label,
        active ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25BC' : ' \u25B2' }) : null
      )
    );
  }
  function scoreChip(score) {
    var cls = score >= 65 ? 'score hi' : score >= 45 ? 'score mid' : 'score';
    return el('span', { class: cls, text: String(score) });
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category, chain or scope to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (n, r) { return Math.max(n, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', null, el('b', { text: r.name }), r.on_watchlist ? el('span', { class: 'badge', text: 'watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00B7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'no chains recorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.model.multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, scoreChip(r.radar_score))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols ranked by implied value. Select a row for its value breakdown, peer context and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Peer \u00D7'),
            sortHeader('implied', 'Implied value'),
            sortHeader('score', 'Radar')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'trades' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00B7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') : 'no chains recorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols\' tokens exist, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-per-TVL ratios are the calibration the board\'s multiples come from. The ' + DATA.live_total + ' trading protocols of the snapshot, the ' + DATA.live.length + ' largest shown.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Actual \u00D7' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var g = DATA.calibration.global;
    var cats = Object.keys(DATA.calibration.by_category)
      .map(function (c) { return { category: c, stats: DATA.calibration.by_category[c] }; })
      .filter(function (x) { return x.stats.peers >= 5; })
      .sort(function (a, b) { return b.stats.peers - a.stats.peers; })
      .slice(0, 12);
    var tbody = el('tbody');
    cats.forEach(function (x) {
      tbody.appendChild(el('tr', null,
        el('td', { text: x.category }),
        el('td', { class: 'num', text: String(x.stats.peers) }),
        el('td', { class: 'num', text: fmtMult(x.stats.median) }),
        el('td', { class: 'num', text: fmtMult(x.stats.p25) + ' \u2013 ' + fmtMult(x.stats.p75) })
      ));
    });
    tbody.appendChild(el('tr', null,
      el('td', null, el('b', { text: 'All categories (fallback)' })),
      el('td', { class: 'num', text: String(g.peers) }),
      el('td', { class: 'num', text: fmtMult(g.median) }),
      el('td', { class: 'num', text: fmtMult(g.p25) + ' \u2013 ' + fmtMult(g.p75) })
    ));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How LaunchScope prices a token that does not exist yet' }),
      el('div', { class: 'cols' },
        el('div', null,
          el('div', { class: 'formula' },
            'implied = tvl_usd \u00D7 ', el('span', { class: 'k', text: 'peer multiple' }),
            ' \u00D7 (1 + clamp(change_7d, ' + m.momentum_floor_pct + ', ' + m.momentum_cap_pct + ') / 100 \u00D7 ' + m.momentum_weight + ') \u00D7 (' + m.maturity_floor + ' + ' + m.maturity_range + ' \u00D7 \u221A(min(age, ' + m.maturity_days + 'd) / ' + m.maturity_days + 'd)) \u00D7 (1 + ' + m.breadth_per_chain + ' \u00D7 extra chains)'
          ),
          el('ul', null,
            el('li', null, el('b', { text: 'Peer multiple. ' }), 'The median market cap per TVL dollar of the live-token protocols in the same category, shrunk toward the global median (' + fmtMult(g.median) + ' from ' + g.peers + ' protocols) when the category has few peers: weight n/(n+' + m.shrink_k + '). Every peer ratio is first winsorized at ' + fmtMult(DATA.calibration.winsor_cap) + ', the global 95th percentile, so one token whose TVL collapsed after launch cannot price a whole category. The band on each row is the same shrinkage applied to the category\'s 25th and 75th percentiles.'),
            el('li', null, el('b', { text: 'Momentum. ' }), 'Seven-day TVL growth, clamped so one hot or cold week moves a value by at most +' + Math.round(m.momentum_cap_pct * m.momentum_weight) + '% or ' + Math.round(m.momentum_floor_pct * m.momentum_weight) + '%.'),
            el('li', null, el('b', { text: 'Maturity. ' }), 'Age since DefiLlama first tracked the protocol: the longer it has run with no token, the closer the factor gets to 1. An unrecorded age counts as ' + m.unknown_age_days + ' days.'),
            el('li', null, el('b', { text: 'Breadth. ' }), 'Two per cent per extra chain, up to ten: a protocol live on many chains reaches more farmers.'),
            el('li', null, el('b', { text: 'Who is on the board. ' }), 'Every watchlist protocol, plus every other protocol that records no token and is not a wrapped, staked, bridged or exchange product of one that trades, under the same exclusions the house applied to the watchlist. One function scores every row; no name is special-cased.')
          )
        ),
        el('div', null,
          el('table', { class: 'mini-table' },
            el('caption', { class: 'sub', text: 'Category calibration: what a TVL dollar is worth where a token already trades' }),
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }),
              el('th', { scope: 'col', text: 'Median \u00D7' }), el('th', { scope: 'col', text: 'Middle half' })
            )),
            tbody
          ),
          el('p', { text: 'A protocol records no token when the snapshot carries no market cap, CoinGecko id or symbol for it; that is a statement about the record, not proof no token exists anywhere. The radar score (0\u2013100) is a triage aid built from size, momentum, maturity, breadth and peer depth; the ranking itself is by implied value alone.' })
        )
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var f = factorsOf(row);
    var cat = row.category ? DATA.calibration.by_category[row.category] : undefined;
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' \u00B7 watchlist' : ' \u00B7 early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' \u00B7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'no chains recorded') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    var lo = Math.log(Math.max(row.implied_low_usd, 1));
    var hi = Math.log(Math.max(row.implied_high_usd, 2));
    var mid = Math.log(Math.max(row.implied_value_usd, 1));
    var pos = hi > lo ? clamp(((mid - lo) / (hi - lo)) * 100, 0, 100) : 50;
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, if it launched at its peers\' multiple' }),
      el('div', { class: 'big-value', text: fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'band' },
        el('div', { class: 'band-track', 'aria-hidden': 'true' }, el('span', { class: 'band-mark', style: 'left:calc(' + pos.toFixed(1) + '% - 1px)' })),
        el('div', { class: 'band-labels' },
          el('span', { text: 'low ' + fmtUsd(row.implied_low_usd) }),
          el('span', { text: 'peer band' }),
          el('span', { text: 'high ' + fmtUsd(row.implied_high_usd) })
        )
      ),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'all categories') + ', ' + f.peers + ' live peer' + (f.peers === 1 ? '' : 's') + ')' }), el('b', { text: fmtMult(f.multiple) })),
        el('div', null, el('span', { text: 'Momentum \u00D7 (7d ' + fmtPct(row.change_7d) + ')' }), el('b', { text: f.momentum.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: 'Maturity \u00D7 (age ' + fmtAge(row.age_days) + ')' }), el('b', { text: f.maturity.toFixed(4) + 'x' })),
        el('div', null, el('span', { text: 'Breadth \u00D7 (' + (row.chains || []).length + ' chains)' }), el('b', { text: f.breadth.toFixed(4) + 'x' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check' }, 'This page recomputes the row as ', el('b', { text: fmtUsd(f.implied) }), f.implied === row.implied_value_usd ? ' \u2014 the same number board.json carries.' : ' \u2014 which differs from the board, so the data would be stale.', ' An estimate from the snapshot\'s own figures, not a price and not a prediction that a token will be issued.')
    ));

    var parts = scoreParts(row);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Radar score ' + row.radar_score + ' / 100' }),
      el('div', { class: 'meter' }, parts.map(function (p) {
        return el('div', null,
          el('span', { text: p.label }),
          el('span', { class: 'track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.round((p.pts / p.max) * 100) + '%' })),
          el('b', { text: String(Math.round(p.pts)) })
        );
      })),
      el('p', { class: 'check', text: cat ? 'Peer context: ' + (row.category || 'its category') + ' has ' + cat.peers + ' live-token protocol' + (cat.peers === 1 ? '' : 's') + '; their median multiple is ' + fmtMult(cat.median) + ', middle half ' + fmtMult(cat.p25) + ' to ' + fmtMult(cat.p75) + '. The global median is ' + fmtMult(DATA.calibration.global.median) + '.' : 'Peer context: no live-token protocols share this category, so the row is priced on the global median multiple of ' + fmtMult(DATA.calibration.global.median) + '.' })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('div', { class: 'plan-total' },
        el('span', null, 'capital ', el('b', { text: fmtUsd(row.plan.capital_usd) })),
        el('span', null, 'est. fees ', el('b', { text: fmtUsd(row.plan.fees_usd) })),
        el('span', null, 'runs ', el('b', { text: row.plan.weeks + ' weeks' }))
      ),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null);
      }))
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Snapshot record' }),
      el('div', { class: 'facts' },
        el('div', null, el('span', { text: 'Slug' }), el('b', { text: row.slug })),
        el('div', null, el('span', { text: 'First tracked' }), el('b', { text: row.listed_at || 'not recorded' })),
        el('div', null, el('span', { text: 'Token on record' }), el('b', { text: 'none recorded' })),
        el('div', null, el('span', { text: 'On the house watchlist' }), el('b', { text: row.on_watchlist ? 'yes' : 'no \u2014 early find' }))
      )
    ));

    if (!dialog.isConnected) app.appendChild(dialog);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    // A re-render rebuilds the controls, so carry the search box's focus and caret across it:
    // without this, typing in the search would lose the box after the first character.
    var searchHadFocus = document.activeElement && document.activeElement.id === 'q';
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'board' ? boardTable() : liveTable());
    if (state.tab === 'board') shell.appendChild(modelPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source + '. The snapshot is sealed: this page renders from data.js alone, with no network.' }),
      el('span', { text: 'Implied values are LaunchScope\'s own model output (' + DATA.model_version + '), shown so a reader can weigh a farm before spending on it. Nothing here is financial advice.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (searchHadFocus) {
      var input = document.getElementById('q');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
