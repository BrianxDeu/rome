import { useState, useEffect, useMemo } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";
import {
  STATUSES,
  PRIORITIES,
  EDGE_TYPES,
  statusLabel,
  statusColor,
  priorityColor,
  parseRaci,
} from "../constants";

const statuses = Object.keys(STATUSES);
const priorities = Object.keys(PRIORITIES);

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
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (selectedNode) {
      setForm({ ...selectedNode });
      setRaci(parseRaci(selectedNode.raci));
      setDirty(false);
      setSaveStatus("idle");
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
    setSaveStatus("idle");
  }

  function setRaciField(field: keyof typeof raci, value: string) {
    const next = { ...raci, [field]: value };
    setRaci(next);
    const raciJson = JSON.stringify(next);
    setForm((prev) => ({ ...prev, raci: raciJson }));
    updateNode(selectedNode!.id, { raci: raciJson });
    setDirty(true);
    setSaveStatus("idle");
  }

  async function saveAll() {
    setSaveStatus("saving");
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
      setSaveStatus("saved");
    } catch {
      setSaveStatus("idle");
    }
  }

  async function handleDelete() {
    try {
      await api(`/nodes/${selectedNode!.id}`, { method: "DELETE" });
      removeNode(selectedNode!.id);
      selectNode(null);
    } catch {
      // handled by api()
    }
  }

  async function handleAddEdge(targetId: string, direction: "incoming" | "outgoing") {
    const sourceId = direction === "incoming" ? targetId : selectedNode!.id;
    const tgtId = direction === "incoming" ? selectedNode!.id : targetId;
    try {
      const edge = await api<Edge>("/edges", {
        method: "POST",
        body: JSON.stringify({ source_id: sourceId, target_id: tgtId, type: "blocks" }),
      });
      addEdge(edge);
    } catch {
      // handled by api()
    }
  }

  async function handleRemoveEdge(edgeId: string) {
    try {
      await api(`/edges/${edgeId}`, { method: "DELETE" });
      removeEdge(edgeId);
    } catch {
      // handled by api()
    }
  }

  function nodeName(id: string): string {
    return nodes.find((n) => n.id === id)?.name ?? id;
  }

  return (
    <aside style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{form.name || "Node Details"}</h3>
        <button onClick={() => selectNode(null)} style={closeBtnStyle}>x</button>
      </div>

      {/* Status + Priority chips */}
      <div style={{ display: "flex", gap: 6 }}>
        <span style={{ ...chipStyle, background: statusColor(form.status ?? "not_started"), color: "#fff" }}>
          {statusLabel(form.status ?? "not_started")}
        </span>
        <span style={{ ...chipStyle, background: priorityColor(form.priority ?? "P2"), color: "#fff" }}>
          {form.priority ?? "P2"}
        </span>
      </div>

      <Field label="Name">
        <input style={inputStyle} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Status" flex>
          <select style={inputStyle} value={form.status ?? "not_started"} onChange={(e) => set("status", e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </Field>
        <Field label="Priority" flex>
          <select style={inputStyle} value={form.priority ?? "P2"} onChange={(e) => set("priority", e.target.value)}>
            {priorities.map((p) => <option key={p} value={p}>{p} — {PRIORITIES[p]?.label}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Workstream">
        <input style={inputStyle} value={form.workstream ?? ""} onChange={(e) => set("workstream", e.target.value)} />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Start Date" flex>
          <input type="date" style={inputStyle} value={form.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
        </Field>
        <Field label="End Date" flex>
          <input type="date" style={inputStyle} value={form.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
        </Field>
      </div>

      <Field label="Budget (USD)">
        <input type="number" style={inputStyle} value={form.budget ?? ""} onChange={(e) => set("budget", e.target.value ? Number(e.target.value) : null)} />
      </Field>

      <Field label="Deliverable">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.deliverable ?? ""} onChange={(e) => set("deliverable", e.target.value)} />
      </Field>

      <Field label="Notes">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      {/* RACI — 4 separate fields */}
      <div style={{ fontSize: 12, color: "var(--rome-text-muted)", fontWeight: 600, marginTop: 4 }}>RACI</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Field label="Responsible">
          <input style={inputStyle} value={raci.responsible} onChange={(e) => setRaciField("responsible", e.target.value)} />
        </Field>
        <Field label="Accountable">
          <input style={inputStyle} value={raci.accountable} onChange={(e) => setRaciField("accountable", e.target.value)} />
        </Field>
        <Field label="Consulted">
          <input style={inputStyle} value={raci.consulted} onChange={(e) => setRaciField("consulted", e.target.value)} />
        </Field>
        <Field label="Informed">
          <input style={inputStyle} value={raci.informed} onChange={(e) => setRaciField("informed", e.target.value)} />
        </Field>
      </div>

      {/* Dependencies — Incoming */}
      <DepSection title="This depends on">
        {incomingEdges.map((e) => (
          <EdgeRow key={e.id} label={nodeName(e.sourceId)} edgeType={e.type} onRemove={() => handleRemoveEdge(e.id)} />
        ))}
        {availableNodes.length > 0 && (
          <select style={{ ...inputStyle, fontSize: 12, marginTop: 4 }} value="" onChange={(e) => { if (e.target.value) handleAddEdge(e.target.value, "incoming"); }}>
            <option value="">+ Add dependency...</option>
            {availableNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}
      </DepSection>

      {/* Dependencies — Outgoing */}
      <DepSection title="Blocks / feeds into">
        {outgoingEdges.map((e) => (
          <EdgeRow key={e.id} label={nodeName(e.targetId)} edgeType={e.type} onRemove={() => handleRemoveEdge(e.id)} />
        ))}
        {availableNodes.length > 0 && (
          <select style={{ ...inputStyle, fontSize: 12, marginTop: 4 }} value="" onChange={(e) => { if (e.target.value) handleAddEdge(e.target.value, "outgoing"); }}>
            <option value="">+ Add outgoing...</option>
            {availableNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}
      </DepSection>

      {/* Save + Delete */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={saveAll} disabled={saveStatus === "saving"} style={{
          flex: 1, padding: 8,
          background: dirty ? "#16a34a" : saveStatus === "saved" ? "#16a34a" : "#414042",
          color: "#fff", border: "none", borderRadius: 4,
          cursor: saveStatus === "saving" ? "wait" : "pointer",
          fontWeight: 600, fontFamily: "Tomorrow, sans-serif",
          opacity: saveStatus === "saving" ? 0.7 : 1,
        }}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" && !dirty ? "Saved" : "Save"}
        </button>
        <button onClick={handleDelete} style={{
          padding: 8, background: "#dc2626", color: "#fff",
          border: "none", borderRadius: 4, cursor: "pointer",
          fontWeight: 600, fontFamily: "Tomorrow, sans-serif",
        }}>
          Delete
        </button>
      </div>
    </aside>
  );
}

function Field({ label, children, flex }: { label: string; children: React.ReactNode; flex?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--rome-text-muted)", ...(flex ? { flex: 1 } : {}) }}>
      {label}
      {children}
    </label>
  );
}

function DepSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: "var(--rome-text-muted)", fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function EdgeRow({ label, edgeType, onRemove }: { label: string; edgeType: string; onRemove: () => void }) {
  const info = EDGE_TYPES[edgeType];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: info?.color ?? "#999", flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, color: "var(--rome-text-muted)", textTransform: "uppercase" }}>{info?.label ?? edgeType}</span>
      <button onClick={onRemove} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14, padding: 0 }}>x</button>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  width: 360, borderLeft: "1px solid var(--rome-border)", background: "var(--rome-surface)",
  padding: 16, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px", background: "#fff", border: "1px solid var(--rome-border)",
  borderRadius: 4, color: "var(--rome-text)", outline: "none", fontSize: 14,
  fontFamily: "Tomorrow, sans-serif", width: "100%",
};

const chipStyle: React.CSSProperties = {
  padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600, letterSpacing: "0.5px",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "var(--rome-text-muted)", fontSize: 20, cursor: "pointer",
};
