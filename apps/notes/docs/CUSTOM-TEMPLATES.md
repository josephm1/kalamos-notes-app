# Custom ruled templates

Put flat `.json` files in `/sdcard/Kalamos/notes/templates/custom`. The Custom tab reads the folder
when notebook creation opens. It remains empty by default; no sample files are installed there.

Templates contain editable document data, not executable HTML, JavaScript or background images.
Headings, text and checkbox fields use the ruled editor and its spacing, save and export behavior.
Free vector shapes can be moved/resized separately, like built-in Cornell's divider.

Minimal format:

```json
{
  "schema": "kalamos.notes.template.v1",
  "name": "My plan",
  "source": "",
  "sidecar": {
    "layoutLineHeight": 56,
    "textBoxes": [
      {"id":"heading","blockId":"planning-document","text":"Today","x":16,"y":0,"width":240,"size":32,"autoWidth":true},
      {"id":"task","blockId":"planning-document","text":"☐","x":480,"y":112,"width":36,"size":32,"checkbox":true}
    ]
  }
}
```

Coordinates are CSS paper coordinates (after Notes' gutters), and y positions use multiples of
`layoutLineHeight`. Design fields within the intended sheet width; custom fields are not automatically
rescaled to other screens. Use sidecar `sourceWords`, `inkRuns` and `pageObjects` only in the canonical
writing sidecar format. Missing source defaults to a blank document. Document name/fingerprint are
rebuilt when loaded; each created notebook receives its own copy of the data.

Only flat JSON filenames are accepted; traversal and links outside this directory are excluded.
Native discovery accepts at most 64 files, each at most 1 MiB. The writing feature validates and
normalizes sidecar data before making a starter available. Invalid files are skipped. Display names
are inserted as text, never interpreted as HTML. This app-owned bridge does not add filesystem access
to other apps or execute template code.
