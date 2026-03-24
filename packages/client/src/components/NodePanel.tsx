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
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (selectedNode) {
      setForm({ ...selectedNode });
      setDirty(false);
      setSaveStatus("idle");
    }
  }, [selectedNode]);

  if (!selectedNode) return null;

  function set(field: keyof Node, value: any) {
    setForm((prev) => ({ ...prev, [field]: value }));
    updateNode(selectedNode!.id, { [field]: value } as any);
    setDirty(true);
    setSaveStatus("idle");
  }

  async function saveAll() {
    setSaveStatus("saving");
    try {
      const body: Record<string, unknown> = {};
      body.name = form.name;
      body.status = form.status;
      body.priority = form.priority;
      body.start_date = form.startDate || null;
      body.end_date = form.endDate || null;
      body.budget = form.budget ?? null;
      body.deliverable = form.deliverable || null;
      body.notes = form.notes || null;
      body.raci = form.raci || null;
      body.workstream = form.workstream || null;

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
        <input style={inputStyle} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <Field label="Status" flex>
          <select style={inputStyle} value={form.status ?? "not_started"} onChange={(e) => set("status", e.target.value)}>
            {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </Field>
        <Field label="Priority" flex>
          <select style={inputStyle} value={form.priority ?? "P2"} onChange={(e) => set("priority", e.target.value)}>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
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

      <Field label="RACI (JSON)">
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontSize: 12 }} value={form.raci ?? ""} onChange={(e) => set("raci", e.target.value)} />
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={saveAll} disabled={saveStatus === "saving"} style={{
          flex: 1, padding: 8, background: dirty ? "#B81917" : "#414042", color: "#fff",
          border: "none", borderRadius: 4, cursor: saveStatus === "saving" ? "wait" : "pointer",
          fontWeight: 600, fontFamily: "Tomorrow, sans-serif", opacity: saveStatus === "saving" ? 0.7 : 1,
        }}>
          {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" && !dirty ? "Saved" : "Save"}
        </button>
        <button onClick={handleDelete} style={{
          padding: 8, background: "#dc2626", color: "#fff",
          border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600, fontFamily: "Tomorrow, sans-serif",
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
