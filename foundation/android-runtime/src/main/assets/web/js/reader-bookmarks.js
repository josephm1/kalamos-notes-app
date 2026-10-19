// Bookmarks — per-book bookmark model, persisted to sidecar/bookmarks.json (AD-8). Format-agnostic:
// each reader (blocks/epub/pdf) supplies a small adapter describing its own "loc" shape, so this file
// never needs to know how a blocks book vs an EPUB vs a PDF addresses a position.
//
// adapter = {
//   currentLoc(): loc              — the reader's current position, e.g. {type:'blocks', sectionId, page}
//   describeLoc(loc): string       — a short human label for a loc (used in the bookmarks list)
//   gotoLoc(loc)                   — jump the reader to loc
//   locEquals(a, b): bool          — true if two locs refer to the same page/position
// }
const Bookmarks = {
  nbId: null, adapter: null, _list: [], _onChange: null,

  init(nbId, adapter) {
    this.nbId = nbId
    this.adapter = adapter
    this._list = this._load()
  },

  _load() {
    try {
      const raw = Bridge.getBookFile(this.nbId, 'sidecar/bookmarks.json')
      const j = raw ? JSON.parse(raw) : null
      return (j && Array.isArray(j.bookmarks)) ? j.bookmarks : []
    } catch (e) { return [] }
  },

  _save() {
    Bridge.saveBookFile(this.nbId, 'sidecar/bookmarks.json', JSON.stringify({ version: 1, bookmarks: this._list }))
  },

  // newest first — the order the bookmarks panel shows them in.
  list() {
    return this._list.slice().sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0) })
  },

  onChange(fn) { this._onChange = fn },
  _fire() { if (this._onChange) this._onChange() },

  isCurrentBookmarked() {
    if (!this.adapter) return false
    const loc = this.adapter.currentLoc()
    const self = this
    return this._list.some(function(b) { return self.adapter.locEquals(b.loc, loc) })
  },

  // toggles a bookmark at the reader's current position. Returns true if a bookmark now exists there
  // (false if one was just removed).
  toggleAtCurrent() {
    if (!this.adapter) return false
    const loc = this.adapter.currentLoc()
    const self = this
    const idx = this._list.findIndex(function(b) { return self.adapter.locEquals(b.loc, loc) })
    let nowOn
    if (idx !== -1) { this._list.splice(idx, 1); nowOn = false }
    else {
      this._list.push({
        id: 'bm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        loc: loc,
        label: this.adapter.describeLoc(loc),
        createdAt: Date.now()
      })
      nowOn = true
    }
    this._save(); this._fire()
    return nowOn
  },

  remove(id) {
    const idx = this._list.findIndex(function(b) { return b.id === id })
    if (idx === -1) return
    this._list.splice(idx, 1)
    this._save(); this._fire()
  },

  goto(id) {
    const bm = this._list.find(function(b) { return b.id === id })
    if (bm && this.adapter) this.adapter.gotoLoc(bm.loc)
  }
}

window.Bookmarks = Bookmarks
