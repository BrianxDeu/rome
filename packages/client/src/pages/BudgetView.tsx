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
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableFooter,
} from "../components/ui/table";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";

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
        <Table className="">
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px]">Priority</TableHead>
              <TableHead className="text-[10px]">Count</TableHead>
              <TableHead className="text-[10px]">Budget</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {["P0", "P1", "P2", "P3"].map((p) => {
              const filtered = budgetFilter === "all" ? leafNodes : leafNodes.filter((n) => n.workstream === budgetFilter);
              const pn = filtered.filter((n) => n.priority === p);
              return (
                <TableRow key={p}>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-semibold" style={{ color: priorityColor(p), borderColor: priorityColor(p) + "40" }}>{p}</Badge>
                  </TableCell>
                  <TableCell className="text-[10px]">{pn.length}</TableCell>
                  <TableCell className="text-[10px]">{fmt$(pn.reduce((s, n) => s + (n.budget || 0), 0))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="budget-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #E7E7E7", paddingBottom: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase" }}>Budget Items</div>
          <select className="dp-input" style={{ width: "auto", fontSize: 11, padding: "4px 8px" }} value={budgetFilter} onChange={(e) => setBudgetFilter(e.target.value)}>
            <option value="all">All Workstreams</option>
            {workstreams.map((ws) => <option key={ws} value={ws}>{ws}</option>)}
          </select>
        </div>
        <Table className="">
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer text-[10px] hover:bg-[#F0F0F0]" onClick={() => toggleBudgetSort("label")}>Task {budgetSort === "label" ? (budgetDir > 0 ? "\u2191" : "\u2193") : ""}</TableHead>
              <TableHead className="cursor-pointer text-[10px] hover:bg-[#F0F0F0]" onClick={() => toggleBudgetSort("priority")}>Priority {budgetSort === "priority" ? (budgetDir > 0 ? "\u2191" : "\u2193") : ""}</TableHead>
              <TableHead className="text-[10px]">Workstream</TableHead>
              <TableHead className="text-[10px]">Status</TableHead>
              <TableHead className="text-[10px]">Owner</TableHead>
              <TableHead className="cursor-pointer text-[10px] hover:bg-[#F0F0F0]" onClick={() => toggleBudgetSort("budget")}>Budget {budgetSort === "budget" ? (budgetDir > 0 ? "\u2191" : "\u2193") : ""}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {budgetItems.map((n) => (
              <TableRow key={n.id} className="cursor-pointer">
                <TableCell className="text-[10px]" onClick={() => selectNode(n)}>{n.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]" style={{ color: priorityColor(n.priority), borderColor: priorityColor(n.priority) + "40" }}>{n.priority}</Badge>
                </TableCell>
                <TableCell className="text-[10px]">{n.workstream}</TableCell>
                <TableCell className="text-[10px]">{statusLabel(n.status)}</TableCell>
                <TableCell className="text-[10px]">{getOwner(n)}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    className="w-[90px] text-right text-[10px] font-semibold"
                    value={n.budget ?? 0}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleBudgetChange(n.id, parseInt(e.target.value) || 0)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="font-bold">
              <TableCell className="text-[10px]">TOTAL</TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className="text-[10px]">{fmt$(budgetItems.reduce((s, n) => s + (n.budget || 0), 0))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
