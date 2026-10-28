# Critique

CriticMarkup review for Obsidian. Mark additions, deletions, substitutions, highlights and comment
threads from a selection in Live Preview, Source mode or Reading mode; see them highlighted (or
underlined, or only in the margin tray); and work through them in a review panel.

Home: https://github.com/melnicorn/critique-obsidian. Design proposal with mockups: [docs/proposal.html](docs/proposal.html).

## Syntax

Standard CriticMarkup, with an optional attribute prefix for metadata (the same format Track Changes
uses, so notes and agent tooling written for it interoperate):

```
{author="Chris" date="2026-10-28T14:05-07:00" ++added text++}
{--deleted text--}
{~~old~>new~~}
{==highlighted==}{author="Dana" date="…" >>comment on the highlight<<}{author="Chris" date="…" >>reply<<}
{author="Dana" status="resolved" >>a resolved standalone comment<<}
```

- Adjacent comments (only spaces between them) form a thread. A highlight or change directly before
  the first comment is the thread's anchor.
- `status="resolved"` on the root comment marks the thread resolved; `label="question"` is optional.
- Comments stay on one line; hard line breaks are stored as `\n`.
- Marks inside code blocks, inline code and frontmatter are ignored.

## Using it

- **Select text** and use the floating toolbar, the right-click menu (Critique submenu) or the
  commands *Mark selection as …*. Comment and Substitution ask for text in a small popover.
- **Margin tray**: comment threads show a bubble in the right margin; click it for the thread.
  With *Mark style: Off* every mark shows there instead of inline styling.
- **Hover** a mark for its card; **click** a comment chip to pin it.
- **Review panel** (ribbon icon, status bar, or *Toggle review panel*): every mark as a card with
  Accept / Reject / Reply / Resolve / Delete, inline editing of comments (pencil or double-click),
  filters (All / Changes / Comments, Mine, Resolved) and bulk accept/reject in the menu.
- **Reading mode**: same rendering; selecting text shows the toolbar and right-click offers the same
  actions, written back through the vault.
- Commands also cover accept/reject at cursor or for the whole note, next/previous mark, resolve at
  cursor, copy without markup, copy as strict CriticMarkup (metadata folded into comment text), and
  cycling the mark style.

## Settings

Author name and timestamps, colors, mark style (highlighted / dashed underline / off), per-type
deletion and addition styles, author colors, metadata folding in Source mode, margin indicators per
mode, hiding marks in Reading mode (accepted preview), panel location, delete confirmation,
strip-on-copy, toolbar toggles and optional comment labels.

## Development

```
npm install
npm run build        # typecheck + bundle to dist/ (main.js, manifest.json, styles.css)
npm test             # parser, operations and alignment tests (node --test)
npm run dev          # watch
node scripts/install-vault.mjs "/path/to/vault"   # copy dist/ into <vault>/.obsidian/plugins/critique
```

`scripts/cdp.mjs` drives a running Obsidian started with `--remote-debugging-port=9222` for
screenshots and DOM checks (`node scripts/cdp.mjs eval '<js>'`, `… shot out.png [selector]`).

Minimum Obsidian version: 1.8.0.

## CI and releases

Every push and pull request runs tests and a build (`.github/workflows/build.yml`) and uploads the
built files as a workflow artifact. A release is manual:

```
gh workflow run build.yml -R melnicorn/critique-obsidian --ref main -f build_type="Build & Release"
```

The version comes from `version` in `package.json`, which is only a `major.minor` floor: the patch
auto-increments from the latest existing tag, and raising the floor resets it. Tags have no `v`
prefix (`0.1.3`) because Obsidian requires the release tag to equal `manifest.json`'s version; the
workflow stamps the computed version into the released manifest, so the repo copy keeps the floor.
Each release attaches `main.js`, `manifest.json`, `styles.css` and `critique-<version>.tar.gz`.
Release notes are written by Gemini when the `GEMINI_API_KEY` repository secret is set, and by
GitHub's generated notes otherwise.
