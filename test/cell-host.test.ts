import { test } from "node:test";
import assert from "node:assert/strict";
import { cellStart } from "../src/editor/cell-host";

test("cell start in a padded row", () => {
  const row = "| D1  | **Esse cillum** dolore.      | Accusantium.   |";
  assert.equal(row.slice(cellStart(row, 1, "**Esse cillum** dolore.")!).startsWith("**Esse cillum**"), true);
  assert.equal(cellStart(row, 0, "D1"), 2);
  assert.equal(row.slice(cellStart(row, 2, "Accusantium.")!, cellStart(row, 2, "Accusantium.")! + 12), "Accusantium.");
});

test("escaped pipes and rows without outer pipes", () => {
  const row = "a \\| b | c";
  assert.equal(cellStart(row, 0, "a \\| b"), 0);
  assert.equal(cellStart(row, 1, "c"), 9);
});

test("text not in its column is refused", () => {
  assert.equal(cellStart("| a | b |", 0, "b"), null);
  assert.equal(cellStart("| a | b |", 5, "a"), null);
});
