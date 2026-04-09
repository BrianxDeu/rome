import type { Node, Edge } from "@rome/shared";
import { buildClusterMaps } from "../constants";

// A "goal node" is a top-level hub — no parent, no workstream, and named with the OBJ prefix.
// Previously this used a broad substring match ("goal" | "mission") which incorrectly matched
// task nodes whose names happened to contain those words (e.g. "Funding pursuit... JIATF-401").
export function isGoalNode(node: Node): boolean {
  // Must be a top-level node (no workstream field set)
  if (node.workstream) return false;
  // Must match OBJ prefix convention: "OBJ1:", "OBJ2:", etc.
  return /^OBJ\d+:/i.test(node.name.trim());
}

export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  childrenMap: Map<string, string[]>,
  parentMap: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  const goalNode = nodes.find(isGoalNode);
  if (goalNode) {
    positions.set(goalNode.id, { x: 0, y: 0 });
  }

  // Group by workstream. Nodes with null workstream go into "~orphans" — a special bucket
  // that gets placed far from center (bottom) to avoid colliding with the goal node at (0,0).
  const workstreams = new Map<string, Node[]>();
  for (const n of nodes) {
    if (goalNode && n.id === goalNode.id) continue;
    const ws = n.workstream ?? "~orphans";
    const group = workstreams.get(ws) ?? [];
    group.push(n);
    workstreams.set(ws, group);
  }

  // Separate orphans from real workstreams so we can position them distinctly
  const orphanNodes = workstreams.get("~orphans") ?? [];
  workstreams.delete("~orphans");

  const wsEntries = [...workstreams.entries()];
  const wsCount = wsEntries.length;
  const baseRadius = Math.max(120, wsCount * 35);

  wsEntries.forEach(([, wsNodes], wsIndex) => {
    const angle = (wsIndex / wsCount) * Math.PI * 2 - Math.PI / 2;
    const wsCenter = {
      x: Math.cos(angle) * baseRadius,
      y: Math.sin(angle) * baseRadius,
    };

    const clusterParents = wsNodes.filter(
      (n) => childrenMap.has(n.id) && (childrenMap.get(n.id)?.length ?? 0) > 0,
    );
    const ungroupedLeaves = wsNodes
      .filter(
        (n) => !childrenMap.has(n.id) || (childrenMap.get(n.id)?.length ?? 0) === 0,
      )
      .filter((n) => !parentMap.has(n.id));

    const cols = Math.max(2, Math.ceil(Math.sqrt(clusterParents.length)));
    clusterParents.forEach((cluster, ci) => {
      const row = Math.floor(ci / cols);
      const col = ci % cols;
      const cx = wsCenter.x + (col - (cols - 1) / 2) * 100;
      const cy =
        wsCenter.y +
        (row - Math.floor(clusterParents.length / cols) / 2) * 80;
      positions.set(cluster.id, { x: cx, y: cy });

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

    const leafRadius = clusterParents.length > 0 ? 70 : 50;
    ungroupedLeaves.forEach((leaf, li) => {
      const leafAngle =
        (li / Math.max(ungroupedLeaves.length, 1)) * Math.PI * 2;
      positions.set(leaf.id, {
        x: wsCenter.x + Math.cos(leafAngle) * leafRadius,
        y: wsCenter.y + Math.sin(leafAngle) * leafRadius,
      });
    });
  });

  // Place orphan nodes (null workstream) in a row far below center, clearly separated
  const orphanBaseY = baseRadius + 200;
  orphanNodes.forEach((n, i) => {
    const spacing = 120;
    const totalW = (orphanNodes.length - 1) * spacing;
    positions.set(n.id, {
      x: i * spacing - totalW / 2,
      y: orphanBaseY,
    });
  });

  return positions;
}
