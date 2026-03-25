import type { Node, Edge } from "@rome/shared";
import { buildClusterMaps } from "../constants";

export function isGoalNode(node: Node): boolean {
  const name = node.name.toLowerCase();
  return name.includes("goal") || name.includes("mission");
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

  // Group by workstream
  const workstreams = new Map<string, Node[]>();
  for (const n of nodes) {
    if (goalNode && n.id === goalNode.id) continue;
    const ws = n.workstream ?? "Other";
    const group = workstreams.get(ws) ?? [];
    group.push(n);
    workstreams.set(ws, group);
  }

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
      const childRadius = Math.max(50, children.length * 14);
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

  return positions;
}
