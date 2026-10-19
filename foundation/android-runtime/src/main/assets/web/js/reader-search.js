// ReaderSearch (WP11, AD-9) — the 'Search' tab shared by all three readers (blocks/epub/pdf). Each
// reader supplies a small format-specific adapter (mirrors the Bookmarks adapter pattern in
// reader-bookmarks.js):
//
//   adapter = {
//     search(query, token, onBatch)   — kick off a search; onBatch(matches, done) is called one or
//                                        more times with the FULL list of matches accumulated so far
//                                        (never a delta) and a `done` flag. `token` is only meaningful
//                                        to bridge-backed adapters (epub/pdf) — they hand it straight
//                                        to Bridge.searchBook and register it via ReaderSearch.register
//                                        so the single global window.onSearchResults can route the
//                                        reply back here; the pure-JS blocks backend can ignore it.
//                                        Each match already carries a display-ready `snippet` and
//                                        `ref` (chapter title / "Page N") string — reader-search.js
//                                        never needs to know the reader's own loc shape.
//     gotoMatch(match)                — jump the reader to a match and (where supported) draw a
//                                        transient locator mark.
//   }
//
// window.onSearchResults(token, json, done) is the ONE global dispatcher for the async bridge
// contract (AD-9) — registered once here, routes by token to whichever adapter is waiting.
//
// A per-panel generation counter guards every render: if the reader retypes a query fast, only the
// LAST search's results ever reach the DOM — an older, still in-flight batch (bridge round-trip, or
// a slow synchronous scan) is dropped silently.
const ReaderSearch = {
  _pending: {},   // token -> fn(json, done)  (bridge-backed adapters only)

  register(token, cb) { this._pending[token] = cb },
  unregister(token) { delete this._pending[token] },

  // bodyEl: the panel body ReaderPanels handed us. adapter: see contract above.
  buildTab(bodyEl, adapter) {
    bodyEl.innerHTML = ''
    const wrap = el('div', 'rs-wrap')
    const bar = el('div', 'rs-bar')
    const input = document.createElement('input')
    input.type = 'search'; input.className = 'rs-input'
    input.placeholder = 'Search this book'
    input.setAttribute('enterkeyhint', 'search')
    input.setAttribute('autocapitalize', 'off')
    input.setAttribute('autocorrect', 'off')
    const go = el('button', 'rd-btn rs-go', 'Go')
    bar.appendChild(input); bar.appendChild(go)
    const resultsBox = el('div', 'rs-results')
    wrap.appendChild(bar); wrap.appendChild(resultsBox)
    bodyEl.appendChild(wrap)

    let seq = 0          // generation counter — bumped on every new search, guards stale batches
    let lastQuery = ''

    function setStatus(text) {
      resultsBox.innerHTML = ''
      resultsBox.appendChild(el('div', 'rp-empty', text))
    }

    function renderResults(matches, done, mySeq) {
      if (mySeq !== seq) return   // superseded by a newer search — drop this (possibly late) batch
      matches = matches || []
      if (!matches.length) { setStatus(done ? 'No results' : 'Searching…'); return }
      resultsBox.innerHTML = ''
      const capped = matches.length > 200 ? matches.slice(0, 200) : matches
      ReaderPanels.paginateList(resultsBox, capped, function(m) {
        const row = el('button', 'rp-row rs-row')
        const info = el('div', 'rs-row-info')
        const snip = el('div', 'rs-snippet')
        snip.innerHTML = rsBoldTerm(m.snippet || '', lastQuery)
        info.appendChild(snip)
        info.appendChild(el('div', 'rp-row-date rs-ref', m.ref || ''))
        row.appendChild(info)
        // m.snippet is the raw backend text — rsBoldTerm above only bolds a throwaway copy for
        // display, it never mutates m. Readers that need to relocate a drifted offset (EPUB: the
        // backend counts whitespace-collapsed chars, the DOM doesn't) need the literal query term,
        // so pass it alongside the match rather than have them try to re-derive it from HTML.
        row.addEventListener('click', function() {
          ReaderPanels.close()
          adapter.gotoMatch(Object.assign({}, m, { term: m.term || lastQuery }))
        })
        return row
      }, 10)
      if (matches.length > 200) resultsBox.appendChild(el('div', 'rs-cap-note', 'Showing first 200 of ' + matches.length))
    }

    function runSearch() {
      const q = input.value.trim()
      lastQuery = q
      seq++
      const mySeq = seq
      if (!q) { resultsBox.innerHTML = ''; return }   // empty query: no-op, just clear any old results
      setStatus('Searching…')
      const token = 'srch' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      adapter.search(q, token, function(matches, done) { renderResults(matches, !!done, mySeq) })
    }

    go.addEventListener('click', runSearch)
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); runSearch() } })
  }
}

// Escapes snippet text for innerHTML use, then wraps the FIRST case-insensitive occurrence of
// [query] in <b>. Escaping first keeps the two strings' indices aligned for plain-text queries
// (the only kind a reader types here).
function rsEscapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function rsBoldTerm(snippet, query) {
  const esc = rsEscapeHtml(snippet)
  const q = rsEscapeHtml(query)
  if (!q) return esc
  const i = esc.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return esc
  return esc.slice(0, i) + '<b>' + esc.slice(i, i + q.length) + '</b>' + esc.slice(i + q.length)
}

// Single global dispatcher for the AD-9 async contract — routes a bridge reply to whichever
// adapter registered [token] (EpubReader/PdfReader's buildSearchAdapter, see epub-reader.js/
// pdf-reader.js). Auto-unregisters once a batch arrives with done=true.
window.onSearchResults = function(token, json, done) {
  const cb = ReaderSearch._pending[token]
  if (!cb) return
  if (done) ReaderSearch.unregister(token)
  cb(json, done)
}

window.ReaderSearch = ReaderSearch
