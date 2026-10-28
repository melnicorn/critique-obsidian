import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/parser";
import { applyEdits, decideMark, decideAll, decideInRange, deleteComment, deleteThread, setThreadStatus, replyToThread, editComment, insertMark, plainText, stripMetadata, rebase } from "../src/operations";
import { formatTimestamp, parseTimestamp, relativeTime } from "../src/time";
import { decodeCommentText, encodeCommentText } from "../src/syntax";

function run(doc: string, f: (p: ReturnType<typeof parse>) => ReturnType<typeof decideMark>): string {
  const p = parse(doc);
  return applyEdits(doc, f(p));
}

test("accept and reject each change type", () => {
  assert.equal(run("a {++b++} c", (p) => decideMark("a {++b++} c", p, p.marks[0], "accept")), "a b c");
  assert.equal(run("a {++b++} c", (p) => decideMark("a {++b++} c", p, p.marks[0], "reject")), "a c");
  assert.equal(run("a {--b--} c", (p) => decideMark("a {--b--} c", p, p.marks[0], "accept")), "a c");
  assert.equal(run("a {--b--} c", (p) => decideMark("a {--b--} c", p, p.marks[0], "reject")), "a b c");
  assert.equal(run("a {~~b~>B~~} c", (p) => decideMark("a {~~b~>B~~} c", p, p.marks[0], "accept")), "a B c");
  assert.equal(run("a {~~b~>B~~} c", (p) => decideMark("a {~~b~>B~~} c", p, p.marks[0], "reject")), "a b c");
  assert.equal(run("a {==b==} c", (p) => decideMark("a {==b==} c", p, p.marks[0], "accept")), "a b c");
});

test("accepting a change removes its rationale thread", () => {
  const doc = 'a {author="x"++b++}{>>why<<} {>>reply<<} c';
  assert.equal(run(doc, (p) => decideMark(doc, p, p.marks[0], "accept")), "a b c");
});

test("rejecting a whole-line deletion removes the line", () => {
  const doc = "one\n{--two--}\nthree";
  assert.equal(run(doc, (p) => decideMark(doc, p, p.marks[0], "accept")), "one\nthree");
});

test("decideAll leaves standalone comments and highlights", () => {
  const doc = "{++a++} x {>>keep<<} {==h==} {--b--}";
  assert.equal(run(doc, (p) => decideAll(doc, p, "accept")), "a x {>>keep<<} {==h==}");
});

test("delete comment within thread, root, and last", () => {
  const doc = "x {==h==}{>>r<<}{>>a<<}{>>b<<} y";
  assert.equal(run(doc, (p) => deleteComment(doc, p, p.marks[2])), "x {==h==}{>>r<<}{>>b<<} y");
  assert.equal(run(doc, (p) => deleteComment(doc, p, p.marks[1])), "x {==h==}{>>a<<}{>>b<<} y");
  const single = "x {==h==}{>>r<<} y";
  assert.equal(run(single, (p) => deleteComment(single, p, p.marks[1])), "x h y");
  const change = "x {++h++}{>>r<<} y";
  assert.equal(run(change, (p) => deleteComment(change, p, p.marks[1])), "x {++h++} y");
  const solo = "x {>>r<<} y";
  assert.equal(run(solo, (p) => deleteComment(solo, p, p.marks[0])), "x y");
});

test("deleting a resolved root moves status to the new root", () => {
  const doc = '{status="resolved">>r<<}{author="B">>a<<}';
  assert.equal(run(doc, (p) => deleteComment(doc, p, p.marks[0])), '{author="B" status="resolved" >>a<<}');
});

test("delete thread unwraps highlight", () => {
  const doc = "x {==h==}{>>r<<}{>>a<<} y";
  assert.equal(run(doc, (p) => deleteThread(doc, p, p.threads[0])), "x h y");
});

test("resolve and reopen", () => {
  const doc = 'x {author="A" date="d" >>r<<}{>>a<<}';
  const resolved = run(doc, (p) => setThreadStatus(doc, p, p.threads[0], "resolved"));
  assert.equal(resolved, 'x {author="A" date="d" status="resolved" >>r<<}{>>a<<}');
  assert.equal(run(resolved, (p) => setThreadStatus(resolved, p, p.threads[0], null)), doc);
});

test("reply appends with attrs", () => {
  const doc = "x {>>r<<} y";
  assert.equal(run(doc, (p) => replyToThread(doc, p, p.threads[0], "hi\nthere", { author: "B", date: "t" })), 'x {>>r<<}{author="B" date="t" >>hi\\nthere<<} y');
});

test("edit comment with edited stamp", () => {
  const doc = '{author="A" >>old<<}';
  assert.equal(run(doc, (p) => editComment(doc, p.marks[0], "new", "e1")), '{author="A" edited="e1" >>new<<}');
});

test("insert marks around a selection", () => {
  const doc = "hello big world";
  const p = parse(doc);
  const attrs = { author: "C", date: "t" };
  const add = insertMark(doc, p, 6, 9, "addition", { attrs });
  assert.ok(!("error" in add));
  assert.equal(applyEdits(doc, add.edits), 'hello {author="C" date="t" ++big++} world');
  const del = insertMark(doc, p, 5, 10, "deletion", { attrs: {} });
  assert.ok(!("error" in del));
  assert.equal(applyEdits(doc, del.edits), "hello {--big--} world"); // whitespace trimmed out of the mark
  const sub = insertMark(doc, p, 6, 9, "substitution", { newText: "small" });
  assert.ok(!("error" in sub));
  assert.equal(applyEdits(doc, sub.edits), "hello {~~big~>small~~} world");
  const cmt = insertMark(doc, p, 6, 9, "comment", { comment: "why?" });
  assert.ok(!("error" in cmt));
  assert.equal(applyEdits(doc, cmt.edits), "hello {==big==}{>>why?<<} world");
  const solo = insertMark(doc, p, 5, 5, "comment", { comment: "note" });
  assert.ok(!("error" in solo));
  assert.equal(applyEdits(doc, solo.edits), "hello{>>note<<} big world");
});

test("comment on an existing mark attaches or replies", () => {
  const doc = "a {++b++} c {==d==}{>>r<<} e";
  const p = parse(doc);
  const r1 = insertMark(doc, p, 2, 9, "comment", { comment: "x" });
  assert.ok(!("error" in r1));
  assert.equal(applyEdits(doc, r1.edits), "a {++b++}{>>x<<} c {==d==}{>>r<<} e");
  const r2 = insertMark(doc, p, 14, 16, "comment", { comment: "y" });
  assert.ok(!("error" in r2));
  assert.equal(applyEdits(doc, r2.edits), "a {++b++} c {==d==}{>>r<<}{>>y<<} e");
});

test("crossing selections are refused", () => {
  const doc = "a {++bc++} d";
  const p = parse(doc);
  const r = insertMark(doc, p, 0, 5, "highlight");
  assert.ok("error" in r);
});

test("plainText and stripMetadata", () => {
  const doc = '{author="A" ++new++}{>>why<<} and {--old--} {==h==}{>>c<<} {>>solo<<} end';
  const p = parse(doc);
  assert.equal(plainText(doc, p, "accept"), "new and h end");
  assert.equal(plainText(doc, p, "reject"), "and old h end");
  assert.equal(stripMetadata('{author="A" date="d" ++x++}{author="B" >>hi<<}', parse('{author="A" date="d" ++x++}{author="B" >>hi<<}')), "{++x++}{>>B: hi<<}");
});

test("rebase relocates a unique moved range", () => {
  const doc = "aaa {++b++} ccc";
  const p = parse(doc);
  const edits = decideMark(doc, p, p.marks[0], "accept");
  const moved = "XX " + doc;
  const r = rebase(moved, edits[0]);
  assert.ok(r);
  assert.equal(applyEdits(moved, [r]), "XX aaa b ccc");
  assert.equal(rebase("aaa {++b++} {++b++}", { ...edits[0], from: 100, to: 107 }), null);
});

test("timestamps", () => {
  const d = new Date(2026, 9, 28, 14, 5, 9);
  const s = formatTimestamp(d, "minutes");
  assert.match(s, /^2026-10-28T14:05[+-]\d{2}:\d{2}$/);
  assert.equal(parseTimestamp(s)?.getTime(), new Date(2026, 9, 28, 14, 5).getTime());
  assert.equal(parseTimestamp("2026-10-28")?.getDate(), 28);
  assert.equal(parseTimestamp("2026-10-28T21:05:00Z")?.getTime(), Date.UTC(2026, 9, 28, 21, 5));
  assert.equal(relativeTime(new Date(d.getTime() - 3 * 3600_000), d), "3h");
});

test("comment encoding round trip", () => {
  const t = "a\\b\nc";
  assert.equal(decodeCommentText(encodeCommentText(t)), t);
});

test("decideInRange only touches changes overlapping the selection", () => {
  const doc = "{++a++} one {--b--}{>>why<<} two {==h==} {++c++} three {++d++}";
  const p = parse(doc);
  const from = doc.indexOf("one");
  const to = doc.indexOf("three");
  assert.equal(applyEdits(doc, decideInRange(doc, p, from, to, "accept")), "{++a++} one two {==h==} c three {++d++}");
  assert.equal(applyEdits(doc, decideInRange(doc, p, from, to, "reject")), "{++a++} one b two {==h==} three {++d++}");
  // A selection that only partly covers a mark still includes it.
  const partial = doc.indexOf("++d") + 1;
  assert.equal(applyEdits(doc, decideInRange(doc, p, partial, doc.length, "accept")), "{++a++} one {--b--}{>>why<<} two {==h==} {++c++} three d");
  assert.equal(decideInRange(doc, p, from, from + 2, "accept").length, 0);
});
