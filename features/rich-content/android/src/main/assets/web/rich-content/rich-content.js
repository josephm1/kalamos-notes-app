(function (root) {
  'use strict'
  function safeLink(url) {
    url = String(url || '').trim()
    if (/^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(url)) return url
    try { var u = new URL(url); return /^(?:https?:|mailto:|tel:)$/.test(u.protocol) ? u.href : '' } catch (_) { return '' }
  }
  function safeImage(url) { try { var u = new URL(String(url || '').trim()); return u.protocol === 'https:' ? u.href : '' } catch (_) { return '' } }
  function sanitizeSvg(source) {
    source = String(source || '').trim()
    if (!/^<svg\b/i.test(source)) throw new Error('A complete SVG root is required')
    if (/<\s*(?:script|foreignObject|iframe|object|embed|style|link|animate|set)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|data:|file:|javascript:)|url\s*\(/i.test(source)) throw new Error('Unsafe SVG content')
    if (root.DOMPurify) source = root.DOMPurify.sanitize(source, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['script','foreignObject','iframe','object','embed','style','link','animate','set'], FORBID_ATTR: ['style'] })
    return source
  }
  // Mermaid emits its own local <style> block. Treat that renderer output separately from authored
  // SVG: retain its presentation (including Mermaid's XHTML label containers), but reject every
  // active element, handler, external reference and CSS fetch primitive before DOMPurify sees it.
  // The Mermaid parser itself also runs in strict mode.
  function sanitizeMermaidSvg(source) {
    source = String(source || '').trim()
    if (!/^<svg\b/i.test(source)) throw new Error('A complete Mermaid SVG root is required')
    if (/<\s*(?:script|iframe|object|embed|link|animate|set)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|data:|file:|javascript:)|url\s*\(\s*(?!["']?#)|@import|expression\s*\(/i.test(source)) throw new Error('Unsafe Mermaid SVG content')
    if (root.DOMPurify) source = root.DOMPurify.sanitize(source, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_TAGS: ['style', 'foreignObject'],
      FORBID_TAGS: ['script','iframe','object','embed','link','animate','set']
    })
    return source
  }
  function markdown(source) {
    var html = root.marked ? root.marked.parse(String(source || ''), { gfm: true, breaks: false }) : String(source || '').replace(/[&<>]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c] }).replace(/\n/g, '<br>')
    if (root.DOMPurify) html = root.DOMPurify.sanitize(html, { FORBID_TAGS: ['script','style','iframe','object','embed','form'], FORBID_ATTR: ['style','srcset'] })
    var box = document.createElement('div'); box.innerHTML = html
    box.querySelectorAll('a').forEach(function (a) { var href = safeLink(a.getAttribute('href')); if (!href) a.removeAttribute('href'); else { a.href = href; a.rel = 'noopener noreferrer' } })
    box.querySelectorAll('img').forEach(function (img) {
      var src = safeImage(img.getAttribute('src'))
      if (!src) { img.remove(); return }
      img.src = src
      img.loading = 'lazy'
      img.decoding = 'async'
      img.referrerPolicy = 'no-referrer'
      img.removeAttribute('width'); img.removeAttribute('height')
    })
    return box.innerHTML
  }
  async function renderMermaid(host, source, id) {
    if (!root.mermaid) throw new Error('Mermaid is unavailable')
    // Recent Mermaid versions use the global flag; flowchart.htmlLabels alone still emitted
    // foreignObject labels whose XHTML children were removed by the SVG sanitizer.
    root.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', htmlLabels: false, flowchart: { htmlLabels: false }, themeVariables: { primaryColor:'#fff', primaryTextColor:'#000', primaryBorderColor:'#000', lineColor:'#000', background:'#fff' } })
    var result = await root.mermaid.render(id || ('mermaid-' + Date.now()), String(source || ''))
    host.innerHTML = sanitizeMermaidSvg(result.svg)
  }
  root.KalamosRichContent = Object.freeze({ markdown: markdown, sanitizeSvg: sanitizeSvg, sanitizeMermaidSvg: sanitizeMermaidSvg, renderMermaid: renderMermaid, safeLink: safeLink, safeImage: safeImage })
})(window)
