import type { Edge } from "@rome/shared";

export const PRIORITIES: Record<string, { label: string; color: string }> = {
  P0: { label: "Critical", color: "#1A1A1A" },
  P1: { label: "Urgent", color: "#B81917" },
  P2: { label: "High", color: "#3B82F6" },
  P3: { label: "Medium", color: "#8B5CF6" },
};

export const STATUSES: Record<string, { label: string; color: string }> = {
  not_started: { label: "Not Started", color: "#999999" },
  in_progress: { label: "In Progress", color: "#2563eb" },
  blocked: { label: "Blocked", color: "#dc2626" },
  done: { label: "Done", color: "#16a34a" },
  cancelled: { label: "Cancelled", color: "#9ca3af" },
};

export const EDGE_TYPES: Record<
  string,
  { label: string; color: string; dash?: string }
> = {
  blocks: { label: "Blocks", color: "#dc2626" },
  blocker: { label: "Blocker", color: "#dc2626" },
  depends_on: { label: "Depends On", color: "#dc2626" },
  sequence: { label: "Sequence", color: "#f59e0b" },
  produces: { label: "Produces", color: "#16a34a" },
  feeds: { label: "Feeds", color: "#3B82F6" },
  shared: { label: "Shared", color: "#8B5CF6", dash: "4 2" },
  parent_of: { label: "Parent Of", color: "#999" },
};

export const DEPENDENCY_EDGE_TYPES = new Set([
  "blocks",
  "blocker",
  "depends_on",
  "sequence",
]);

export function statusLabel(s: string): string {
  return STATUSES[s]?.label ?? s.replace(/_/g, " ");
}

export function statusColor(s: string): string {
  return STATUSES[s]?.color ?? "#999";
}

export function priorityColor(p: string): string {
  return PRIORITIES[p]?.color ?? "#999";
}

// --- Cluster derivation utilities (shared across all views) ---

export function buildClusterMaps(edges: Edge[]) {
  const parentMap = new Map<string, string>(); // childId -> parentId
  const childrenMap = new Map<string, string[]>(); // parentId -> childIds
  for (const e of edges) {
    if (e.type === "parent_of") {
      parentMap.set(e.targetId, e.sourceId);
      const children = childrenMap.get(e.sourceId) ?? [];
      children.push(e.targetId);
      childrenMap.set(e.sourceId, children);
    }
  }
  return { parentMap, childrenMap };
}

export function isClusterNode(
  nodeId: string,
  childrenMap: Map<string, string[]>,
): boolean {
  return (childrenMap.get(nodeId)?.length ?? 0) > 0;
}

export function parseRaci(raci: string | null): {
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
} {
  const empty = {
    responsible: "",
    accountable: "",
    consulted: "",
    informed: "",
  };
  if (!raci) return empty;
  try {
    let str = raci;
    // Handle double-escaped JSON bug
    if (str.startsWith('"') && str.endsWith('"')) str = JSON.parse(str);
    const parsed = typeof str === "string" ? JSON.parse(str) : str;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}
