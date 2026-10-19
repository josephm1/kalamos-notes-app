# Kalamos Notes

Android notebook app with ruled handwriting, editable Markdown, page overview, AI formatting and Android sharing. Supports standard Android and Bigme e-ink devices.

This repository is a self-contained source snapshot of the active Notes app and its shared dependency modules, exported on 19 October 2026 from the Kalamos monorepo. It includes the latest toolbar foreground handoff and single-owner checkbox pen handling. Other Kalamos apps, historical archives, local notebooks, device captures and build outputs are excluded. No sibling checkout is required.

## Build

Install JDK 17 and Android SDK 34. Set `ANDROID_HOME` or create an untracked `local.properties` containing `sdk.dir=/absolute/path/to/android-sdk`.

```bash
./gradlew :apps:notes:assembleDebug
./gradlew :apps:notes:assembleDebug -Pkalamos.device=bigme
```

Output: `apps/notes/app/build/outputs/apk/debug/notes-debug.apk`. The application ID remains `com.kalamos.notebook` for compatibility with existing notebooks. `tools/gradle.sh` optionally uses the installed Android Studio Flatpak/JDK17 environment.

## Writing source

`features/writing/workspace` is canonical. Regenerate Android assets after editing it:

```bash
cd features/writing/workspace
npm ci
npm test
npm run typecheck
npm run build:android
```

Generated assets live in `features/writing/android`; do not edit them directly.

## Checks

```bash
node --test --test-concurrency=1 apps/notes/tests/*.test.mjs
./gradlew :apps:notes:testDebugUnitTest
```

Read `AGENTS.md`, `RULES.md` and `docs/devices/bigme/INK-WRITING-GUIDE.md` before changing native ink behavior. Physical device testing is performed by the owner; browser and unit tests do not establish e-ink panel acceptance.

## Recognition and privacy

MyScript is no longer used. The SDK, certificate and language resources have been removed;
this build does not require a MyScript account or licence. Image-to-Markdown AI formatting
uses the provider configured in Notes. API keys are entered on device and stored locally.
User notebooks, device captures, build outputs and signing keys are excluded from source.

## Licence and downloads

Kalamos Notes and its original shared source in this distribution use **[GNU GPLv3](LICENSE)**.
Third-party files retain their own licences and notices, including the optional reader bridge
and vendor dependencies. [InkSDK attribution and terms](docs/licensing/INKSDK.md) credit Ed Wei
and the original InkSDK contributors. Public APKs and their matching source are available under
[Releases](https://github.com/josephm1/kalamos-notes-app/releases). Generic and Bigme APKs are
separate alternatives; install the one intended for your hardware.
