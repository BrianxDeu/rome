import type { Node, Edge } from "@rome/shared";
import { buildClusterMaps } from "../constants";

// Find the "hub" node — the top-level structural node with the most descendants.
// This is the natural center of the graph (the most active/connected workstream).
export function findHubNode(
  nodes: Node[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Node | null {
  // Count all descendants (recursive) for each top-level node
  function countDescendants(nodeId: string): number {
    const kids = childrenMap.get(nodeId) ?? [];
    let count = kids.length;
    for (const kid of kids) count += countDescendants(kid);
    return count;
  }

  // Top-level structural nodes: no parent, has children
  const topLevel = nodes.filter(
    (n) => !parentMap.has(n.id) && (childrenMap.get(n.id)?.length ?? 0) > 0,
  );

  if (topLevel.length === 0) return null;

  let best = topLevel[0];
  let bestCount = countDescendants(best.id);
  for (let i = 1; i < topLevel.length; i++) {
    const c = countDescendants(topLevel[i].id);
    if (c > bestCount) {
      best = topLevel[i];
      bestCount = c;
    }
  }
  return best;
}

// Legacy compat — used by other views to identify OBJ-prefix nodes
export function isGoalNode(node: Node): boolean {
  if (node.workstream) return false;
  return /^OBJ\d+:/i.test(node.name.trim());
}

export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const hubNode = findHubNode(nodes, childrenMap, parentMap);
  if (hubNode) {
    positions.set(hubNode.id, { x: 0, y: 0 });
  }

  // Build workstream groups: match null-workstream headers to their children's workstream
  // A header's name = its children's workstream field value
  const wsGroups = new Map<string, { header: Node | null; members: Node[] }>();
  const orphans: Node[] = [];

  for (const n of nodes) {
    if (hubNode && n.id === hubNode.id) continue;

    if (n.workstream) {
      // Regular workstream member
      const group = wsGroups.get(n.workstream) ?? { header: null, members: [] };
      group.members.push(n);
      wsGroups.set(n.workstream, group);
    } else {
      // Null workstream + no parent = workstream header (even if empty, no children yet)
      if (!parentMap.has(n.id)) {
        const group = wsGroups.get(n.name) ?? { header: null, members: [] };
        group.header = n;
        wsGroups.set(n.name, group);
      } else {
        orphans.push(n);
      }
    }
  }

  // Position workstream groups radially around hub
  const wsEntries = [...wsGroups.entries()];
  const wsCount = wsEntries.length;
  const baseRadius = Math.max(200, wsCount * 50);

  wsEntries.forEach(([, group], wsIndex) => {
    const angle = (wsIndex / wsCount) * Math.PI * 2 - Math.PI / 2;
    const wsCenter = {
      x: Math.cos(angle) * baseRadius,
      y: Math.sin(angle) * baseRadius,
    };

    // Position header at workstream center
    if (group.header) {
      positions.set(group.header.id, wsCenter);
    }

    // Separate cluster parents (node groups with children) from leaf members
    const clusterParents = group.members.filter(
      (n) =>
        (childrenMap.get(n.id)?.length ?? 0) > 0 && !parentMap.has(n.id),
    );
    const leafMembers = group.members.filter(
      (n) =>
        ((childrenMap.get(n.id)?.length ?? 0) === 0) && !parentMap.has(n.id),
    );

    // Position cluster parents in a grid below header
    const cols = Math.max(2, Math.ceil(Math.sqrt(clusterParents.length)));
    clusterParents.forEach((cluster, ci) => {
      const row = Math.floor(ci / cols);
      const col = ci % cols;
      const cx = wsCenter.x + (col - (cols - 1) / 2) * 100;
      const cy = wsCenter.y + 50 + row * 80;
      positions.set(cluster.id, { x: cx, y: cy });

      // Position children in a circle around their cluster parent
      const children = childrenMap.get(cluster.id) ?? [];
      const childRadius = Math.max(30, children.length * 12);
      children.forEach((childId, chi) => {
        const childAngle =
          (chi / Math.max(children.length, 1)) * Math.PI * 2 - Math.PI / 2;
        positions.set(childId, {
          x: cx + Math.cos(childAngle) * childRadius,
          y: cy + Math.sin(childAngle) * childRadius,
        });
      });
    });

    // Position ungrouped leaves in a circle near the header
    if (leafMembers.length > 0) {
      const leafRadius = Math.max(40, leafMembers.length * 10);
      const leafOffsetY = clusterParents.length > 0
        ? 50 + Math.ceil(clusterParents.length / cols) * 80
        : 50;
      leafMembers.forEach((leaf, li) => {
        const leafAngle =
          (li / Math.max(leafMembers.length, 1)) * Math.PI * 2 - Math.PI / 2;
        positions.set(leaf.id, {
          x: wsCenter.x + Math.cos(leafAngle) * leafRadius,
          y: wsCenter.y + leafOffsetY + Math.sin(leafAngle) * leafRadius,
        });
      });
    }
  });

  // Orphans: no workstream, no children — row below everything
  if (orphans.length > 0) {
    const orphanBaseY = baseRadius + 200;
    const spacing = 120;
    const totalW = (orphans.length - 1) * spacing;
    orphans.forEach((n, i) => {
      positions.set(n.id, {
        x: i * spacing - totalW / 2,
        y: orphanBaseY,
      });
    });
  }

  return positions;
}
