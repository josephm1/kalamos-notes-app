# Writing feature

`workspace` is the canonical TypeScript source and test suite. `android` is the Android library
containing its generated classic-script JS/CSS bundle.

```bash
cd workspace
npm test
npm run typecheck
npm run build:android
```

Never edit `android/src/main/assets/web/js/write-workspace.js` or its CSS by hand. The storage schema
retains historical `write2` identifiers only for document compatibility; those names are not a
runtime dependency on an old project.

