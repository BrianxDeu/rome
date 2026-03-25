import { useRef, useEffect, useCallback, useState } from "react";
import {
  forceSimulation,
  forceCenter,
  forceManyBody,
  forceLink,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { Node, Edge } from "@rome/shared";
import { buildClusterMaps } from "../constants";
import { computeLayout, isGoalNode } from "../utils/graphLayout";

export interface SimNode extends SimulationNodeDatum {
  id: string;
  workstream: string | null;
  isGoal: boolean;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edgeId: string;
  type: string;
}

export type LayoutMode = "physics" | "static";

export interface ForceSimulationResult {
  positions: Map<string, { x: number; y: number }>;
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
  onDragStart: (nodeId: string, clientX: number, clientY: number) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: () => string | null;
  settled: boolean;
}

function clusterGravity() {
  let nodes: SimNode[] = [];

  function force(alpha: number) {
    const centroids = new Map<
      string,
      { x: number; y: number; count: number }
    >();
    for (const node of nodes) {
      if (node.isGoal) continue;
      const ws = node.workstream ?? "Other";
      const c = centroids.get(ws) ?? { x: 0, y: 0, count: 0 };
      c.x += node.x ?? 0;
      c.y += node.y ?? 0;
      c.count++;
      centroids.set(ws, c);
    }
    for (const node of nodes) {
      if (node.isGoal) continue;
      const ws = node.workstream ?? "Other";
      const c = centroids.get(ws);
      if (!c || c.count === 0) continue;
      const cx = c.x / c.count;
      const cy = c.y / c.count;
      node.vx = (node.vx ?? 0) + (cx - (node.x ?? 0)) * alpha * 0.03;
      node.vy = (node.vy ?? 0) + (cy - (node.y ?? 0)) * alpha * 0.03;
    }
  }

  force.initialize = (n: SimNode[]) => {
    nodes = n;
  };
  return force;
}

const CLAMP_BOUND = 2000;

export function useForceSimulation(
  storeNodes: Node[],
  storeEdges: Edge[],
): ForceSimulationResult {
  const [mode, setModeState] = useState<LayoutMode>("physics");
  const [settled, setSettled] = useState(false);
  const [, setTick] = useState(0); // force re-render on RAF

  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const modeRef = useRef<LayoutMode>("physics");
  const rafRef = useRef<number>(0);
  const dragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const prevNodeIdsRef = useRef<string>("");
  const prevEdgeIdsRef = useRef<string>("");

  // Build static layout for warm-start and static mode
  const { parentMap, childrenMap } = buildClusterMaps(storeEdges);
  const staticPositions = computeLayout(
    storeNodes,
    storeEdges,
    childrenMap,
    parentMap,
  );

  // Build or update simulation when nodes/edges change
  useEffect(() => {
    const nodeIds = storeNodes
      .map((n) => n.id)
      .sort()
      .join(",");
    const edgeIds = storeEdges
      .map((e) => e.id)
      .sort()
      .join(",");

    const topologyChanged =
      nodeIds !== prevNodeIdsRef.current ||
      edgeIds !== prevEdgeIdsRef.current;

    if (!topologyChanged && simRef.current) return;

    prevNodeIdsRef.current = nodeIds;
    prevEdgeIdsRef.current = edgeIds;

    // Stop previous simulation
    if (simRef.current) {
      simRef.current.stop();
      cancelAnimationFrame(rafRef.current);
    }

    if (storeNodes.length === 0) {
      posRef.current = new Map();
      simRef.current = null;
      setSettled(true);
      return;
    }

    // Build simulation nodes, warm-starting from current or static positions
    const existingPos = posRef.current;
    const simNodes: SimNode[] = storeNodes.map((n) => {
      const existing = existingPos.get(n.id);
      const staticPos = staticPositions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        workstream: n.workstream,
        isGoal: isGoalNode(n),
        x: existing?.x ?? staticPos.x,
        y: existing?.y ?? staticPos.y,
        vx: 0,
        vy: 0,
      };
    });

    // Build links from non-parent_of edges
    const nodeIdSet = new Set(storeNodes.map((n) => n.id));
    const simLinks: SimLink[] = storeEdges
      .filter((e) => e.type !== "parent_of")
      .filter((e) => nodeIdSet.has(e.sourceId) && nodeIdSet.has(e.targetId))
      .map((e) => ({
        source: e.sourceId,
        target: e.targetId,
        edgeId: e.id,
        type: e.type,
      }));

    simNodesRef.current = simNodes;

    const sim = forceSimulation<SimNode>(simNodes)
      .force("center", forceCenter(0, 0).strength(0.05))
      .force("charge", forceManyBody().strength(-120).distanceMax(300))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
          .strength(0.3),
      )
      .force("collision", forceCollide<SimNode>().radius(20).strength(0.8))
      .force("clusterGravity", clusterGravity() as any)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .alphaMin(0.001);

    simRef.current = sim;

    if (modeRef.current === "static") {
      sim.stop();
      // Use static positions directly
      const pos = new Map<string, { x: number; y: number }>();
      for (const n of storeNodes) {
        const sp = staticPositions.get(n.id) ?? { x: 0, y: 0 };
        const stored =
          n.x != null && n.y != null ? { x: n.x, y: n.y } : sp;
        pos.set(n.id, stored);
      }
      posRef.current = pos;
      setSettled(true);
      setTick((t) => t + 1);
      return;
    }

    // Start with warm alpha
    sim.alpha(0.3).restart();
    setSettled(false);

    // RAF loop for smooth rendering
    function animate() {
      if (!simRef.current) return;

      const nodes = simNodesRef.current;
      const pos = new Map<string, { x: number; y: number }>();
      let hasNaN = false;

      for (const node of nodes) {
        // NaN safety guard
        if (
          !Number.isFinite(node.x) ||
          !Number.isFinite(node.y)
        ) {
          hasNaN = true;
          break;
        }
        // Position clamping
        node.x = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, node.x!));
        node.y = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, node.y!));
        // Velocity clamping
        node.vx = Math.max(-50, Math.min(50, node.vx ?? 0));
        node.vy = Math.max(-50, Math.min(50, node.vy ?? 0));
        pos.set(node.id, { x: node.x!, y: node.y! });
      }

      if (hasNaN) {
        console.warn(
          "useForceSimulation: NaN detected, resetting to static layout",
        );
        for (const node of nodes) {
          const sp = staticPositions.get(node.id) ?? { x: 0, y: 0 };
          node.x = sp.x;
          node.y = sp.y;
          node.vx = 0;
          node.vy = 0;
          pos.set(node.id, sp);
        }
        simRef.current.alpha(0.1).restart();
      }

      posRef.current = pos;
      setTick((t) => t + 1);

      if (simRef.current.alpha() < 0.002) {
        setSettled(true);
      } else {
        setSettled(false);
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      sim.stop();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeNodes, storeEdges]);

  // Update property-only changes (status, name, etc.) without reinitializing
  useEffect(() => {
    for (const node of storeNodes) {
      const simNode = simNodesRef.current.find((sn) => sn.id === node.id);
      if (simNode) {
        simNode.workstream = node.workstream;
        simNode.isGoal = isGoalNode(node);
      }
    }
  }, [storeNodes]);

  const setMode = useCallback(
    (newMode: LayoutMode) => {
      modeRef.current = newMode;
      setModeState(newMode);

      if (newMode === "static") {
        // Snapshot current positions, stop simulation
        if (simRef.current) {
          simRef.current.stop();
          cancelAnimationFrame(rafRef.current);
        }
        setSettled(true);
      } else {
        // Physics: warm-start from current positions
        if (simRef.current) {
          simRef.current.alpha(0.3).restart();
          setSettled(false);

          function animate() {
            if (!simRef.current || modeRef.current !== "physics") return;
            const nodes = simNodesRef.current;
            const pos = new Map<string, { x: number; y: number }>();
            for (const node of nodes) {
              if (!Number.isFinite(node.x) || !Number.isFinite(node.y))
                continue;
              node.x = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, node.x!));
              node.y = Math.max(-CLAMP_BOUND, Math.min(CLAMP_BOUND, node.y!));
              node.vx = Math.max(-50, Math.min(50, node.vx ?? 0));
              node.vy = Math.max(-50, Math.min(50, node.vy ?? 0));
              pos.set(node.id, { x: node.x!, y: node.y! });
            }
            posRef.current = pos;
            setTick((t) => t + 1);

            if (simRef.current.alpha() < 0.002) {
              setSettled(true);
            }

            rafRef.current = requestAnimationFrame(animate);
          }
          rafRef.current = requestAnimationFrame(animate);
        }
      }
    },
    [staticPositions],
  );

  const onDragStart = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      dragRef.current = { nodeId, startX: clientX, startY: clientY };
      const simNode = simNodesRef.current.find((n) => n.id === nodeId);
      if (simNode && modeRef.current === "physics" && simRef.current) {
        simNode.fx = simNode.x;
        simNode.fy = simNode.y;
        simRef.current.alphaTarget(0.1);
      }
    },
    [],
  );

  const onDragMove = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const simNode = simNodesRef.current.find(
        (n) => n.id === drag.nodeId,
      );
      if (!simNode) return;

      // Calculate delta — caller converts from screen to graph coords
      // For now, just update the fixed position
      if (modeRef.current === "physics") {
        simNode.fx = simNode.x;
        simNode.fy = simNode.y;
      }
    },
    [],
  );

  const onDragEnd = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return null;
    dragRef.current = null;

    const simNode = simNodesRef.current.find(
      (n) => n.id === drag.nodeId,
    );
    if (simNode && modeRef.current === "physics") {
      simNode.fx = null;
      simNode.fy = null;
      if (simRef.current) {
        simRef.current.alphaTarget(0);
      }
    }

    // Return nodeId only if in static mode (caller should PATCH)
    return modeRef.current === "static" ? drag.nodeId : null;
  }, []);

  // In static mode, use static positions (or store-saved positions)
  const positions =
    mode === "static"
      ? (() => {
          const pos = new Map<string, { x: number; y: number }>();
          for (const n of storeNodes) {
            const stored =
              n.x != null && n.y != null
                ? { x: n.x, y: n.y }
                : staticPositions.get(n.id) ?? { x: 0, y: 0 };
            // If we have snapshot positions from a physics→static switch, use those
            const snapshot = posRef.current.get(n.id);
            pos.set(n.id, snapshot ?? stored);
          }
          return pos;
        })()
      : posRef.current;

  return {
    positions,
    mode,
    setMode,
    onDragStart,
    onDragMove,
    onDragEnd,
    settled,
  };
}
