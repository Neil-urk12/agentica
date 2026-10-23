/**
 * User-defined groups of canvas objects. A group is the set of nodes that
 * share a `groupId`; it has no geometry of its own and ends once fewer than
 * two nodes share the ID.
 */
type Placed = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
};

export interface GroupBox {
  groupId: string;
  memberIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Padding drawn around a group's members, in canvas units. */
export const GROUP_PADDING = 12;

/** Members per group, for groups that still have at least two members. */
export function groupMembers(nodes: Placed[]): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const node of nodes)
    if (node.groupId)
      members.set(node.groupId, [
        ...(members.get(node.groupId) ?? []),
        node.id,
      ]);
  for (const [groupId, ids] of members)
    if (ids.length < 2) members.delete(groupId);
  return members;
}

/** Selecting any member of a group selects the whole group. */
export function expandToGroups(selected: string[], nodes: Placed[]): string[] {
  const members = groupMembers(nodes);
  const result = new Set(selected);
  for (const node of nodes)
    if (result.has(node.id) && node.groupId)
      for (const id of members.get(node.groupId) ?? []) result.add(id);
  return [...result];
}

/** The outline drawn around each group. */
export function groupBoxes(nodes: Placed[]): GroupBox[] {
  const members = groupMembers(nodes);
  return [...members].map(([groupId, ids]) => {
    const placed = nodes.filter((node) => ids.includes(node.id));
    const left = Math.min(...placed.map((node) => node.x));
    const top = Math.min(...placed.map((node) => node.y));
    const right = Math.max(...placed.map((node) => node.x + node.width));
    const bottom = Math.max(...placed.map((node) => node.y + node.height));
    return {
      groupId,
      memberIds: ids,
      x: left - GROUP_PADDING,
      y: top - GROUP_PADDING,
      width: right - left + 2 * GROUP_PADDING,
      height: bottom - top + 2 * GROUP_PADDING,
    };
  });
}

/**
 * Keep groups together while the canvas reports positions. When some members
 * of a group moved and others did not (a member was dragged on its own), the
 * unmoved members follow the first moved member's offset. Members that moved
 * together keep their reported positions.
 */
export function followGroups(
  reported: Map<string, { x: number; y: number }>,
  nodes: Placed[],
): Map<string, { x: number; y: number }> {
  const result = new Map(reported);
  for (const ids of groupMembers(nodes).values()) {
    const placed = nodes.filter((node) => ids.includes(node.id));
    const moved = placed.find((node) => {
      const position = reported.get(node.id);
      return position && (position.x !== node.x || position.y !== node.y);
    });
    if (!moved) continue;
    const target = reported.get(moved.id)!;
    const dx = target.x - moved.x;
    const dy = target.y - moved.y;
    for (const node of placed) {
      const position = reported.get(node.id);
      if (position && (position.x !== node.x || position.y !== node.y))
        continue;
      result.set(node.id, { x: node.x + dx, y: node.y + dy });
    }
  }
  return result;
}
