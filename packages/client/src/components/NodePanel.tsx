import { useState, useEffect, useMemo } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  STATUSES,
  PRIORITIES,
  EDGE_TYPES,
  priorityColor,
  statusColor,
  statusLabel,
  parseRaci,
} from "../constants";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";

const statuses = Object.keys(STATUSES);
const priorities = Object.keys(PRIORITIES);
const edgeTypes = Object.keys(EDGE_TYPES).filter((t) => t !== "parent_of");

export function NodePanel() {
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const removeNode = useGraphStore((s) => s.removeNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const addEdge = useGraphStore((s) => s.addEdge);
  const removeEdge = useGraphStore((s) => s.removeEdge);

  const [form, setForm] = useState<Partial<Node>>({});
  const [raci, setRaci] = useState({ responsible: "", accountable: "", consulted: "", informed: "" });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (selectedNode) {
      setForm({ ...selectedNode });
      setRaci(parseRaci(selectedNode.raci));
      setDirty(false);
    }
  }, [selectedNode]);

  const incomingEdges = useMemo(
    () => edges.filter((e) => e.targetId === selectedNode?.id && e.type !== "parent_of"),
    [edges, selectedNode],
  );

  const outgoingEdges = useMemo(
    () => edges.filter((e) => e.sourceId === selectedNode?.id && e.type !== "parent_of"),
    [edges, selectedNode],
  );

  const connectedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const e of [...incomingEdges, ...outgoingEdges]) {
      ids.add(e.sourceId);
      ids.add(e.targetId);
    }
    return ids;
  }, [incomingEdges, outgoingEdges]);

  const availableNodes = useMemo(
    () => nodes.filter((n) => n.id !== selectedNode?.id && !connectedNodeIds.has(n.id)),
    [nodes, selectedNode, connectedNodeIds],
  );

  if (!selectedNode) return null;

  function set(field: keyof Node, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
    updateNode(selectedNode!.id, { [field]: value } as Partial<Node>);
    setDirty(true);
  }

  function setRaciField(field: keyof typeof raci, value: string) {
    const next = { ...raci, [field]: value };
    setRaci(next);
    const raciJson = JSON.stringify(next);
    setForm((prev) => ({ ...prev, raci: raciJson }));
    updateNode(selectedNode!.id, { raci: raciJson });
    setDirty(true);
  }

  async function saveAll() {
    try {
      const raciJson = JSON.stringify(raci);
      const body: Record<string, unknown> = {
        name: form.name,
        status: form.status,
        priority: form.priority,
        start_date: form.startDate || null,
        end_date: form.endDate || null,
        budget: form.budget ?? null,
        deliverable: form.deliverable || null,
        notes: form.notes || null,
        raci: raciJson,
        workstream: form.workstream || null,
      };
      await api(`/nodes/${selectedNode!.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setDirty(false);
    } catch (err) {
      console.error("Failed to save node:", err);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${selectedNode!.name}"? This cannot be undone.`)) return;
    try {
      await api(`/nodes/${selectedNode!.id}`, { method: "DELETE" });
      removeNode(selectedNode!.id);
      selectNode(null);
    } catch (err) {
      console.error("Failed to delete node:", err);
    }
  }

  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);

  async function refetchGraph() {
    try {
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
    } catch (err) {
      console.error("Failed to refetch graph:", err);
    }
  }

  async function handleAddEdge(targetId: string, direction: "incoming" | "outgoing") {
    const sourceId = direction === "incoming" ? targetId : selectedNode!.id;
    const tgtId = direction === "incoming" ? selectedNode!.id : targetId;
    try {
      const edge = await api<Edge>("/edges", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, target_id: tgtId, type: direction === "incoming" ? "depends_on" : "blocker" }),
      });
      addEdge(edge);
      await refetchGraph();
    } catch (err) {
      console.error("Failed to add edge:", err);
    }
  }

  async function handleRemoveEdge(edgeId: string) {
    try {
      await api(`/edges/${edgeId}`, { method: "DELETE" });
      removeEdge(edgeId);
      await refetchGraph();
    } catch (err) {
      console.error("Failed to remove edge:", err);
    }
  }

  async function handleEdgeTypeChange(edgeId: string, newType: string) {
    try {
      await api(`/edges/${edgeId}`, {
        method: "PATCH",
        body: JSON.stringify({ type: newType }),
      });
      // Update edge in store
      const edge = edges.find((e) => e.id === edgeId);
      if (edge) {
        removeEdge(edgeId);
        addEdge({ ...edge, type: newType });
      }
    } catch (err) {
      console.error("Failed to change edge type:", err);
    }
  }

  function nodeName(id: string): string {
    return nodes.find((n) => n.id === id)?.name ?? id;
  }

  const pColor = priorityColor(form.priority ?? "P2");
  const sColor = statusColor(form.status ?? "not_started");

  return (
    <div className="detail-panel">
      <div className="dp-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="dp-title">{form.name}</div>
          <Button variant="ghost" size="icon-xs" onClick={() => selectNode(null)}>x</Button>
        </div>
        <Badge variant="outline" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" style={{ background: pColor + "18", color: pColor, borderColor: pColor + "30" }}>{form.priority}</Badge>
        <Badge variant="outline" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" style={{ background: sColor + "18", color: sColor, borderColor: sColor + "30", marginLeft: 8 }}>
          {statusLabel(form.status ?? "not_started")}
        </Badge>
      </div>
      <div className="dp-body">
        <div className="dp-field">
          <Label className="dp-label">Status</Label>
          <select className="dp-input" value={form.status ?? "not_started"} onChange={(e) => set("status", e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </div>
        <div className="dp-field">
          <Label className="dp-label">Priority</Label>
          <select className="dp-input" value={form.priority ?? "P2"} onChange={(e) => set("priority", e.target.value)}>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="dp-field">
          <Label className="dp-label">Workstream</Label>
          <Input className="font-[Tomorrow] text-[11px]" value={form.workstream ?? ""} onChange={(e) => set("workstream", e.target.value)} />
        </div>
        <div className="dp-row">
          <div className="dp-field">
            <Label className="dp-label">Start</Label>
            <Input type="date" className="font-[Tomorrow] text-[11px]" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
          </div>
          <div className="dp-field">
            <Label className="dp-label">End</Label>
            <Input type="date" className="font-[Tomorrow] text-[11px]" value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
          </div>
        </div>
        <div className="dp-field">
          <Label className="dp-label">Budget ($)</Label>
          <Input type="number" className="font-[Tomorrow] text-[11px]" value={form.budget ?? ""} onChange={(e) => set("budget", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div className="dp-field">
          <Label className="dp-label">Deliverables</Label>
          <Textarea className="font-[Tomorrow] text-[13px]" value={form.deliverable ?? ""} onChange={(e) => set("deliverable", e.target.value)} />
        </div>
        <div className="dp-field">
          <Label className="dp-label">Notes</Label>
          <Textarea className="font-[Tomorrow] text-[13px]" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div className="dp-field">
          <Label className="dp-label">RACI</Label>
          <div className="dp-row">
            <div><Label className="dp-label" style={{ fontSize: 7 }}>R</Label><Input className="font-[Tomorrow] text-[11px]" value={raci.responsible} onChange={(e) => setRaciField("responsible", e.target.value)} /></div>
            <div><Label className="dp-label" style={{ fontSize: 7 }}>A</Label><Input className="font-[Tomorrow] text-[11px]" value={raci.accountable} onChange={(e) => setRaciField("accountable", e.target.value)} /></div>
          </div>
          <div className="dp-row" style={{ marginTop: 4 }}>
            <div><Label className="dp-label" style={{ fontSize: 7 }}>C</Label><Input className="font-[Tomorrow] text-[11px]" value={raci.consulted} onChange={(e) => setRaciField("consulted", e.target.value)} /></div>
            <div><Label className="dp-label" style={{ fontSize: 7 }}>I</Label><Input className="font-[Tomorrow] text-[11px]" value={raci.informed} onChange={(e) => setRaciField("informed", e.target.value)} /></div>
          </div>
        </div>
        <div className="dp-field">
          <Label className="dp-label">Relations</Label>
          {[
            ...incomingEdges.map((e) => ({ ...e, direction: "incoming" as const })),
            ...outgoingEdges.map((e) => ({ ...e, direction: "outgoing" as const })),
          ].map((e) => {
            const otherName = e.direction === "incoming" ? nodeName(e.sourceId) : nodeName(e.targetId);
            return (
              <div key={e.id} className="dp-dep" style={{ fontSize: 11, padding: "8px 10px" }}>
                <span style={{ flex: 1 }}>
                  {e.direction === "incoming"
                    ? <>{otherName} <span style={{ color: "#999" }}>&rarr; this</span></>
                    : <>this <span style={{ color: "#999" }}>&rarr;</span> {otherName}</>
                  }
                </span>
                <select
                  style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #E0E0E0", background: "#F8F8F8", fontFamily: "Tomorrow", marginLeft: 8 }}
                  value={e.type}
                  onChange={(ev) => handleEdgeTypeChange(e.id, ev.target.value)}
                >
                  {edgeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <Button variant="ghost" size="icon-xs" className="ml-1 h-5 w-5 text-[#999] hover:text-[#B81917]" onClick={() => handleRemoveEdge(e.id)}>x</Button>
              </div>
            );
          })}
          {incomingEdges.length === 0 && outgoingEdges.length === 0 && (
            <div style={{ fontSize: 11, color: "#BBB", marginBottom: 4 }}>No relations yet</div>
          )}
          <div style={{ marginTop: 6 }}>
            <select className="dp-input" value="" onChange={(e) => { if (e.target.value) handleAddEdge(e.target.value, "incoming"); }}>
              <option value="">+ Add relation...</option>
              {availableNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {dirty && (
            <Button className="flex-1 font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={saveAll}>SAVE</Button>
          )}
          <Button variant="destructive" className="w-full font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={handleDelete}>DELETE NODE</Button>
        </div>
      </div>
    </div>
  );
}
