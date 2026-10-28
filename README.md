# Critique

Review notes in Obsidian the way you would review a document: suggest changes, highlight passages,
leave comments and reply to them, then accept or reject each change. Critique uses
[CriticMarkup](http://criticmarkup.com), a plain-text convention, so every mark lives in the note
itself and works with any editor, sync tool or AI agent.

- **Mark from a selection.** Select text and pick Addition, Deletion, Substitution, Highlight or
  Comment from the floating toolbar, the right-click menu or a command. Works in Live Preview,
  Source mode and Reading mode.
- **See marks the way you like.** Highlighted, dashed-underlined, or hidden with only a margin
  indicator. Deletions strike through in red, additions underline in green; colors and styles are
  yours to change.
- **Comment threads.** Comments on a highlight or a change form a thread. A bubble in the right
  margin shows where threads are; hover a mark for its card, click the bubble to reply or resolve.
- **Review panel.** A side panel lists every change and thread in the note. Accept, reject, reply,
  resolve, edit a comment in place, filter to changes, comments or your own marks, or accept all.
- **Signed and timestamped.** Every mark you create carries your name and the time, so a note
  reviewed by two people, or by you and an agent, stays readable. Pin a color per author if the
  automatic ones don't suit.
- **Preview the outcome.** A header button switches a note between Markup, Accepted preview and
  Original preview without touching the file. When the review is over, Finalize applies every
  change and removes every mark in one step, with a backup copy.
- **Agent-friendly.** Ships with a guide (`SKILL.md`) that teaches an AI agent how to leave and
  answer review marks in your notes.

## Install

Critique needs Obsidian 1.8 or newer.

**From a release**

1. Download `critique-<version>.tar.gz` from the
   [latest release](https://github.com/melnicorn/critique-obsidian/releases/latest) and unpack it
   into `<your vault>/.obsidian/plugins/`. It creates a `critique` folder holding `main.js`,
   `manifest.json`, `styles.css` and `SKILL.md`. The individual files are also attached to the
   release if you prefer to copy them by hand.
2. In Obsidian, open Settings → Community plugins, turn off Restricted mode if it is on, and enable
   **Critique**.
3. Open Settings → Critique and set your **Author name**.

**With BRAT**

Add `melnicorn/critique-obsidian` in the
[BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin to install and keep up with releases.

## Using Critique

**Leaving marks.** Select text and use the toolbar that appears above it, right-click → Critique,
or the *Mark selection as …* commands (bind hotkeys to the ones you use most). Comment and
Substitution ask for their text in a small popover; ⌘↩ saves, Esc cancels. With nothing selected,
Comment drops a standalone comment at the cursor.

**Reading the note.** Marks keep their styling in every mode. In Source mode the syntax stays
visible but dimmed. Comment threads show as a bubble in the right margin; a thread with no anchor
shows a small chip in the text. Hover any mark for its card; click a bubble or chip to pin the
card and reply.

**Reviewing.** Open the panel from the ribbon icon, the count in the status bar, or *Toggle review
panel*. Each card jumps to its mark when clicked. Accept, Reject, Reply, Resolve and Delete write
straight into the note. Double-click a comment, or use its pencil, to edit it in place. The menu in
the panel header accepts or rejects everything at once.

**Previewing and finishing.** The file-diff button in the note header cycles Markup → Accepted
preview → Original preview (also as commands). Both previews are display only and the status bar
names the active one. When you are done, *Finalize note* accepts every change, unwraps every
highlight, removes every comment and leaves a clean note, saving a backup copy next to it first
(setting). The panel menu also offers *Accept all changes by <author>* when more than one author
left changes.

**Commands** also cover accept or reject at the cursor or for every change inside the selection
(the right-click menu offers the same when the selection spans several changes), next and previous
mark, resolve the thread at the cursor, copy the selection or note without markup, copy or export
the note as strict CriticMarkup (metadata folded into comment text), and cycling the mark style.

**Panel and note stay in sync.** Hovering a mark lights up its card, hovering a card lights up its
marks, and the card at the cursor is kept in view.

**Reading mode** does all of this too: select text for the toolbar or right-click for the menu, and
the mark is written to the file.

## Settings

| Group | What you can change |
|---|---|
| Signature | Author name, whether to add timestamps, their precision, whether edits are stamped |
| Appearance | Colors for the four mark kinds, mark style (highlighted / dashed underline / off), tint strength, deletion and addition text styles, per-author colors with optional pinned colors per author, folding metadata in Source mode |
| Indicators and Reading mode | Margin indicators per mode, hiding marks in Reading mode to read the note as if everything were accepted |
| Authoring | Selection toolbar in the editor and in Reading mode, optional comment labels (question, suggestion, …) |
| Agents | Add a one-line guide header to reviewed notes, and the guide URL it links to |
| Review panel and safety | Panel side, backup before Finalize, delete confirmation, stripping marks on copy |

## Working with AI agents

Because the marks are plain text, an agent can review a note by editing the file, and you can work
through its suggestions in the panel. The agent needs to know the conventions: the attribute prefix
for author and date, how adjacent comments form a thread, and what accept and reject will do.
Critique ships that knowledge as `SKILL.md`, in the
[Agent Skills](https://agentskills.io) format, so it works as both a readable guide and an
installable skill.

**Install the skill.** Copy `SKILL.md` into your agent's skills folder. For Claude Code, that is
`.claude/skills/critique/SKILL.md` in the project, or `~/.claude/skills/critique/SKILL.md` for
every project. The file is in the release tarball, in the plugin folder after install
(`.obsidian/plugins/critique/SKILL.md`), and in this repository at
[skills/critique/SKILL.md](skills/critique/SKILL.md).

**Point agents at it from the note (optional).** Turn on *Add agent guide header to reviewed
notes* in Settings → Agents. The first mark added to a note then also inserts a one-line HTML
comment after the frontmatter: a sentence on how the marks work and a link to the guide. It is
hidden in Live Preview and Reading mode, removed when the last mark leaves the note, and stripped
from copies without markup. The commands *Insert agent guide header* and *Remove agent guide
header* do the same by hand.

## The syntax

Standard CriticMarkup, plus an optional attribute prefix for metadata. The format is the same one
the Track Changes plugin uses, so notes and agent tooling written for either work with both.

```
{author="Chris" date="2026-10-28T14:05-07:00" ++added text++}
{--deleted text--}
{~~old~>new~~}
{==highlighted==}{author="Dana" date="…" >>comment on the highlight<<}{author="Chris" date="…" >>reply<<}
{author="Dana" status="resolved" >>a resolved standalone comment<<}
```

- Adjacent comments form a thread. A highlight or change directly before the first comment is the
  thread's anchor.
- `status="resolved"` on the root comment marks a thread resolved; `label="question"` is optional.
- Comments stay on one line; a line break inside one is written as `\n`.
- Marks inside code blocks, inline code, frontmatter and HTML comments are ignored.
- Accepting or rejecting a change removes the thread attached to it. Deleting a thread unwraps a
  highlight anchor but never removes a change.

## Development

```
npm install
npm test             # parser, operations, alignment and header tests
npm run build        # typecheck + bundle to dist/ (main.js, manifest.json, styles.css, SKILL.md)
npm run dev          # watch
node scripts/install-vault.mjs "/path/to/vault"   # copy dist/ into <vault>/.obsidian/plugins/critique
```

`scripts/cdp.mjs` drives a running Obsidian started with `--remote-debugging-port=9222` for
screenshots and DOM checks. The design proposal with mockups is in
[docs/proposal.html](docs/proposal.html).

**Releases** are manual. Every push runs tests and the build; a release run computes the version
from the `major.minor` floor in `package.json` plus the latest tag, stamps it into the released
manifest, tags the commit and publishes the files above with notes written by Gemini
(`GEMINI_API_KEY` secret; `GEMINI_MODEL` variable, default `gemini-3.1-flash-lite`):

```
gh workflow run build.yml -R melnicorn/critique-obsidian --ref main -f build_type="Build & Release"
```

Tags have no `v` prefix because Obsidian requires the tag to equal the manifest version.
