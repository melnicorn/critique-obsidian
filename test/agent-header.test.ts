import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgentHeader, hasAgentHeader, insertAgentHeader, removeAgentHeader, stripAgentHeader, afterFrontmatter } from "../src/agent-header";
import { applyEdits } from "../src/operations";
import { parse } from "../src/parser";

const URL = "https://example.com/SKILL.md";

test("insert at top of a plain note and remove again", () => {
  const doc = "# Title\n\nBody {++x++}";
  const e = insertAgentHeader(doc, URL)!;
  const out = applyEdits(doc, [e]);
  assert.ok(out.startsWith(buildAgentHeader(URL) + "\n\n# Title"));
  assert.ok(hasAgentHeader(out));
  assert.equal(insertAgentHeader(out, URL), null);
  assert.equal(stripAgentHeader(out), doc);
  assert.equal(applyEdits(out, [removeAgentHeader(out)!]), doc);
});

test("insert after frontmatter", () => {
  const doc = "---\ntitle: x\n---\n\n# Title\n";
  assert.equal(afterFrontmatter(doc), "---\ntitle: x\n---\n".length);
  const out = applyEdits(doc, [insertAgentHeader(doc, URL)!]);
  assert.equal(out, "---\ntitle: x\n---\n" + buildAgentHeader(URL) + "\n\n# Title\n");
  assert.equal(stripAgentHeader(out), doc);
  const noBlank = "---\ntitle: x\n---\n# Title\n";
  const out2 = applyEdits(noBlank, [insertAgentHeader(noBlank, URL)!]);
  assert.equal(stripAgentHeader(out2), "---\ntitle: x\n---\n\n# Title\n");
});

test("header never parses as marks and other comments are skipped", () => {
  const doc = buildAgentHeader(URL) + "\n\n<!-- {++not++} -->\ntext {++yes++}";
  const p = parse(doc);
  assert.deepEqual(p.marks.map((m) => m.text), ["yes"]);
});

test("empty note", () => {
  const out = applyEdits("", [insertAgentHeader("", URL)!]);
  assert.equal(out, buildAgentHeader(URL) + "\n");
  assert.equal(stripAgentHeader(out), "");
});
