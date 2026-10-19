// Per-app config for Kalamos Notes (read by app.js → App.applyConfig / App.start).
// Notes is the plain note-taking build: it lands on the library and opens notebooks
// into the handwriting editor (or the interactive/book readers when the meta says so).
window.KalamosConfig = {
  title: "Kalamos Notes",
  libraryTitle: "All my notebooks",
  defaultMode: "library",
  libraryOrder: "lastOpened",
  nestedFolders: true,
  libraryCreationInChrome: true,
  libraryFolderBar: false
};
