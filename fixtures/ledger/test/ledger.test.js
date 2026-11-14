import { test } from "node:test";
import assert from "node:assert/strict";
import { cartTotal } from "../src/cart.js";
import { formatMoney } from "../src/format.js";
import { splitEvenly } from "../src/split.js";

test("cartTotal sums items and adds tax", () => {
  const items = [{ pence: 500, qty: 2 }, { pence: 250, qty: 1 }];
  assert.equal(cartTotal(items), 1500);
});

test("cartTotal takes the discount before tax", () => {
  const items = [{ pence: 1000, qty: 2 }];
  assert.equal(cartTotal(items, 10), 2160);
});

test("formatMoney prints pounds with two decimals", () => {
  assert.equal(formatMoney(1250), "$12.50");
});

test("splitEvenly returns one share per person", () => {
  assert.equal(splitEvenly(9, 3).length, 3);
});

test("splitEvenly gives the remainder to the first shares", () => {
  assert.deepEqual(splitEvenly(10, 3), [4, 3, 3]);
});
