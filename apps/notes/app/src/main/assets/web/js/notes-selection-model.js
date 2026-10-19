(function (root, factory) { var api = factory(); if (typeof module !== 'undefined' && module.exports) module.exports = api; if (root) root.NotesSelection = api })(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict'
  function create(onChange) {
    const keys=new Set();let active=false
    return {keys:keys,get active(){return active},start:function(key){active=true;keys.add(key);onChange()},toggle:function(key){if(keys.has(key))keys.delete(key);else keys.add(key);onChange()},done:function(){keys.clear();active=false;onChange()}}
  }
  function key(item) { return item.notebookId ? 'note:' + item.notebookId : 'folder:' + item.folderId }
  function move(library, keys, destination) {
    var next = JSON.parse(JSON.stringify(library)), selected = new Set(keys), folders = next.folders || []
    if (destination && !folders.some(function (f) { return f.folderId === destination })) throw new Error('That folder is no longer available')
    var cursor = destination, visited = new Set()
    while (cursor) {
      if (selected.has('folder:' + cursor)) throw new Error('A folder cannot be moved into itself or its descendants')
      if (visited.has(cursor)) throw new Error('Invalid folder hierarchy')
      visited.add(cursor); var folder = folders.find(function (f) { return f.folderId === cursor }); cursor = folder && folder.parentFolderId || ''
    }
    folders.forEach(function (f) { if (selected.has(key(f))) f.parentFolderId = destination })
    next.notebooks.forEach(function (n) { if (selected.has(key(n))) n.folderId = destination })
    return next
  }
  function remove(library, keys) {
    var next = JSON.parse(JSON.stringify(library)), selected = new Set(keys), folders = next.folders || []
    function survivingParent(id) {
      var seen = new Set()
      while (id && selected.has('folder:' + id)) {
        if (seen.has(id)) throw new Error('Invalid folder hierarchy')
        seen.add(id); var folder = folders.find(function (f) { return f.folderId === id }); id = folder && folder.parentFolderId || ''
      }
      return id || ''
    }
    next.notebooks = next.notebooks.filter(function (n) { return !selected.has(key(n)) }).map(function (n) { n.folderId = survivingParent(n.folderId); return n })
    next.folders = folders.filter(function (f) { return !selected.has(key(f)) }).map(function (f) { f.parentFolderId = survivingParent(f.parentFolderId); return f })
    return next
  }
  return Object.freeze({ create: create, key: key, move: move, remove: remove })
})
