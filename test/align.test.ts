import { test } from "node:test";
import assert from "node:assert/strict";
import { alignText, sourceStart, sourceEnd } from "../src/align";

test("identity", () => {
  const m = alignText("abc", "abc");
  assert.deepEqual(Array.from(m), [0, 1, 2, 3]);
});

test("syntax removed", () => {
  const src = "a **b** c";
  const out = "a b c";
  const m = alignText(src, out);
  assert.equal(m[src.indexOf("b")], out.indexOf("b"));
  assert.equal(m[src.length], out.length);
  assert.equal(m[src.indexOf("c")], out.indexOf("c"));
});

test("criticmarkup substitution with ~~ consumed", () => {
  const src = "x {~~old~>new~~} y";
  const out = "x {old~>new} y";
  const m = alignText(src, out);
  assert.equal(m[src.indexOf("old")], out.indexOf("old"));
  assert.equal(m[src.indexOf("new")], out.indexOf("new"));
  assert.equal(m[src.indexOf("}")], out.indexOf("}"));
});

test("selection mapping back to source", () => {
  const src = "say **hello** world";
  const out = "say hello world";
  const m = alignText(src, out);
  const rs = out.indexOf("hello");
  const re = rs + 5;
  assert.equal(src.slice(sourceStart(m, rs), sourceEnd(m, re)), "hello");
  assert.equal(src.slice(sourceStart(m, 0), sourceEnd(m, 3)), "say");
});

test("inserted rendered text does not break mapping", () => {
  const src = "a b";
  const out = "a XX b";
  const m = alignText(src, out);
  assert.equal(m[2], 5);
});

test("long input falls back without throwing", () => {
  const src = "x".repeat(4000) + "{++y++}" + "z".repeat(4000);
  const out = "q".repeat(3000) + "y" + "z".repeat(4000);
  const m = alignText(src, out);
  assert.equal(m.length, src.length + 1);
  assert.equal(m[src.length], out.length);
});
