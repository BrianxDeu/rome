import { useState, useEffect } from "react";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node } from "@rome/shared";

const statuses = ["not_started", "in_progress", "blocked", "done", "cancelled"];
const priorities = ["P0", "P1", "P2", "P3"];

export function NodePanel() {
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const selectNode = useGraphStore((s) => s.selectNode);

  const [form, setForm] = useState<Partial<Node>>({});

  useEffect(() => {
    if (selectedNode) setForm({ ...selectedNode });
  }, [selectedNode]);

  if (!selectedNode) return null;

  function set(field: keyof Node, value: any) {
    setForm((prev) => ({ ...prev, [field]: value }));
    updateNode(selectedNode!.id, { [field]: value } as any);
  }

  async function save(field: string, value: any) {
    try {
      await api(`/nodes/${selectedNode!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
    } catch {
      // handled by api()
    }
  }

  async function handleDelete() {
    try {
      await api(`/nodes/${selectedNode!.id}`, { method: "DELETE" });
      selectNode(null);
    } catch {
      // handled by api()
    }
  }

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    background: "#fff",
    border: "1px solid var(--rome-border)",
    borderRadius: 4,
    color: "var(--rome-text)",
    outline: "none",
    fontSize: 14,
    fontFamily: "Tomorrow, sans-serif",
  };

  return (
    <aside style={{
      width: 360, borderLeft: "1px solid var(--rome-border)", background: "var(--rome-surface)",
      padding: 16, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Edit Node</h3>
        <button onClick={() => selectNode(null)} style={{ background: "none", border: "none", color: "var(--rome-text-muted)", fontSize: 20, cursor: "pointer" }}>×</button>
      </div>

      <Field label="Name">
        <input style={inputStyle} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} onBlur={(e) => save("name", e.target.value)} />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Status" flex>
          <select style={inputStyle} value={form.status ?? "not_started"} onChange={(e) => { set("status", e.target.value); save("status", e.target.value); }}>
            {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </Field>
        <Field label="Priority" flex>
          <select style={inputStyle} value={form.priority ?? "P2"} onChange={(e) => { set("priority", e.target.value); save("priority", e.target.value); }}>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Workstream">
        <input style={inputStyle} value={form.workstream ?? ""} onChange={(e) => set("workstream", e.target.value)} onBlur={(e) => save("workstream", e.target.value || null)} />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Start Date" flex>
          <input type="date" style={inputStyle} value={form.startDate ?? ""} onChange={(e) => { set("startDate", e.target.value || null); save("startDate", e.target.value || null); }} />
        </Field>
        <Field label="End Date" flex>
          <input type="date" style={inputStyle} value={form.endDate ?? ""} onChange={(e) => { set("endDate", e.target.value || null); save("endDate", e.target.value || null); }} />
        </Field>
      </div>

      <Field label="Budget (USD)">
        <input type="number" style={inputStyle} value={form.budget ?? ""} onChange={(e) => set("budget", e.target.value ? Number(e.target.value) : null)} onBlur={(e) => save("budget", e.target.value ? Number(e.target.value) : null)} />
      </Field>

      <Field label="Deliverable">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.deliverable ?? ""} onChange={(e) => set("deliverable", e.target.value)} onBlur={(e) => save("deliverable", e.target.value || null)} />
      </Field>

      <Field label="Notes">
        <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} onBlur={(e) => save("notes", e.target.value || null)} />
      </Field>

      <Field label="RACI (JSON)">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontSize: 12 }} value={form.raci ?? ""} onChange={(e) => set("raci", e.target.value)} onBlur={(e) => save("raci", e.target.value || null)} />
      </Field>

      <button onClick={handleDelete} style={{
        marginTop: 8, padding: 8, background: "#dc2626", color: "#fff",
        border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600, fontFamily: "Tomorrow, sans-serif",
      }}>
        Delete Node
      </button>
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
