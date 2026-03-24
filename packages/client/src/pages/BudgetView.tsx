import { useEffect, useState, useMemo, useCallback } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import {
  statusLabel,
  statusColor,
  priorityColor,
  PRIORITIES,
  buildClusterMaps,
} from "../constants";

interface NodeRollup {
  id: string;
  name: string;
  own: number;
  rollup: number;
}

interface WorkstreamRollup {
  workstream: string;
  total: number;
  nodes: NodeRollup[];
}

interface BudgetResponse {
  workstreams: WorkstreamRollup[];
}

type SortField = "name" | "priority" | "workstream" | "status" | "owner" | "budget";
type SortDir = "asc" | "desc";

interface BudgetViewProps {
  onNavigateToNode: (nodeId: string) => void;
}

const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const statusOrder: Record<string, number> = {
  in_progress: 0,
  not_started: 1,
  blocked: 2,
  done: 3,
  cancelled: 4,
};

const WS_COLORS = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

function fmt$(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function BudgetView({ onNavigateToNode }: BudgetViewProps) {
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [wsFilter, setWsFilter] = useState("all");
  const [editingBudgets, setEditingBudgets] = useState<Record<string, string>>({});

  const graphNodes = useGraphStore((s) => s.nodes);
  const graphEdges = useGraphStore((s) => s.edges);
  const updateNodeInStore = useGraphStore((s) => s.updateNode);

  const { childrenMap } = useMemo(() => buildClusterMaps(graphEdges), [graphEdges]);

  const nodeMap = useMemo(() => {
    const m = new Map<
      string,
      { status: string; priority: string; workstream: string | null; raci: string | null }
    >();
    for (const n of graphNodes) {
      m.set(n.id, { status: n.status, priority: n.priority, workstream: n.workstream, raci: n.raci });
    }
    return m;
  }, [graphNodes]);

  useEffect(() => {
    api<BudgetResponse>("/budget")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const grandTotal = useMemo(() => {
    if (!data) return 0;
    return data.workstreams.reduce((sum, ws) => sum + ws.total, 0);
  }, [data]);

  // Workstream color map
  const wsColorMap = useMemo(() => {
    if (!data) return new Map<string, string>();
    const m = new Map<string, string>();
    data.workstreams.forEach((ws, i) => {
      m.set(ws.workstream, WS_COLORS[i % WS_COLORS.length]);
    });
    return m;
  }, [data]);

  // Flat list of non-cluster budget items
  const allItems = useMemo(() => {
    if (!data) return [];
    const items: (NodeRollup & { workstream: string })[] = [];
    for (const ws of data.workstreams) {
      for (const node of ws.nodes) {
        // Exclude cluster parent nodes
        if (childrenMap.has(node.id)) continue;
        items.push({ ...node, workstream: ws.workstream });
      }
    }
    return items;
  }, [data, childrenMap]);

  // Priority breakdown
  const priorityBreakdown = useMemo(() => {
    return ["P0", "P1", "P2", "P3"].map((p) => {
      const matching = allItems.filter((item) => nodeMap.get(item.id)?.priority === p);
      return {
        priority: p,
        count: matching.length,
        budget: matching.reduce((s, n) => s + (n.own || 0), 0),
      };
    });
  }, [allItems, nodeMap]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (wsFilter === "all") return allItems;
    return allItems.filter((item) => item.workstream === wsFilter);
  }, [allItems, wsFilter]);

  // Sorted items
  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems];
    const dir = sortDir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortField) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "budget":
          return dir * (a.own - b.own);
        case "workstream":
          return dir * a.workstream.localeCompare(b.workstream);
        case "status": {
          const sa = statusOrder[nodeMap.get(a.id)?.status ?? ""] ?? 99;
          const sb = statusOrder[nodeMap.get(b.id)?.status ?? ""] ?? 99;
          return dir * (sa - sb);
        }
        case "priority": {
          const pa = priorityOrder[nodeMap.get(a.id)?.priority ?? ""] ?? 99;
          const pb = priorityOrder[nodeMap.get(b.id)?.priority ?? ""] ?? 99;
          return dir * (pa - pb);
        }
        case "owner": {
          const oa = getOwner(a.id);
          const ob = getOwner(b.id);
          return dir * oa.localeCompare(ob);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredItems, sortField, sortDir, nodeMap]);

  const filteredTotal = useMemo(
    () => sortedItems.reduce((s, n) => s + (n.own || 0), 0),
    [sortedItems],
  );

  function getOwner(nodeId: string): string {
    const raci = nodeMap.get(nodeId)?.raci;
    if (!raci) return "";
    try {
      let str = raci;
      if (str.startsWith('"') && str.endsWith('"')) str = JSON.parse(str);
      const parsed = typeof str === "string" ? JSON.parse(str) : str;
      return parsed.responsible || "";
    } catch {
      return "";
    }
  }

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const handleBudgetBlur = useCallback(
    async (nodeId: string) => {
      const val = editingBudgets[nodeId];
      if (val === undefined) return;
      const budget = parseInt(val) || 0;
      setEditingBudgets((prev) => {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      try {
        await api(`/nodes/${nodeId}`, {
          method: "PATCH",
          body: JSON.stringify({ budget }),
        });
        updateNodeInStore(nodeId, { budget });
        // Refresh budget data
        const fresh = await api<BudgetResponse>("/budget");
        setData(fresh);
      } catch {
        // Revert on failure silently — data will refresh
      }
    },
    [editingBudgets, updateNodeInStore],
  );

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  if (error) {
    return (
      <div style={S.container}>
        <p style={S.error}>Failed to load budget data: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={S.container}>
        <p style={S.loading}>Loading budget data...</p>
      </div>
    );
  }

  return (
    <div style={S.container}>
      {/* Hero */}
      <div style={S.hero}>
        <div style={S.heroTotal}>{fmt$(grandTotal)}</div>
        <div style={S.heroSubtitle}>Total Allocated</div>
      </div>

      {/* By Workstream bar chart */}
      <div style={S.section}>
        <div style={S.sectionTitle}>By Workstream</div>
        {data.workstreams.map((ws) => {
          const pct = grandTotal > 0 ? Math.round((ws.total / grandTotal) * 100) : 0;
          const color = wsColorMap.get(ws.workstream) ?? "#999";
          return (
            <div key={ws.workstream} style={S.barRow}>
              <div style={S.barLabel}>{ws.workstream}</div>
              <div style={S.barTrack}>
                <div
                  style={{
                    ...S.barFill,
                    width: `${pct}%`,
                    background: color,
                  }}
                >
                  {pct > 8 && <span style={S.barPct}>{pct}%</span>}
                </div>
              </div>
              <div style={S.barAmount}>{fmt$(ws.total)}</div>
            </div>
          );
        })}
      </div>

      {/* By Priority table */}
      <div style={S.section}>
        <div style={S.sectionTitle}>By Priority</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Priority</th>
              <th style={S.th}>Count</th>
              <th style={{ ...S.th, textAlign: "right" }}>Budget</th>
            </tr>
          </thead>
          <tbody>
            {priorityBreakdown.map((row) => (
              <tr key={row.priority}>
                <td style={S.td}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: priorityColor(row.priority),
                      marginRight: 8,
                    }}
                  />
                  <span style={{ fontWeight: 600, color: priorityColor(row.priority) }}>
                    {row.priority} — {PRIORITIES[row.priority]?.label}
                  </span>
                </td>
                <td style={S.td}>{row.count}</td>
                <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmt$(row.budget)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Budget Items */}
      <div style={S.section}>
        <div style={S.itemsHeader}>
          <div style={S.sectionTitle}>Budget Items</div>
          <select
            style={S.filterSelect}
            value={wsFilter}
            onChange={(e) => setWsFilter(e.target.value)}
          >
            <option value="all">All Workstreams</option>
            {data.workstreams.map((ws) => (
              <option key={ws.workstream} value={ws.workstream}>
                {ws.workstream}
              </option>
            ))}
          </select>
        </div>
        <table style={S.table}>
          <thead>
            <tr>
              {(
                [
                  ["name", "Task"],
                  ["priority", "Priority"],
                  ["workstream", "Workstream"],
                  ["status", "Status"],
                  ["owner", "Owner"],
                  ["budget", "Budget"],
                ] as [SortField, string][]
              ).map(([field, label]) => (
                <th
                  key={field}
                  style={{
                    ...S.th,
                    cursor: "pointer",
                    textAlign: field === "budget" ? "right" : "left",
                  }}
                  onClick={() => handleSort(field)}
                >
                  {label}
                  {sortIndicator(field)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => {
              const meta = nodeMap.get(item.id);
              const isEditing = item.id in editingBudgets;
              return (
                <tr key={item.id} style={S.itemRow}>
                  <td
                    style={{ ...S.td, cursor: "pointer", fontWeight: 500 }}
                    onClick={() => onNavigateToNode(item.id)}
                  >
                    {item.name}
                  </td>
                  <td style={S.td}>
                    <span style={{ color: priorityColor(meta?.priority ?? ""), fontWeight: 600 }}>
                      {meta?.priority ?? "-"}
                    </span>
                  </td>
                  <td style={S.td}>{item.workstream}</td>
                  <td style={S.td}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: statusColor(meta?.status ?? ""),
                          flexShrink: 0,
                        }}
                      />
                      {statusLabel(meta?.status ?? "")}
                    </span>
                  </td>
                  <td style={S.td}>{getOwner(item.id)}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <input
                      type="number"
                      style={S.budgetInput}
                      value={isEditing ? editingBudgets[item.id] : item.own}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setEditingBudgets((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      onFocus={() =>
                        setEditingBudgets((prev) => ({
                          ...prev,
                          [item.id]: String(item.own),
                        }))
                      }
                      onBlur={() => handleBudgetBlur(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            <tr style={S.totalRow}>
              <td style={{ ...S.td, fontWeight: 700 }}>TOTAL</td>
              <td style={S.td} />
              <td style={S.td} />
              <td style={S.td} />
              <td style={S.td} />
              <td
                style={{
                  ...S.td,
                  textAlign: "right",
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmt$(filteredTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    padding: "24px",
    overflowY: "auto",
  },
  loading: {
    color: "#999",
    textAlign: "center",
    marginTop: 40,
  },
  error: {
    color: "#e74c3c",
    textAlign: "center",
    marginTop: 40,
  },

  // Hero
  hero: {
    textAlign: "center",
    marginBottom: 32,
    padding: "32px 24px",
  },
  heroTotal: {
    fontSize: 48,
    fontWeight: 700,
    color: "#B81917",
    lineHeight: 1.1,
    fontVariantNumeric: "tabular-nums",
  },
  heroSubtitle: {
    fontSize: 14,
    color: "#999",
    marginTop: 6,
    textTransform: "uppercase" as const,
    letterSpacing: 2,
  },

  // Sections
  section: {
    marginBottom: 28,
    background: "var(--rome-surface, #fff)",
    borderRadius: 8,
    border: "1px solid var(--rome-border, #E7E7E7)",
    padding: "16px 20px",
  },
  sectionTitle: {
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    color: "#999",
    marginBottom: 12,
    fontWeight: 600,
  },

  // Bar chart
  barRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  barLabel: {
    width: 120,
    fontSize: 13,
    fontWeight: 500,
    color: "var(--rome-text, #1A1A1A)",
    flexShrink: 0,
  },
  barTrack: {
    flex: 1,
    height: 22,
    background: "#F5F5F5",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "width 0.3s ease",
    minWidth: 0,
  },
  barPct: {
    color: "#fff",
    fontSize: 10,
    fontWeight: 600,
  },
  barAmount: {
    width: 90,
    textAlign: "right" as const,
    fontSize: 13,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: "var(--rome-text, #1A1A1A)",
    flexShrink: 0,
  },

  // Tables
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  },
  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
    color: "#999",
    fontWeight: 500,
    userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  td: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
    color: "var(--rome-text, #1A1A1A)",
  },
  itemRow: {
    cursor: "default",
  },
  totalRow: {
    borderTop: "2px solid #1A1A1A",
  },

  // Items header
  itemsHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px solid var(--rome-border, #E7E7E7)",
    paddingBottom: 8,
    marginBottom: 12,
  },
  filterSelect: {
    fontSize: 11,
    padding: "4px 8px",
    border: "1px solid var(--rome-border, #E7E7E7)",
    borderRadius: 4,
    background: "#F8F8F8",
    fontFamily: "Tomorrow, sans-serif",
    color: "var(--rome-text, #1A1A1A)",
  },

  // Budget input
  budgetInput: {
    width: 90,
    fontSize: 12,
    padding: "2px 6px",
    fontWeight: 600,
    textAlign: "right" as const,
    border: "1px solid transparent",
    borderRadius: 3,
    background: "transparent",
    fontFamily: "Tomorrow, sans-serif",
    fontVariantNumeric: "tabular-nums",
    color: "var(--rome-text, #1A1A1A)",
  },
};
