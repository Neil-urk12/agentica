import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GROUP_PADDING,
  expandToGroups,
  followGroups,
  groupBoxes,
  groupMembers,
} from "../apps/desktop/src/lib/node-groups.ts";

const node = (id, x, y, groupId) => ({
  id,
  x,
  y,
  width: 100,
  height: 50,
  ...(groupId ? { groupId } : {}),
});
const nodes = [
  node("a", 0, 0, "g1"),
  node("b", 200, 100, "g1"),
  node("c", 500, 0),
  node("d", 800, 0, "lonely"),
];

test("a group needs two members, and selecting one selects all", () => {
  assert.deepEqual([...groupMembers(nodes)], [["g1", ["a", "b"]]]);
  assert.deepEqual(expandToGroups(["a"], nodes).sort(), ["a", "b"]);
  assert.deepEqual(expandToGroups(["c", "d"], nodes).sort(), ["c", "d"]);
  assert.deepEqual(expandToGroups([], nodes), []);
});

test("outlines wrap every member with padding", () => {
  assert.deepEqual(groupBoxes(nodes), [
    {
      groupId: "g1",
      memberIds: ["a", "b"],
      x: -GROUP_PADDING,
      y: -GROUP_PADDING,
      width: 300 + 2 * GROUP_PADDING,
      height: 150 + 2 * GROUP_PADDING,
    },
  ]);
});

test("a member dragged alone brings its group; moving together is kept", () => {
  const reported = (entries) => new Map(Object.entries(entries));
  const alone = followGroups(
    reported({
      a: { x: 30, y: -10 },
      b: { x: 200, y: 100 },
      c: { x: 500, y: 0 },
    }),
    nodes,
  );
  assert.deepEqual(alone.get("b"), { x: 230, y: 90 });
  assert.deepEqual(alone.get("c"), { x: 500, y: 0 }, "others stay put");
  const together = followGroups(
    reported({ a: { x: 10, y: 10 }, b: { x: 210, y: 110 } }),
    nodes,
  );
  assert.deepEqual(together.get("b"), { x: 210, y: 110 });
  const still = followGroups(
    reported({ a: { x: 0, y: 0 }, b: { x: 200, y: 100 } }),
    nodes,
  );
  assert.deepEqual(still.get("b"), { x: 200, y: 100 });
});
