---
name: critique-review
description: Review and edit Obsidian notes that use CriticMarkup with the Critique plugin. Use when a note contains {++ ++}, {-- --}, {~~ ~> ~~}, {== ==} or {>> <<} marks, when asked to review, comment on or suggest edits to a Markdown note without rewriting it, or when asked to answer, resolve or act on review comments in a note.
---

# Critique review marks

Critique is an Obsidian plugin that renders CriticMarkup review marks and lets a person work through
them in a panel. When you edit a note that is under review, leave marks instead of rewriting text,
so the person can accept or reject each change and reply to each comment. The syntax is plain text,
so you edit the Markdown file directly.

## The five marks

```
{++inserted text++}            addition
{--removed text--}             deletion
{~~old text~>new text~~}       substitution (old is replaced by new)
{==quoted text==}              highlight (usually the anchor of a comment thread)
{>>comment text<<}             comment
```

Never nest marks. Never put a mark inside a fenced code block, inline code or YAML frontmatter;
Critique ignores marks there.

## Metadata prefix

Attribution goes in an attribute prefix between the opening brace and the mark's opener. Keys are
`key="value"`, separated by spaces; values may not contain `"`, `{`, `}` or newlines.

```
{author="Claude" date="2026-10-28T14:05-07:00" ++text++}
{author="Claude" date="2026-10-28T14:05-07:00" >>Consider citing the source here.<<}
```

- `author`: your name as the person configured it, or the agent name you were given. Always set it
  on marks you create. A mark with no `author` is the person's own.
- `date`: ISO 8601 with the local UTC offset at minute precision. Set it when you know the current
  time; leave it out rather than guessing.
- `label`: optional comment category the person may have enabled, for example `question`,
  `suggestion`, `issue`, `praise`. Use one only if existing comments in the note use labels.
- `status="resolved"`: on the first comment of a thread, marks the thread resolved. Do not set it
  yourself unless asked to resolve a thread.
- `edited`: a timestamp Critique adds when a comment is changed later. Leave it alone.

The prefix sits outside the content, so accepting a change strips it. Never put attribution inside
the content, such as `{>>Claude: text<<}`.

## Threads and anchors

- Comments placed directly after each other, with nothing or only spaces between them, form one
  thread. The first is the root; the rest are replies, in order.
- A highlight or a change placed directly before a thread is the thread's anchor: the thing the
  thread is about. `{==text==}{>>comment<<}` comments on existing text.
  `{++text++}{>>why<<}` attaches a rationale to a suggestion.
- To comment on existing text, wrap it in a highlight and put the comment right after it. To reply,
  append a comment right after the last comment of the thread. Never insert replies in the middle.
- A thread's comments stay on one line. Write a hard line break inside a comment as a literal `\n`
  and a backslash as `\\`.

```
We should {==document the retry policy==}{author="Dana" >>Where does this live today?<<}{author="Claude" >>In the README, under Configuration.<<} before the rollout.
```

## Making suggestions

- Prefer small, local marks: a substitution for a changed phrase, a deletion for a removed sentence,
  an addition for new text. Do not delete and re-add a whole paragraph to change one word.
- Keep the surrounding text intact so accept and reject produce correct prose, including spaces and
  punctuation outside the mark.
- Add a rationale thread after a change when the reason is not obvious.
- Do not accept, reject or remove the person's marks unless they ask you to.

## Acting on comments

When the person asks you to work through the review:

- A comment that asks a question: append a reply to that thread.
- A comment that asks for a change: make the change as a suggestion mark near the comment, and reply
  briefly if the change needs explaining. Leave the thread in place; the person resolves it.
- A reply with no `author`, or one carrying the person's configured name, is the person's. Do not
  write replies on their behalf and never stamp their name on your marks.
- Resolved threads (`status="resolved"` on the root) are settled. Do not reply to them.

## What accept, reject and delete do (so you can predict the result)

- Accept an addition: keeps its text. Reject: removes it.
- Accept a deletion: removes its text. Reject: keeps it.
- Accept a substitution: keeps the new text. Reject: keeps the old text.
- Accepting or rejecting a change also removes the thread attached to it.
- Deleting a thread unwraps a highlight anchor but never removes a change.
- A highlight with no thread is just a highlight; removing it keeps the text.

## Reading a note

In the raw file, the marks are all there is: no state lives outside the note. A one-line HTML
comment starting with `<!-- critique:` near the top is an optional pointer to this guide and can be
ignored.
