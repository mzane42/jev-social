import assert from "node:assert/strict";
import test from "node:test";

import { findEvidenceItems } from "../public/evidence-items.js";

test("findEvidenceItems skips empty aliases before later evidence", () => {
  const post = { id: "post-1", title: "Observed post" };

  assert.deepEqual(findEvidenceItems({ items: [], results: [post] }), [post]);
});

test("findEvidenceItems skips invalid aliases before nested evidence", () => {
  const card = { id: "card-1", entity: { title: "Nested card", views: 42 } };

  assert.deepEqual(
    findEvidenceItems({ items: [null, "not evidence"], data: { cards: [card] } }),
    [{ id: "card-1", entity: card.entity, title: "Nested card", views: 42 }],
  );
});

test("findEvidenceItems preserves the first non-empty evidence container", () => {
  const item = { id: "item-1" };

  assert.deepEqual(
    findEvidenceItems({ items: [item], results: [{ id: "result-1" }] }),
    [item],
  );
  assert.deepEqual(findEvidenceItems(null), []);
});

test("findEvidenceItems preserves direct array records without flattening wrappers", () => {
  const wrapper = { locator: "post-1", entity: { title: "Nested title" } };

  assert.deepEqual(findEvidenceItems([wrapper]), [wrapper]);
});
