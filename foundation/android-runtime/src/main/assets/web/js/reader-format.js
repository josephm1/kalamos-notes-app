// ReaderFormat — per-book typography settings (WP9, AD-8 sidecar/format.json), shared by BookReader
// and EpubReader. Schema:
//   { fontScale, fontFamily:'serif'|'sans', embolden:0|1|2, lineSpacing, paraSpacing, marginPct, publisherCss }
// Global defaults live in localStorage (`kal.reader.format.<field>`, one key per field so a partial
// write never corrupts the whole blob); opening a book (load) merges those DEFAULTS ← globals ← the
// book's own sidecar/format.json (per-book always wins). Every change (set) persists BOTH: the
// per-book sidecar (so this book remembers its own settings) and the globals (so the next NEW book
// opened starts from whatever was last chosen) — same "last used wins" model the existing A-/A+ font
// scale already used (kal.reader.fontScale), which this module now replaces as the single source of
// truth (book-reader.js/epub-reader.js fontScale()/bumpFont() read/write through ReaderFormat).
const ReaderFormat = {
  DEFAULTS: {
    fontScale: 1.0, fontFamily: 'serif', embolden: 0,
    lineSpacing: 1.5, paraSpacing: 0, marginPct: 0, publisherCss: false,
    // When publisher CSS is enabled, this decides whether authored paragraph typography also wins.
    // Structural styling (rules, borders, colour, images and heading decoration) is always retained.
    publisherTypography: true,
    // WP5 additions. Defaults are no-ops (0), so books with no sidecar render pixel-identical.
    wordSpacing: 0, marginVPct: 0, fontEnhance: 0,
    indentMode: 'built', textAlign: 'justify', hyphen: true
  },
  // One-tap starting points. "Fit screen" deliberately uses reader-owned typography instead of
  // publisher CSS: rigid EPUB font sizes and margins are the most common reason a reflowable book
  // looks cramped on a small e-reader. The width check follows Android's compact/medium boundary;
  // users can still tune every value below and those edits become a custom setup.
  presetPatch(id) {
    const width = Math.max(1, (document.documentElement && document.documentElement.clientWidth) ||
      window.innerWidth || 600)
    if (id === 'compact') return {
      fontScale: width < 600 ? 0.95 : 0.9, fontFamily: 'serif', embolden: 0,
      lineSpacing: 1.3, paraSpacing: 0, marginPct: 0, publisherCss: false,
      publisherTypography: false,
      wordSpacing: 0, marginVPct: 0, fontEnhance: 1,
      indentMode: 'indent', textAlign: 'justify', hyphen: true
    }
    if (id === 'publisher') return Object.assign({}, this.DEFAULTS,
      { publisherCss: true, publisherTypography: true })
    return {
      fontScale: width < 600 ? 1.15 : (width < 840 ? 1.1 : 1.0),
      fontFamily: 'serif', embolden: 0,
      lineSpacing: 1.5, paraSpacing: 0.2, marginPct: width < 600 ? 0 : 4,
      publisherCss: true, publisherTypography: false,
      wordSpacing: 0, marginVPct: 0, fontEnhance: 1,
      indentMode: 'none', textAlign: 'left', hyphen: false
    }
  },
  // font-family stacks a fontFamily value maps to. 'serif' matches the pre-WP9 hardcoded book/epub
  // stylesheet default exactly, so an unchanged book renders pixel-identical (regression requirement).
  STACKS: {
    serif: "KalamosBookSerif, Georgia, serif",
    sans: "KalamosBookSans, system-ui, sans-serif",
    mono: "KalamosBookMono, 'Courier New', monospace"
  },

  _nbId: null, _fmt: null, _section: 'fonts',

  _loadGlobals() {
    const g = {}
    Object.keys(this.DEFAULTS).forEach(function(k) {
      try {
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('kal.reader.format.' + k) : null
        if (raw != null) g[k] = JSON.parse(raw)
      } catch (e) {}
    })
    return g
  },
  _saveGlobals(fmt) {
    Object.keys(this.DEFAULTS).forEach(function(k) {
      try { localStorage.setItem('kal.reader.format.' + k, JSON.stringify(fmt[k])) } catch (e) {}
    })
  },
  _loadSidecar(nbId) {
    try {
      const raw = Bridge.getBookFile(nbId, 'sidecar/format.json')
      const j = raw ? JSON.parse(raw) : null
      return (j && typeof j === 'object') ? j : {}
    } catch (e) { return {} }
  },
  _saveSidecar(nbId, fmt) {
    try { Bridge.saveBookFile(nbId, 'sidecar/format.json', JSON.stringify(Object.assign({ version: 1 }, fmt))) } catch (e) {}
  },

  // load merged settings for [nbId] (DEFAULTS ← globals ← per-book sidecar) and remember it as the
  // active book — get()/set() below operate on this cached copy. Returns the merged settings object.
  load(nbId) {
    this._nbId = nbId
    this._fmt = Object.assign({}, this.DEFAULTS, this._loadGlobals(), this._loadSidecar(nbId))
    return Object.assign({}, this._fmt)
  },

  get() { return Object.assign({}, this._fmt || this.DEFAULTS) },

  // merge [patch] into the active settings; persists to the per-book sidecar AND writes the same
  // values as the new global defaults. Returns the merged settings object.
  set(patch) {
    this._fmt = Object.assign({}, this._fmt || this.DEFAULTS, patch)
    if (this._nbId) this._saveSidecar(this._nbId, this._fmt)
    this._saveGlobals(this._fmt)
    return Object.assign({}, this._fmt)
  },

  // ---- CSS application (AD-8 → CSS custom properties a reader sets on its content root) ----
  // book-reader.js/epub-reader.js consume these as var(--rf-*, <original hardcoded default>) so an
  // element with no vars set at all renders exactly as it did before WP9 (regression safety net);
  // applyCssVars always sets every var explicitly (even at DEFAULTS) so the two stay in lockstep.
  cssVars(fmt) {
    fmt = fmt || this.get()
    return {
      '--rf-font-scale': fmt.fontScale,
      '--rf-font-family': this.STACKS[fmt.fontFamily] || this.STACKS.serif,
      '--rf-line-h': fmt.lineSpacing,
      '--rf-para-gap': fmt.paraSpacing + 'em',
      '--rf-margin': fmt.marginPct + '%',
      '--rf-embolden': fmt.embolden,
      '--rf-word-gap': (fmt.wordSpacing || 0) + 'em',
      '--rf-margin-v': (fmt.marginVPct || 0) + '%',
      '--rf-enhance': fmt.fontEnhance || 0,
      '--rf-stroke': (((fmt.embolden || 0) * .15) + ((fmt.fontEnhance || 0) * .05)).toFixed(2) + 'px',
      '--rf-align': fmt.textAlign || 'justify',
      '--rf-hyphens': fmt.hyphen === false ? 'none' : 'auto'
    }
  },
  applyCssVars(elm, fmt) {
    if (!elm) return
    const vars = this.cssVars(fmt)
    Object.keys(vars).forEach(function(k) { elm.style.setProperty(k, String(vars[k])) })
    fmt = fmt || this.get()
    elm.classList.toggle('rf-indent-custom', fmt.indentMode !== 'built')
    elm.classList.toggle('rf-reader-typography', !!fmt.publisherCss && fmt.publisherTypography === false)
    if (fmt.indentMode === 'built') elm.style.removeProperty('--rf-indent')
    else elm.style.setProperty('--rf-indent', fmt.indentMode === 'indent' ? '1.6em' : '0')
  },

  // ---- panel UI: ONE 'Format' tab, two inner sections (Fonts / Spacing) toggled by a sub-tab row,
  // every control a stepper (− value +) — no sliders (e-ink rule), big tap targets. bodyEl is the
  // ReaderPanels tab body; opts = { epub: bool, onChange(fmt) }. publisherCss only shows for epub. ----
  buildPanel(bodyEl, opts) {
    opts = opts || {}
    const self = this
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function() {}
    const fmt = this.get()

    function commit(patch) {
      const nf = self.set(patch)
      onChange(nf)
      if (typeof ReaderPanels !== 'undefined') ReaderPanels.refresh()   // redraw with the new readout
    }
    function mkPatch(field, v) { const p = {}; p[field] = v; return p }
    function clampStep(v, min, max, step) {
      v = Math.round(v / step) * step
      v = Math.round(v * 100) / 100
      return Math.max(min, Math.min(max, v))
    }

    // generic stepper row: label left, [− value +] right. dec()/inc() each return the patch to commit.
    function row(label, display, dec, inc) {
      const r = el('div', 'rf-row')
      r.appendChild(el('div', 'rf-row-label', label))
      const ctl = el('div', 'rf-stepper')
      const d = el('button', 'rf-step-btn', '−')
      const v = el('div', 'rf-step-val', display)
      const i = el('button', 'rf-step-btn', '+')
      d.addEventListener('click', function() { commit(dec()) })
      i.addEventListener('click', function() { commit(inc()) })
      ctl.appendChild(d); ctl.appendChild(v); ctl.appendChild(i)
      r.appendChild(ctl)
      return r
    }
    // numeric stepper convenience: field clamped to [min,max] in steps of [step].
    function numRow(label, field, min, max, step, fmt2str) {
      const v = fmt[field]
      return row(label, fmt2str(v),
        function() { return mkPatch(field, clampStep(v - step, min, max, step)) },
        function() { return mkPatch(field, clampStep(v + step, min, max, step)) })
    }

    const wrap = el('div', 'rf-panel')
    const presets = el('div', 'rf-presets')
    presets.appendChild(el('div', 'rf-presets-label', 'Reading style'))
    const presetButtons = el('div', 'rf-preset-buttons')
    const choices = [['fit', 'Fit screen'], ['compact', 'Compact']]
    if (opts.epub) choices.push(['publisher', 'Original layout'])
    choices.forEach(function(choice) {
      const b = el('button', 'rf-preset-btn', choice[1])
      b.type = 'button'
      b.addEventListener('click', function() { commit(self.presetPatch(choice[0])) })
      presetButtons.appendChild(b)
    })
    presets.appendChild(presetButtons)
    wrap.appendChild(presets)
    const subtabs = el('div', 'rf-subtabs')
    ;[['fonts', 'Aa', 'Fonts'], ['spacing', '↕', 'Spacing'], ['others', '•••', 'Others']].forEach(function(pair) {
      const b = el('button', 'rf-subtab' + (self._section === pair[0] ? ' sel' : ''))
      b.appendChild(el('span', 'rf-subtab-icon', pair[1]))
      b.appendChild(el('span', null, pair[2]))
      b.addEventListener('click', function() {
        self._section = pair[0]
        if (typeof ReaderPanels !== 'undefined') ReaderPanels.refresh()
      })
      subtabs.appendChild(b)
    })
    const sbody = el('div', 'rf-sectbody')

    if (self._section === 'spacing') {
      sbody.appendChild(numRow('Line spacing', 'lineSpacing', 1.1, 2.2, 0.1, function(v) { return v.toFixed(1) }))
      sbody.appendChild(numRow('Paragraph spacing', 'paraSpacing', 0, 1.6, 0.2, function(v) { return v.toFixed(1) }))
      sbody.appendChild(numRow('Word spacing', 'wordSpacing', 0, 0.4, 0.05, function(v) { return v.toFixed(2) + 'em' }))
      sbody.appendChild(numRow('Side margins', 'marginPct', 0, 20, 4, function(v) { return v + '%' }))
      sbody.appendChild(numRow('Top/bottom margins', 'marginVPct', 0, 20, 4, function(v) { return v + '%' }))
    } else if (self._section === 'others') {
      const IND = ['built', 'indent', 'none'], IND_L = { built: 'Built in', indent: 'Indent', none: 'None' }
      const indAt = Math.max(0, IND.indexOf(fmt.indentMode))
      sbody.appendChild(row('Paragraph indent', IND_L[fmt.indentMode] || 'Built in',
        function() { return mkPatch('indentMode', IND[(indAt + IND.length - 1) % IND.length]) },
        function() { return mkPatch('indentMode', IND[(indAt + 1) % IND.length]) }))
      sbody.appendChild(row('Alignment', fmt.textAlign === 'left' ? 'Left' : 'Justify',
        function() { return mkPatch('textAlign', fmt.textAlign === 'left' ? 'justify' : 'left') },
        function() { return mkPatch('textAlign', fmt.textAlign === 'justify' ? 'left' : 'justify') }))
      const hr = el('div', 'rf-row')
      hr.appendChild(el('div', 'rf-row-label', 'Hyphenation'))
      const hb = el('button', 'rf-toggle' + (fmt.hyphen !== false ? ' on' : ''), fmt.hyphen !== false ? 'On' : 'Off')
      hb.addEventListener('click', function() { commit(mkPatch('hyphen', fmt.hyphen === false)) })
      hr.appendChild(hb); sbody.appendChild(hr)
      if (opts.epub) {
        const pr = el('div', 'rf-row')
        pr.appendChild(el('div', 'rf-row-label', 'Publisher styles'))
        const pb = el('button', 'rf-toggle' + (fmt.publisherCss ? ' on' : ''), fmt.publisherCss ? 'On' : 'Off')
        pb.addEventListener('click', function() { commit(mkPatch('publisherCss', !fmt.publisherCss)) })
        pr.appendChild(pb); sbody.appendChild(pr)
      }
    } else {
      sbody.appendChild(numRow('Font size', 'fontScale', 0.7, 2.2, 0.1, function(v) { return Math.round(v * 100) + '%' }))
      const EB = ['Off', 'Medium', 'Bold']
      sbody.appendChild(row('Embolden', EB[fmt.embolden] || String(fmt.embolden),
        function() { return mkPatch('embolden', Math.max(0, fmt.embolden - 1)) },
        function() { return mkPatch('embolden', Math.min(2, fmt.embolden + 1)) }))
      sbody.appendChild(numRow('Enhancement', 'fontEnhance', 0, 4, 1, function(v) { return v ? ('Level ' + v) : 'Off' }))
      const FF = ['serif', 'sans', 'mono']
      const FL = { serif: 'Book serif', sans: 'Book sans', mono: 'Mono' }
      const fi = Math.max(0, FF.indexOf(fmt.fontFamily))
      sbody.appendChild(row('Font family', FL[fmt.fontFamily] || 'Book serif',
        function() { return mkPatch('fontFamily', FF[(fi + FF.length - 1) % FF.length]) },
        function() { return mkPatch('fontFamily', FF[(fi + 1) % FF.length]) }))
    }

    wrap.appendChild(subtabs); wrap.appendChild(sbody)
    bodyEl.innerHTML = ''
    bodyEl.appendChild(wrap)
  }
}

window.ReaderFormat = ReaderFormat
