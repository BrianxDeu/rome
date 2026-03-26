import { useRef, useCallback, useState } from "react";
import type { Node, Edge } from "@rome/shared";
import { buildClusterMaps } from "../constants";
import { computeLayout } from "../utils/graphLayout";

export function useStaticLayout(
  storeNodes: Node[],
  storeEdges: Edge[],
) {
  const [, setTick] = useState(0);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const { parentMap, childrenMap } = buildClusterMaps(storeEdges);
  const staticPositions = computeLayout(
    storeNodes,
    storeEdges,
    childrenMap,
    parentMap,
  );

  // Build positions: dragged (posRef) > store-saved > computeLayout
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of storeNodes) {
    const dragged = posRef.current.get(n.id);
    const stored = n.x != null && n.y != null ? { x: n.x, y: n.y } : null;
    const sp = staticPositions.get(n.id) ?? { x: 0, y: 0 };
    positions.set(n.id, dragged ?? stored ?? sp);
  }

  const onDragMove = useCallback(
    (nodeId: string, graphX: number, graphY: number) => {
      const pos = new Map(posRef.current);
      pos.set(nodeId, { x: graphX, y: graphY });
      posRef.current = pos;
      setTick((t) => t + 1);
    },
    [],
  );

  return { positions, onDragMove };
}
