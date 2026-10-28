import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, codeRegions, counts, threadOf, markAt } from "../src/parser";

test("parses the five basic forms", () => {
  const doc = "a {++add++} b {--del--} c {~~old~>new~~} d {==hl==} e {>>c<<} f";
  const p = parse(doc);
  assert.deepEqual(
    p.marks.map((m) => m.type),
    ["addition", "deletion", "substitution", "highlight", "comment"],
  );
  assert.equal(p.marks[0].text, "add");
  assert.equal(p.marks[2].oldText, "old");
  assert.equal(p.marks[2].newText, "new");
  assert.equal(doc.slice(p.marks[2].from, p.marks[2].to), "{~~old~>new~~}");
  assert.equal(p.marks[4].from, doc.indexOf("{>>"));
});

test("reads attribute prefixes", () => {
  const doc = '{author="Chris" date="2026-10-28T14:05-07:00" ++text++}';
  const p = parse(doc);
  assert.equal(p.marks.length, 1);
  const m = p.marks[0];
  assert.equal(m.meta.author, "Chris");
  assert.equal(m.meta.date, "2026-10-28T14:05-07:00");
  assert.equal(m.text, "text");
  assert.equal(doc.slice(m.metaFrom, m.metaTo), 'author="Chris" date="2026-10-28T14:05-07:00" ');
  // no space before the sigil also works
  const p2 = parse('{author="D"++x++}');
  assert.equal(p2.marks[0].meta.author, "D");
  assert.equal(p2.marks[0].text, "x");
});

test("groups adjacent comments into threads with anchors", () => {
  const doc = 'Text {==hl==}{author="A">>root<<} {author="B">>reply<<} more {>>solo<<}\n{>>next line<<}';
  const p = parse(doc);
  assert.equal(p.threads.length, 3);
  const t0 = p.threads[0];
  assert.equal(t0.comments.length, 2);
  assert.equal(t0.anchor, 0);
  assert.equal(p.marks[0].anchoredThread, 0);
  assert.equal(p.threads[1].comments.length, 1);
  assert.equal(p.threads[1].anchor, null);
  assert.equal(p.threads[2].comments.length, 1);
  assert.equal(threadOf(p, p.marks[2])?.id, 0);
});

test("resolved status", () => {
  const p = parse('{status="resolved" author="A">>done<<}{>>ok<<}');
  assert.equal(p.threads[0].resolved, true);
  assert.equal(p.threads[0].comments.length, 2);
});

test("rationale thread on a change", () => {
  const p = parse("{++new++}{>>because<<}");
  assert.equal(p.threads[0].anchor, 0);
  assert.equal(p.marks[0].type, "addition");
});

test("skips code regions", () => {
  const doc = "---\ntitle: {++x++}\n---\n`{++inline++}` {++real++}\n```\n{--block--}\n```\n{--after--}";
  const regions = codeRegions(doc);
  assert.equal(regions.length, 3);
  const p = parse(doc);
  assert.deepEqual(p.marks.map((m) => m.text), ["real", "after"]);
});

test("substitution without separator is not a mark", () => {
  const p = parse("{~~nothing here~~}");
  assert.equal(p.marks.length, 0);
});

test("unclosed marks are ignored and scanning continues", () => {
  const p = parse("{++open {--closed--}");
  assert.equal(p.marks.length, 1);
  assert.equal(p.marks[0].type, "deletion");
});

test("multiline content and line numbers", () => {
  const doc = "line0\n{++a\nb++}\n{--c--}";
  const p = parse(doc);
  assert.equal(p.marks[0].line, 1);
  assert.equal(p.marks[0].text, "a\nb");
  assert.equal(p.marks[1].line, 3);
});

test("markAt and counts", () => {
  const doc = "x {++a++} y {>>c<<}";
  const p = parse(doc);
  assert.equal(markAt(p, 3)?.type, "addition");
  assert.equal(markAt(p, 0), null);
  const c = counts(p);
  assert.equal(c.changes, 1);
  assert.equal(c.openThreads, 1);
});

test("comment text decoding", () => {
  const p = parse("{>>line one\\nline two \\\\ slash<<}");
  assert.equal(p.marks[0].text, "line one\\nline two \\\\ slash");
});
