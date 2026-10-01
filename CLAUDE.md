# CLAUDE.md

## Running locally

```sh
cd website
python -m http.server 8000
# open http://localhost:8000/
```

This is a static app with no build step. Serve the project root.

## Web v2 structure

- Repository root — the Android 2.0 HTML/CSS/JavaScript frontend adapted for browsers.
- `levels/normal/<n>x<n>/` — 700 built-in normal TXT levels.
- `levels/hard/<n>x<n>/` — 700 built-in hard TXT levels.
- `levels/extra/<difficulty>/<n>x<n>/` — 2,800 static extra TXT levels.
- `levels_index.json` — counts for all base and extra level groups.
- `tools/check_web_port.cjs` — validates browser-only features, static assets and all 4,200 levels.

The browser version deliberately has no BGM, board upload or exit button. Button/meow effects are played by `sound.js` with the native `Audio` API.

## Architecture

- `game.js` owns game state, navigation, progress, items and level loading.
- `map-data.js`, `selection-ui.js` and `score-system.js` provide v2 maps, level selection and scoring.
- `share-code-format.js` and `share-code.js` provide random-level sharing.
- Progress uses the v2 `localStorage` keys such as `meowdoku_done_v2` and `meowdoku_progress_v2`.
- The 12 region colors never wrap; levels requiring more colors are rejected.
- Fixed and extra levels are loaded from `levels/...` relative to `index.html`.

Run `node tools/check_web_port.cjs` after changing the frontend or levels.
