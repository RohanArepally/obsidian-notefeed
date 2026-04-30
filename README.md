# Obsidian Note Feed

An Obsidian plugin that builds a card-based feed of notes using a simple weighted algorithm:

- 10% random picks
- 30% newly created notes
- 40% recently opened/edited notes
- 20% most-opened notes in trailing configurable window (90 days by default)
- Shows all available notes by default (no 20-card cap)

## Features

- Custom `Notes Feed` view with a left-sidebar ribbon icon
- Card UI with title, ~150 character plaintext preview, and reason/date footer
- Refresh button in the view header
- Open tracking persisted in plugin data
- Rename/delete-safe state migration and cleanup

## State Model

Persisted data shape:

```ts
{
  openCounts: {
    [path: string]: {
      count: number;
      lastOpened: number;
      recentOpenTimestamps?: number[];
    }
  }
}
```

`recentOpenTimestamps` are pruned to the trailing window (90 days by default) so most-opened ranking reflects recent behavior.

Notes with zero opens in the active trailing window are excluded from the "most-opened" bucket.

## Development

1. Install dependencies:
   - `npm install`
2. Build once:
   - `npm run build`
3. Watch in development:
   - `npm run dev`

Copy `manifest.json`, `main.js`, and `styles.css` into your vault plugin folder:

`.obsidian/plugins/note-feed/`

Then enable **Note Feed** in Obsidian Community Plugins.

## Community release files

This repository includes the files Obsidian community releases expect:

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## Releasing and first submission

See `RELEASING.md` for:

- version bump process
- GitHub release packaging
- first-time submission steps to the Obsidian community plugin index
