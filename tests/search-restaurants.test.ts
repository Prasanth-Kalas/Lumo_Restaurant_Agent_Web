import assert from "node:assert/strict";

import { searchRestaurants } from "../lib/opentable-stub";

const italianInNewYork = searchRestaurants({
  city: "New York",
  query: "Italian",
  party_size: 2,
  limit: 2,
});

assert.equal(italianInNewYork.length, 2);
assert.deepEqual(
  italianInNewYork.map((restaurant) => restaurant.name),
  ["Misi", "Via Carota"],
);

const cappedAtSix = searchRestaurants({
  city: "New York",
  party_size: 2,
  limit: 99,
});

assert.ok(cappedAtSix.length <= 6);

console.log("restaurant search limit regression passed");
