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
    } catch {
      // handled by api()
    }
  }

  async function handleDelete() {
    try {
      await api(`/nodes/${selectedNode!.id}`, { method: "DELETE" });
      removeNode(selectedNode!.id);
      selectNode(null);
    } catch {}
  }

  async function handleAddEdge(targetId: string, direction: "incoming" | "outgoing") {
    const sourceId = direction === "incoming" ? targetId : selectedNode!.id;
    const tgtId = direction === "incoming" ? selectedNode!.id : targetId;
    try {
      const edge = await api<Edge>("/edges", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, target_id: tgtId, type: "blocker" }),
      });
      addEdge(edge);
    } catch {}
  }

  async function handleRemoveEdge(edgeId: string) {
    try {
      await api(`/edges/${edgeId}`, { method: "DELETE" });
      removeEdge(edgeId);
    } catch {}
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
    } catch {}
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
          <button className="btn" style={{ fontSize: 14, padding: "2px 8px", lineHeight: 1 }} onClick={() => selectNode(null)}>x</button>
        </div>
        <span className="dp-badge" style={{ background: pColor + "18", color: pColor }}>{form.priority}</span>
        <span className="dp-badge" style={{ marginLeft: 4, background: sColor + "18", color: sColor }}>
          {statusLabel(form.status ?? "not_started")}
        </span>
      </div>
      <div className="dp-body">
        <div className="dp-field">
          <label className="dp-label">Status</label>
          <select className="dp-input" value={form.status ?? "not_started"} onChange={(e) => set("status", e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </div>
        <div className="dp-field">
          <label className="dp-label">Priority</label>
          <select className="dp-input" value={form.priority ?? "P2"} onChange={(e) => set("priority", e.target.value)}>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="dp-field">
          <label className="dp-label">Workstream</label>
          <input className="dp-input" value={form.workstream ?? ""} onChange={(e) => set("workstream", e.target.value)} />
        </div>
        <div className="dp-row">
          <div className="dp-field">
            <label className="dp-label">Start</label>
            <input type="date" className="dp-input" value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
          </div>
          <div className="dp-field">
            <label className="dp-label">End</label>
            <input type="date" className="dp-input" value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
          </div>
        </div>
        <div className="dp-field">
          <label className="dp-label">Budget ($)</label>
          <input type="number" className="dp-input" value={form.budget ?? ""} onChange={(e) => set("budget", e.target.value ? Number(e.target.value) : null)} />
        </div>
        <div className="dp-field">
          <label className="dp-label">Deliverables</label>
          <textarea className="dp-textarea" value={form.deliverable ?? ""} onChange={(e) => set("deliverable", e.target.value)} />
        </div>
        <div className="dp-field">
          <label className="dp-label">Notes</label>
          <textarea className="dp-textarea" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
        <div className="dp-field">
          <label className="dp-label">RACI</label>
          <div className="dp-row">
            <div><label className="dp-label" style={{ fontSize: 7 }}>R</label><input className="dp-input" value={raci.responsible} onChange={(e) => setRaciField("responsible", e.target.value)} /></div>
            <div><label className="dp-label" style={{ fontSize: 7 }}>A</label><input className="dp-input" value={raci.accountable} onChange={(e) => setRaciField("accountable", e.target.value)} /></div>
          </div>
          <div className="dp-row" style={{ marginTop: 4 }}>
            <div><label className="dp-label" style={{ fontSize: 7 }}>C</label><input className="dp-input" value={raci.consulted} onChange={(e) => setRaciField("consulted", e.target.value)} /></div>
            <div><label className="dp-label" style={{ fontSize: 7 }}>I</label><input className="dp-input" value={raci.informed} onChange={(e) => setRaciField("informed", e.target.value)} /></div>
          </div>
        </div>
        <div className="dp-field">
          <label className="dp-label">This depends on (incoming)</label>
          {incomingEdges.map((e) => (
            <div key={e.id} className="dp-dep">
              <span style={{ flex: 1 }}>{nodeName(e.sourceId)}</span>
              <select
                style={{ fontSize: 8, padding: "2px 4px", border: "1px solid #E0E0E0", background: "#F8F8F8", fontFamily: "Tomorrow", marginRight: 4 }}
                value={e.type}
                onChange={(ev) => handleEdgeTypeChange(e.id, ev.target.value)}
              >
                {edgeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => handleRemoveEdge(e.id)}>x</button>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <select className="dp-input" style={{ fontSize: 10 }} value="" onChange={(e) => { if (e.target.value) handleAddEdge(e.target.value, "incoming"); }}>
              <option value="">+ Add dependency...</option>
              {availableNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
        </div>
        <div className="dp-field">
          <label className="dp-label">Blocks / feeds into (outgoing)</label>
          {outgoingEdges.map((e) => (
            <div key={e.id} className="dp-dep">
              <span style={{ flex: 1 }}>{nodeName(e.targetId)}</span>
              <select
                style={{ fontSize: 8, padding: "2px 4px", border: "1px solid #E0E0E0", background: "#F8F8F8", fontFamily: "Tomorrow", marginRight: 4 }}
                value={e.type}
                onChange={(ev) => handleEdgeTypeChange(e.id, ev.target.value)}
              >
                {edgeTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button onClick={() => handleRemoveEdge(e.id)}>x</button>
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <select className="dp-input" style={{ fontSize: 10 }} value="" onChange={(e) => { if (e.target.value) handleAddEdge(e.target.value, "outgoing"); }}>
              <option value="">+ Add outgoing...</option>
              {availableNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {dirty && (
            <button className="btn primary" style={{ flex: 1 }} onClick={saveAll}>SAVE</button>
          )}
          <button className="btn danger" style={{ width: "100%" }} onClick={handleDelete}>DELETE NODE</button>
        </div>
      </div>
    </div>
  );
}
