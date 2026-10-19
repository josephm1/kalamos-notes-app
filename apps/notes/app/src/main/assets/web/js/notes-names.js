// Notes-owned filename policy; shared shelf invokes only the optional validation hook.
(function () {
  'use strict'
  const stem = title => String(title || '').normalize('NFKC').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '-').trim().replace(/[. ]+$/, '').slice(0,120) || 'Notebook'
  const key = title => stem(title).toLowerCase()
  function unique(title, existing) {
    const base=stem(title), used=new Set(existing.map(key))
    if(!used.has(key(base)))return base
    let number=2
    while(used.has(key(base.slice(0,110)+' ('+number+')')))number++
    return base.slice(0,110)+' ('+number+')'
  }
  window.KalamosNotesNames={stem,key,unique}
  window.AppLibrary=window.AppLibrary || {}
  window.AppLibrary.validateNotebookTitle=function(title,id) {
    if(title!==stem(title)){Bridge.showToast('Use a filename without slashes, control characters or trailing dots.');return false}
    if((window.libraryData?.notebooks || []).some(note=>note.notebookId!==id && key(note.title)===key(title))){Bridge.showToast('A notebook with that name already exists. Choose a different name.');return false}
    return true
  }
})()
