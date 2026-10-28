import { test } from "node:test";
import assert from "node:assert/strict";
import { authorColor, sameAuthor } from "../src/authors";
import { parse, isChange } from "../src/parser";
import { applyEdits, decideAll } from "../src/operations";

test("sameAuthor ignores case and whitespace, never matches empty", () => {
  assert.ok(sameAuthor("Chris", " chris "));
  assert.ok(!sameAuthor("", ""));
  assert.ok(!sameAuthor(null, "Chris"));
});

test("authorColor uses overrides case-insensitively, else a stable hue", () => {
  assert.equal(authorColor("Dana", { dana: "#123456" }), "#123456");
  assert.equal(authorColor("Dana"), authorColor(" Dana "));
  assert.notEqual(authorColor("Dana"), authorColor("Chris"));
  assert.equal(authorColor(null), null);
});

test("decideAll filtered by author", () => {
  const doc = '{author="A" ++a++} {author="b" --b--} {++c++}';
  const p = parse(doc);
  const byB = decideAll(doc, p, "accept", (m) => isChange(m) && sameAuthor(m.meta.author, "B"));
  assert.equal(applyEdits(doc, byB), '{author="A" ++a++} {++c++}');
});
