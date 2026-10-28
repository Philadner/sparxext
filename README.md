# Sparx Bookwork Code Detector

A small Firefox WebExtension for Sparx Maths that captures bookwork codes and selected answers locally for revision.

This is inspired by the public shape of `acquitelol/sparxmaths`: content-script injection, selectable text, and local bookwork history. It deliberately does not auto-answer bookwork checks, choose options, solve homework, or bypass Sparx Maths checks.

## Features

- Makes Sparx page text selectable.
- Captures Sparx React answer state first, with DOM-based fallbacks for older or changed screens.
- Saves selected answers alongside the bookwork code when a correct answer is detected.
- Shows a small on-page notification with the detected code.
- Stores recent codes in Firefox local extension storage.
- Provides a popup with recent codes, clear, and CSV export.

## Install Temporarily In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Run `npm install` and `npm run build`.
4. Select `manifest.json` from this folder, or select `dist/manifest.json`.
5. Open or refresh Sparx Maths.

Temporary add-ons are removed when Firefox closes. For a permanent install, package the folder as a WebExtension and sign it through Mozilla Add-ons.

## Files

- `manifest.json` configures Firefox permissions and points at the generated `dist/` scripts.
- `vite.config.ts` and `scripts/build.mjs` build the Firefox MV2 extension with Vite.
- `src/content.ts` coordinates structured React capture, DOM fallback capture, storage, and the in-page menu.
- `src/capture.ts` contains the read-only React-fiber and DOM extraction helpers.
- `src/content.css` enables selectable text and styles the on-page notification.
- `src/background.ts` handles screenshot handoff for the helper sites.
- `src/popup.html`, `src/popup.css`, and `src/popup.ts` provide the toolbar popup.
