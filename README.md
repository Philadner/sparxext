# Sparx Bookwork Code Detector

A small Firefox WebExtension for Sparx Maths that detects visible bookwork codes on the page and saves them locally for revision.

This is inspired by the public shape of `acquitelol/sparxmaths`: content-script injection, selectable text, and local bookwork history. It deliberately does not auto-answer bookwork checks, choose options, solve homework, or bypass Sparx Maths checks.

## Features

- Makes Sparx page text selectable.
- Detects visible bookwork-code text when it appears on a Sparx page.
- Saves the selected answer alongside the bookwork code when a correct answer is detected.
- Shows a small on-page notification with the detected code.
- Stores recent codes in Firefox local extension storage.
- Provides a popup with recent codes, clear, and CSV export.

## Install Temporarily In Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `manifest.json` from this folder.
4. Open or refresh Sparx Maths.

Temporary add-ons are removed when Firefox closes. For a permanent install, package the folder as a WebExtension and sign it through Mozilla Add-ons.

## Files

- `manifest.json` configures Firefox permissions and injection targets.
- `src/content.js` detects and stores visible codes.
- `src/content.css` enables selectable text and styles the on-page notification.
- `src/popup.html`, `src/popup.css`, and `src/popup.js` provide the toolbar popup.
