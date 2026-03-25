import { useMemo, useState, useCallback } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import {
  priorityColor,
  buildClusterMaps,
  isClusterNode,
  statusLabel,
  parseRaci,
} from "../constants";
import type { Node } from "@rome/shared";

// Workstream colors
const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

const fmt$ = (n: number) => "$" + (n || 0).toLocaleString();

type SortField = "label" | "priority" | "budget";

export function BudgetView() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const updateNode = useGraphStore((s) => s.updateNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const [budgetSort, setBudgetSort] = useState<SortField>("budget");
  const [budgetDir, setBudgetDir] = useState(-1);
  const [budgetFilter, setBudgetFilter] = useState("all");

  const { childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Workstreams
  const workstreams = useMemo(() => {
    const ws = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) ws.add(n.workstream);
    }
    return Array.from(ws).sort();
  }, [nodes]);

  // Leaf nodes only
  const leafNodes = useMemo(
    () => nodes.filter((n) => !isClusterNode(n.id, childrenMap)),
    [nodes, childrenMap],
  );

  // Total budget
  const totalBudget = useMemo(
    () => leafNodes.reduce((s, n) => s + (n.budget || 0), 0),
    [leafNodes],
  );

  // Budget by workstream
  const budgetByGroup = useMemo(() => {
    return workstreams.map((ws, i) => ({
      id: ws,
      label: ws,
      color: WS_PALETTE[i % WS_PALETTE.length],
      budget: leafNodes.filter((n) => n.workstream === ws).reduce((s, n) => s + (n.budget || 0), 0),
    }));
  }, [workstreams, leafNodes]);

  // Budget items
  const budgetItems = useMemo(() => {
    let items = leafNodes
      .filter((n) => (n.budget || 0) > 0 || budgetFilter !== "all")
      .filter((n) => budgetFilter === "all" || n.workstream === budgetFilter);

    items.sort((a, b) => {
      if (budgetSort === "budget") return ((b.budget || 0) - (a.budget || 0)) * budgetDir;
      if (budgetSort === "label") return a.name.localeCompare(b.name) * budgetDir;
      if (budgetSort === "priority") return a.priority.localeCompare(b.priority) * budgetDir;
      return 0;
    });

    return items;
  }, [leafNodes, budgetSort, budgetDir, budgetFilter]);

  function toggleBudgetSort(col: SortField) {
    if (budgetSort === col) setBudgetDir((d) => d * -1);
    else { setBudgetSort(col); setBudgetDir(col === "budget" ? -1 : 1); }
  }

  async function handleBudgetChange(nodeId: string, value: number) {
    updateNode(nodeId, { budget: value });
    try {
      await api(`/nodes/${nodeId}`, {
        method: "PATCH",
        body: JSON.stringify({ budget: value }),
      });
    } catch {}
  }

  function getOwner(n: Node): string {
    return parseRaci(n.raci).responsible;
  }

  return (
    <div className="budget-wrap">
      <div className="budget-hero">
        <div className="budget-total">{fmt$(totalBudget)}</div>
        <div className="budget-subtitle">Total Allocated</div>
      </div>
      <div className="budget-section">
        <div className="budget-section-title">By Workstream</div>
        {budgetByGroup.map((g) => (
          <div key={g.id} className="budget-bar-row">
            <div className="budget-bar-label">{g.label}</div>
            <div className="budget-bar-track">
              <div
                className="budget-bar-fill"
                style={{
                  width: totalBudget > 0 ? (g.budget / totalBudget * 100) + "%" : "0%",
                  background: g.color,
                }}
              >
                {g.budget > 0 && Math.round(g.budget / totalBudget * 100) + "%"}
              </div>
            </div>
            <div className="budget-bar-amount">{fmt$(g.budget)}</div>
          </div>
        ))}
      </div>
      <div className="budget-section">
        <div className="budget-section-title">By Priority</div>
        <table className="budget-table">
          <thead>
            <tr><th>Priority</th><th>Count</th><th>Budget</th></tr>
          </thead>
          <tbody>
            {["P0", "P1", "P2", "P3"].map((p) => {
              const pn = leafNodes.filter((n) => n.priority === p);
              return (
                <tr key={p}>
                  <td style={{ color: priorityColor(p), fontWeight: 600 }}>{p}</td>
                  <td>{pn.length}</td>
                  <td>{fmt$(pn.reduce((s, n) => s + (n.budget || 0), 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="budget-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #E7E7E7", paddingBottom: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>Budget Items</div>
          <select className="dp-input" style={{ width: "auto", fontSize: 9, padding: "4px 8px" }} value={budgetFilter} onChange={(e) => setBudgetFilter(e.target.value)}>
            <option value="all">All Workstreams</option>
            {workstreams.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
          </select>
        </div>
        <table className="budget-table">
          <thead>
            <tr>
              <th onClick={() => toggleBudgetSort("label")}>Task {budgetSort === "label" ? (budgetDir > 0 ? "\u2191" : "\u2193") : ""}</th>
              <th onClick={() => toggleBudgetSort("priority")}>Priority {budgetSort === "priority" ? (budgetDir > 0 ? "\u2191" : "\u2193") : ""}</th>
              <th>Workstream</th>
              <th>Status</th>
              <th>Owner</th>
              <th onClick={() => toggleBudgetSort("budget")}>Budget {budgetSort === "budget" ? (budgetDir > 0 ? "\u2191" : "\u2193") : ""}</th>
            </tr>
          </thead>
          <tbody>
            {budgetItems.map((n) => (
              <tr key={n.id} style={{ cursor: "pointer" }}>
                <td onClick={() => selectNode(n)}>{n.name}</td>
                <td style={{ color: priorityColor(n.priority) }}>{n.priority}</td>
                <td>{n.workstream}</td>
                <td>{statusLabel(n.status)}</td>
                <td>{getOwner(n)}</td>
                <td style={{ fontWeight: 600 }}>
                  <input
                    type="number"
                    className="dp-input"
                    style={{ width: 90, fontSize: 10, padding: "2px 6px", fontWeight: 600, textAlign: "right" }}
                    value={n.budget ?? 0}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleBudgetChange(n.id, parseInt(e.target.value) || 0)}
                  />
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: "2px solid #1A1A1A" }}>
              <td>TOTAL</td><td /><td /><td /><td />
              <td>{fmt$(budgetItems.reduce((s, n) => s + (n.budget || 0), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
