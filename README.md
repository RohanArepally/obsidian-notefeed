# Obsidian Note Feed

Obsidian Note Feed is a community plugin that surfaces notes in a ranked feed to help you revisit and rediscover content in your vault.

## Ranking Model

The feed uses weighted sampling across four buckets:

- 10% random notes
- 30% newly created notes
- 40% recently opened or edited notes
- 20% most-opened notes in a trailing configurable window (90 days by default)

Notes with zero opens in the active window are excluded from the most-opened bucket.

## Features

- Dedicated `Notes Feed` view with ribbon icon and command
- Card layout with title, plaintext preview, and reason/date metadata
- Open tracking persisted in plugin data
- Safe handling for file rename and delete events
- Manual refresh action in the feed view

## Installation (Manual)

1. Run `npm install`
2. Run `npm run build`
3. Copy `manifest.json`, `main.js`, and `styles.css` to:
   - `.obsidian/plugins/obsidian-note-feed/`
4. Enable **Obsidian Note Feed** in Community Plugins settings

## Development

- Build once: `npm run build`
- Watch mode: `npm run dev`

## Release Artifacts

Each release must include:

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## Releasing

See `RELEASING.md` for versioning, release packaging, and first-time submission steps for the Obsidian community plugin index.
