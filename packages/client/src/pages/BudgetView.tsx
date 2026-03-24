import { useEffect, useState, useMemo, useCallback } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";

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

type SortField = "name" | "budget" | "status" | "priority";
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

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function BudgetView({ onNavigateToNode }: BudgetViewProps) {
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const graphNodes = useGraphStore((s) => s.nodes);

  const nodeMap = useMemo(() => {
    const m = new Map<string, { status: string; priority: string }>();
    for (const n of graphNodes) {
      m.set(n.id, { status: n.status, priority: n.priority });
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

  const toggleExpand = useCallback((ws: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ws)) next.delete(ws);
      else next.add(ws);
      return next;
    });
  }, []);

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

  const sortNodes = useCallback(
    (nodes: NodeRollup[]): NodeRollup[] => {
      const sorted = [...nodes];
      const dir = sortDir === "asc" ? 1 : -1;
      sorted.sort((a, b) => {
        switch (sortField) {
          case "name":
            return dir * a.name.localeCompare(b.name);
          case "budget":
            return dir * (a.rollup - b.rollup);
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
          default:
            return 0;
        }
      });
      return sorted;
    },
    [sortField, sortDir, nodeMap],
  );

  if (error) {
    return <div style={styles.container}><p style={styles.error}>Failed to load budget data: {error}</p></div>;
  }

  if (!data) {
    return <div style={styles.container}><p style={styles.loading}>Loading budget data...</p></div>;
  }

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

  return (
    <div style={styles.container}>
      <div style={styles.grandTotal}>
        <span style={styles.grandTotalLabel}>Grand Total</span>
        <span style={styles.grandTotalValue}>{formatCurrency(grandTotal)}</span>
      </div>

      <div style={styles.cards}>
        {data.workstreams.map((ws) => {
          const isExpanded = expanded.has(ws.workstream);
          const proportion = grandTotal > 0 ? ws.total / grandTotal : 0;

          return (
            <div key={ws.workstream} style={styles.card}>
              <button
                style={styles.cardHeader}
                onClick={() => toggleExpand(ws.workstream)}
                aria-expanded={isExpanded}
              >
                <div style={styles.cardHeaderLeft}>
                  <span style={styles.expandIcon}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                  <span style={styles.wsName}>{ws.workstream}</span>
                  <span style={styles.nodeCount}>({ws.nodes.length})</span>
                </div>
                <span style={styles.wsTotal}>{formatCurrency(ws.total)}</span>
              </button>

              <div style={styles.barTrack}>
                <div
                  style={{
                    ...styles.barFill,
                    width: `${Math.round(proportion * 100)}%`,
                  }}
                />
              </div>

              {isExpanded && (
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        {(
                          [
                            ["name", "Name"],
                            ["budget", "Budget"],
                            ["status", "Status"],
                            ["priority", "Priority"],
                          ] as [SortField, string][]
                        ).map(([field, label]) => (
                          <th
                            key={field}
                            style={styles.th}
                            onClick={() => handleSort(field)}
                          >
                            {label}{sortIndicator(field)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortNodes(ws.nodes).map((node) => {
                        const meta = nodeMap.get(node.id);
                        return (
                          <tr
                            key={node.id}
                            style={styles.tr}
                            onClick={() => onNavigateToNode(node.id)}
                          >
                            <td style={styles.td}>{node.name}</td>
                            <td style={{ ...styles.td, ...styles.tdRight }}>
                              {formatCurrency(node.rollup)}
                            </td>
                            <td style={styles.td}>{meta?.status ?? "-"}</td>
                            <td style={styles.td}>{meta?.priority ?? "-"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    padding: "24px",
    overflowY: "auto",
  },
  loading: {
    color: "var(--rome-text-muted)",
    textAlign: "center",
    marginTop: "40px",
  },
  error: {
    color: "#e74c3c",
    textAlign: "center",
    marginTop: "40px",
  },
  grandTotal: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "24px",
    padding: "20px 24px",
    background: "var(--rome-surface)",
    borderRadius: "8px",
    border: "1px solid var(--rome-border)",
  },
  grandTotalLabel: {
    fontSize: "18px",
    fontWeight: 600,
    color: "var(--rome-text)",
  },
  grandTotalValue: {
    fontSize: "28px",
    fontWeight: 700,
    color: "var(--rome-red)",
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  card: {
    background: "var(--rome-surface)",
    borderRadius: "8px",
    border: "1px solid var(--rome-border)",
    overflow: "hidden",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "14px 20px",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--rome-text)",
    fontSize: "15px",
    fontWeight: 500,
    fontFamily: "inherit",
    textAlign: "left",
  },
  cardHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  expandIcon: {
    fontSize: "11px",
    color: "var(--rome-text-muted)",
    width: "14px",
  },
  wsName: {
    fontWeight: 600,
  },
  nodeCount: {
    color: "var(--rome-text-muted)",
    fontSize: "13px",
  },
  wsTotal: {
    fontWeight: 600,
    color: "var(--rome-red)",
    fontSize: "16px",
  },
  barTrack: {
    height: "4px",
    background: "var(--rome-bg)",
    margin: "0 20px 4px",
    borderRadius: "2px",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    background: "var(--rome-red)",
    borderRadius: "2px",
    transition: "width 0.3s ease",
  },
  tableWrap: {
    padding: "0 20px 16px",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
  },
  th: {
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: "1px solid var(--rome-border)",
    color: "var(--rome-text-muted)",
    fontWeight: 500,
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
  tr: {
    cursor: "pointer",
  },
  td: {
    padding: "8px 12px",
    borderBottom: "1px solid var(--rome-border)",
    color: "var(--rome-text)",
  },
  tdRight: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
};
