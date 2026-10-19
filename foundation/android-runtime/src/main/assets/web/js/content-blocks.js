// Renders a page's interactive-format blocks into #content-layer as STATIC DOM. The editor then
// bakes that layer onto the opaque ink surface (Bridge.snapshotContent), and the user writes over it
// with the daemon pen. Nothing here is interactive (the ink surface owns touch): MCQs are answered by
// circling a choice, the drawing box is filled with real ink. See book-to-interactive-format.md §7.
const ContentBlocks = {
  // Render page.blocks into [container]; call [onReady] once images have loaded (so the bake captures
  // them). [notebookId] resolves image asset paths to data URLs via the bridge.
  render(container, page, notebookId, onReady) {
    container.innerHTML = ''
    const blocks = (page && page.blocks) || []
    if (!blocks.length) { container.classList.remove('has-content'); onReady && onReady(); return }
    container.classList.add('has-content')

    let pendingImgs = 0
    let mcqNum = 0
    const done = () => { if (pendingImgs === 0 && onReady) { onReady(); onReady = null } }

    blocks.forEach((b) => {
      let node = null
      switch (b.type) {
        case 'text':  node = this.text(b); break
        case 'image': node = this.image(b, notebookId, () => { pendingImgs--; done() });
                      if (b.src) pendingImgs++; break
        case 'mcq':   node = this.mcq(b, ++mcqNum); break
        case 'drawing': node = this.drawing(b); break
        case 'animation': node = this.animation(b); break
        case 'hotspots': node = buildHotspots(b,
                          function(s) { try { return Bridge.getNotebookAsset(notebookId, s) } catch (e) { return '' } },
                          function() { pendingImgs--; done() });
                          if (b.src) pendingImgs++; break
        case 'pintail': node = buildPintail(b,
                          function(s) { try { return Bridge.getNotebookAsset(notebookId, s) } catch (e) { return '' } },
                          function() { pendingImgs--; done() });
                          if (b.src) pendingImgs++; break
        case 'callout': node = buildCallout(b); break
        case 'math':    node = buildMath(b); break
        case 'flashcard': node = buildFlashcard(b, true); break   // bake = static: both faces shown
        case 'checklist': node = buildChecklist(b, null, true); break   // bake = static states
        case 'cloze':   node = buildCloze(b, true); break               // bake = empty blanks (write in ink)
        default: node = el('div', 'cb', '[' + b.type + ']')
      }
      if (node) container.appendChild(node)
    })
    done()   // in case there were no images
  },

  text(b) {
    const d = el('div', 'cb cb-text')
    d.innerHTML = miniMarkdown(b.format === 'plain' ? escapeHtml(b.md) : (b.md || ''))
    return d
  },

  image(b, notebookId, onSettle) {
    const fig = el('figure', 'cb cb-figure cb-fit-' + (b.fit || 'contain'))
    const img = document.createElement('img')
    img.className = 'cb-img'
    img.alt = b.alt || ''
    img.addEventListener('load', onSettle)
    img.addEventListener('error', function() { fig.classList.add('cb-img-missing'); onSettle() })
    // Resolve the notebook-relative asset to a data URL (native reads it off disk).
    let url = ''
    try { url = Bridge.getNotebookAsset(notebookId, b.src) } catch (e) {}
    if (url) img.src = url; else { img.alt = '(image)'; setTimeout(onSettle, 0) }
    fig.appendChild(img)
    if (b.caption) fig.appendChild(el('figcaption', 'cb-caption', b.caption))
    return fig
  },

  // Static MCQ: lettered choices, answered with the pen (circle the letter). No tap grading here.
  mcq(b, num) {
    const box = el('div', 'cb cb-mcq')
    const q = el('div', 'cb-mcq-q')
    q.innerHTML = '<span class="qnum">Q' + num + '.</span> ' + miniMarkdown(b.prompt).replace(/^<p>|<\/p>$/g, '')
    box.appendChild(q)
    const list = el('div', 'cb-choices')
    const letters = 'ABCDEFGH'
    b.choices.forEach((c, i) => {
      const row = el('div', 'cb-choice')
      row.innerHTML = '<span class="lett">' + letters[i] + '</span>' +
        miniMarkdown(c.md).replace(/^<p>|<\/p>$/g, '')
      list.appendChild(row)
    })
    box.appendChild(list)
    box.appendChild(el('div', 'cb-mcq-hint', '✎ Circle your answer with the pen.'))
    return box
  },

  drawing(b) {
    const wrap = el('div', 'cb')
    if (b.label) wrap.appendChild(el('div', 'cb-draw-label', b.label))
    const box = el('div', 'cb-draw-box')
    box.style.height = (b.height || 300) + 'px'
    box.appendChild(el('span', 'hint', '✎ sketch here'))
    wrap.appendChild(box)
    return wrap
  },

  // Static framed figure for now (the SVG is baked as a still). Live motion would reuse the native
  // animation sampler (startWebAnim) in a later pass — kept out for the bake-only content path.
  animation(b) {
    const wrap = el('div', 'cb cb-anim')
    const stage = el('div', 'cb-anim-stage')
    stage.innerHTML = (b.kind === 'breath') ? LUNGS_SVG : ''
    wrap.appendChild(stage)
    if (b.caption) wrap.appendChild(el('div', 'cb-caption', b.caption))
    return wrap
  }
}

// ---- helpers ----
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Tiny safe Markdown subset → HTML: headings, bold, italic, inline code, unordered lists, paragraphs.
function miniMarkdown(src) {
  const lines = String(src).split('\n')
  let html = '', inList = false
  const inline = (t) => escapeHtml(t)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // \$ = literal dollar sign (currency). The span isolates it in its own text node with a class the
    // KaTeX auto-render pass ignores, so it can never pair into a $...$ math span ("$24 to $28" bug).
    .replace(/\\\$/g, '<span class="nomath">$</span>')
  const closeList = () => { if (inList) { html += '</ul>'; inList = false } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    let m
    if ((m = line.match(/^###\s+(.*)/))) { closeList(); html += '<h3>' + inline(m[1]) + '</h3>'; continue }
    if ((m = line.match(/^##\s+(.*)/)))  { closeList(); html += '<h2>' + inline(m[1]) + '</h2>'; continue }
    if ((m = line.match(/^#\s+(.*)/)))   { closeList(); html += '<h1>' + inline(m[1]) + '</h1>'; continue }
    if ((m = line.match(/^[-*]\s+(.*)/))) { if (!inList) { html += '<ul>'; inList = true } html += '<li>' + inline(m[1]) + '</li>'; continue }
    closeList()
    html += '<p>' + inline(line) + '</p>'
  }
  closeList()
  return html
}

// Shared "labeled diagram" widget (used by the interactive reader, the book reader, and the editor
// bake path): an image with tappable numbered markers; tapping a marker reveals that spot's text in the
// panel below. [spec] = { src, alt?, caption?, spots:[{x,y,label?,md}] } with x,y normalized 0..1 of the
// image. [resolveUrl](src) → a displayable URL. [onImg] (optional) fires on image load/error (for the
// editor bake's capture wait). Reveal is ephemeral (no persistence) and tap-driven (e-ink: partial refresh).
function buildHotspots(spec, resolveUrl, onImg) {
  const wrap = el('div', 'rd-hotspots')
  const fig = el('figure', 'rd-hs-fig')
  const imgWrap = el('div', 'rd-hs-imgwrap')
  const img = document.createElement('img'); img.className = 'rd-hs-img'; img.alt = spec.alt || ''
  img.addEventListener('load', function() { onImg && onImg() })
  img.addEventListener('error', function() { imgWrap.classList.add('rd-hs-missing'); onImg && onImg() })
  let url = ''; try { url = resolveUrl(spec.src) } catch (e) {}
  if (url) img.src = url; else { img.alt = '(image)'; if (onImg) setTimeout(onImg, 0) }
  imgWrap.appendChild(img)
  const markers = el('div', 'rd-hs-markers'); imgWrap.appendChild(markers)
  fig.appendChild(imgWrap)
  if (spec.caption) fig.appendChild(el('figcaption', 'rd-caption', spec.caption))
  wrap.appendChild(fig)
  const panel = el('div', 'rd-hs-panel')
  panel.appendChild(el('span', 'rd-hs-hint', 'Tap a marker to reveal.'))
  wrap.appendChild(panel)
  const spots = Array.isArray(spec.spots) ? spec.spots : []
  const btns = []
  spots.forEach(function(s, i) {
    const b = el('button', 'rd-hs-marker', s.label != null ? String(s.label) : String(i + 1))
    b.style.left = (Math.max(0, Math.min(1, s.x || 0)) * 100) + '%'
    b.style.top = (Math.max(0, Math.min(1, s.y || 0)) * 100) + '%'
    b.addEventListener('click', function() {
      btns.forEach(function(o) { o.classList.remove('active') })
      b.classList.add('active')
      panel.innerHTML = miniMarkdown(s.md || '')
    })
    markers.appendChild(b); btns.push(b)
  })
  return wrap
}

// "Pin the Tail" — the inverse of hotspots: an image with an INVISIBLE target region. The reader taps to
// drop a pin; Check reveals whether the pin landed in the region (and shows it). Domain-agnostic — same
// widget works for "tap Ireland on the map", "tap the SA node on the ECG", "tap the hippocampus", etc.
// [spec] = { src, prompt?, target:[x1,y1,x2,y2] normalised 0..1, caption?, alt? }. [resolveUrl](src)→URL.
// [onImg] fires on image load/error (lets the reader re-paginate). Tap-driven, no animation (e-ink).
function buildPintail(spec, resolveUrl, onImg) {
  const wrap = el('div', 'rd-pintail')
  if (spec.prompt) wrap.appendChild(el('div', 'rd-pt-prompt', spec.prompt))
  const fig = el('figure', 'rd-pt-fig')
  const imgWrap = el('div', 'rd-pt-imgwrap')
  const img = document.createElement('img'); img.className = 'rd-pt-img'; img.alt = spec.alt || ''
  img.addEventListener('load', function () { onImg && onImg() })
  img.addEventListener('error', function () { imgWrap.classList.add('rd-pt-missing'); onImg && onImg() })
  let url = ''; try { url = resolveUrl(spec.src) } catch (e) {}
  if (url) img.src = url; else { img.alt = '(image)'; if (onImg) setTimeout(onImg, 0) }
  imgWrap.appendChild(img)
  const layer = el('div', 'rd-pt-layer'); imgWrap.appendChild(layer)
  fig.appendChild(imgWrap)
  if (spec.caption) fig.appendChild(el('figcaption', 'rd-caption', spec.caption))
  wrap.appendChild(fig)

  const tgt = (Array.isArray(spec.target) && spec.target.length === 4) ? spec.target : [0, 0, 1, 1]
  const box = el('div', 'rd-pt-target')                 // the (initially hidden) target region
  box.style.left = (tgt[0] * 100) + '%'; box.style.top = (tgt[1] * 100) + '%'
  box.style.width = ((tgt[2] - tgt[0]) * 100) + '%'; box.style.height = ((tgt[3] - tgt[1]) * 100) + '%'
  layer.appendChild(box)
  const pin = el('div', 'rd-pt-pin'); layer.appendChild(pin)   // the dropped marker

  let placed = null
  imgWrap.addEventListener('click', function (e) {
    const r = imgWrap.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    placed = { x: x, y: y }
    pin.style.left = (x * 100) + '%'; pin.style.top = (y * 100) + '%'; pin.classList.add('show')
    wrap.classList.remove('correct', 'wrong'); box.classList.remove('show'); fb.textContent = ''
  })

  const fb = el('div', 'rd-pt-fb', '')
  const check = el('button', 'rd-btn rd-pt-check', 'Check')
  check.addEventListener('click', function () {
    if (!placed) { try { Bridge.showToast('Tap the image to place your pin') } catch (e) {} return }
    const ok = placed.x >= tgt[0] && placed.x <= tgt[2] && placed.y >= tgt[1] && placed.y <= tgt[3]
    wrap.classList.toggle('correct', ok); wrap.classList.toggle('wrong', !ok)
    box.classList.add('show')                              // reveal the invisible region either way
    fb.innerHTML = ok ? '<b>✓ Correct.</b>' : '<b>✗ Not quite.</b> The area is shown.'
  })
  const foot = el('div', 'rd-pt-foot'); foot.appendChild(check)
  wrap.appendChild(foot); wrap.appendChild(fb)
  return wrap
}

// Callout box — note/tip/warning/quote. Pure CSS, mono-safe (outline weight + a small inverted tag
// per variant, never grey fills). [spec] = { variant?, title?, md }. Quote gets a hairline left bar
// and no tag; the other variants carry a solid-black chip so they scan differently in pure B/W.
function buildCallout(spec) {
  const variant = ['note', 'tip', 'warning', 'quote'].indexOf(spec.variant) !== -1 ? spec.variant : 'note'
  const wrap = el('aside', 'rd-callout rd-co-' + variant)
  if (variant !== 'quote') {
    const head = el('div', 'rd-co-head')
    head.appendChild(el('span', 'rd-co-tag', { note: 'NOTE', tip: 'TIP', warning: '! WARNING' }[variant]))
    if (spec.title) head.appendChild(el('span', 'rd-co-title', spec.title))
    wrap.appendChild(head)
  }
  const body = el('div', 'rd-co-body')
  body.innerHTML = miniMarkdown(spec.md || '')
  wrap.appendChild(body)
  if (variant === 'quote' && spec.title) wrap.appendChild(el('div', 'rd-co-cite', '— ' + spec.title))
  return wrap
}

// Display equation via KaTeX (bundled in vendor/katex, loaded by app.html). [spec] = { tex, caption? }.
// Falls back to the raw TeX in monospace when KaTeX is unavailable or the TeX is malformed, so the
// content is never silently lost. Static — nothing to tap (e-ink safe by construction).
function buildMath(spec) {
  const wrap = el('div', 'rd-math')
  const eq = el('div', 'rd-math-eq')
  let ok = false
  try {
    if (typeof katex !== 'undefined') { katex.render(spec.tex || '', eq, { displayMode: true, throwOnError: true }); ok = true }
  } catch (e) {}
  if (!ok) { eq.textContent = spec.tex || ''; eq.classList.add('rd-math-raw') }
  wrap.appendChild(eq)
  if (spec.caption) wrap.appendChild(el('div', 'rd-caption', spec.caption))
  return wrap
}

// Tap-to-flip study card. [spec] = { front, back } (both markdown). Tap toggles which face shows —
// a class swap (partial refresh), no motion. Ephemeral (no persistence). The editor bake path can't
// tap, so [staticBoth] renders both faces stacked and labeled instead. [onFlip] (optional) fires
// after a flip — the faces can differ in height, so readers re-paginate to keep columns true.
function buildFlashcard(spec, staticBoth, onFlip) {
  if (staticBoth) {
    const both = el('div', 'rd-flash rd-flash-static')
    const f = el('div', 'rd-flash-face'); f.appendChild(el('span', 'rd-flash-tag', 'FRONT'))
    const fb = el('div', 'rd-flash-body'); fb.innerHTML = miniMarkdown(spec.front || ''); f.appendChild(fb)
    const b = el('div', 'rd-flash-face'); b.appendChild(el('span', 'rd-flash-tag', 'BACK'))
    const bb = el('div', 'rd-flash-body'); bb.innerHTML = miniMarkdown(spec.back || ''); b.appendChild(bb)
    both.appendChild(f); both.appendChild(b)
    return both
  }
  const wrap = el('div', 'rd-flash')
  const card = el('button', 'rd-flash-card')
  const tag = el('span', 'rd-flash-tag', 'FRONT')
  const body = el('div', 'rd-flash-body')
  body.innerHTML = miniMarkdown(spec.front || '')
  card.appendChild(tag); card.appendChild(body)
  card.appendChild(el('span', 'rd-flash-hint', 'tap to flip'))
  let back = false
  card.addEventListener('click', function() {
    back = !back
    tag.textContent = back ? 'BACK' : 'FRONT'
    body.innerHTML = miniMarkdown((back ? spec.back : spec.front) || '')
    card.classList.toggle('flipped', back)
    onFlip && onFlip(wrap)
  })
  wrap.appendChild(card)
  return wrap
}

// Tappable checklist with PERSISTENT checked state — the only Tier-2 widget that saves. The widget
// itself is storage-agnostic: [items] = [{id, md, done?}], tapping a row flips its square and calls
// [onToggle](item, done); the caller owns persistence (notebook: item.done + Reader.save() into meta;
// book: sidecar/checklist JSON). [staticBake] renders the current states untappable (pen editor).
// Mono-safe: empty square ↔ solid black square with a white check; done text goes strikethrough.
function buildChecklist(spec, onToggle, staticBake) {
  const wrap = el('div', 'rd-checklist')
  if (spec.title) wrap.appendChild(el('div', 'rd-cl-title', spec.title))
  const items = Array.isArray(spec.items) ? spec.items : []
  items.forEach(function(it) {
    const row = el(staticBake ? 'div' : 'button', 'rd-cl-row' + (it.done ? ' done' : ''))
    row.appendChild(el('span', 'rd-cl-box'))
    const txt = el('span', 'rd-cl-text')
    txt.innerHTML = miniMarkdown(it.md || '').replace(/^<p>|<\/p>\s*$/g, '')
    row.appendChild(txt)
    if (!staticBake) row.addEventListener('click', function() {
      const done = !row.classList.contains('done')
      row.classList.toggle('done', done)
      onToggle && onToggle(it, done)
    })
    wrap.appendChild(row)
  })
  return wrap
}

// Cloze (fill-in-the-blank): {{hidden}} spans in the markdown render as empty outlined blanks; tapping
// a blank reveals its text (tap again re-hides). Ephemeral — reveal state is not saved. The {{…}}
// pieces are cut out BEFORE the markdown pass (so braces never fight the parser) and swapped back in
// as buttons after. [staticBake] renders every blank as an empty slot (the pen editor writes answers
// in ink over the page).
function buildCloze(spec, staticBake) {
  const wrap = el('div', 'rd-cloze')
  const blanks = []
  const tokenised = String(spec.md || '').replace(/\{\{([^{}]+)\}\}/g, function(_, answer) {
    blanks.push(answer.trim())
    return '\u0000' + (blanks.length - 1) + '\u0000'   // NUL-framed: survives the markdown pass, can't collide with text
  })
  const html = miniMarkdown(tokenised).replace(/\u0000(\d+)\u0000/g, function(_, i) {
    // ch-based width ≈ the answer's length so the blank hints at the word size without showing it
    return '<button class="rd-cz-blank" data-i="' + i + '" style="min-width:' +
           Math.max(3, blanks[+i].length) + 'ch"><span class="rd-cz-ans">' +
           escapeHtml(blanks[+i]) + '</span></button>'
  })
  wrap.innerHTML = html
  if (!staticBake) Array.prototype.forEach.call(wrap.querySelectorAll('.rd-cz-blank'), function(b) {
    b.addEventListener('click', function() { b.classList.toggle('revealed') })
  })
  return wrap
}

const LUNGS_SVG =
  '<svg viewBox="0 0 240 200" preserveAspectRatio="xMidYMid meet">' +
  '<line x1="120" y1="26" x2="120" y2="96" stroke="#333" stroke-width="6" stroke-linecap="round"/>' +
  '<path d="M120,70 L96,86 M120,70 L144,86" stroke="#333" stroke-width="6" fill="none" stroke-linecap="round"/>' +
  '<path d="M112,80 C112,120 96,150 78,168 C58,188 44,168 44,140 C44,112 60,86 88,80 C100,77 112,76 112,80 Z" fill="#D88" stroke="#A33" stroke-width="3"/>' +
  '<path d="M128,80 C128,120 144,150 162,168 C182,188 196,168 196,140 C196,112 180,86 152,80 C140,77 128,76 128,80 Z" fill="#D88" stroke="#A33" stroke-width="3"/>' +
  '</svg>'

window.ContentBlocks = ContentBlocks
