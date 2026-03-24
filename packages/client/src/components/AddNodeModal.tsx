import { useState } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import type { Node } from "@rome/shared";

interface AddNodeModalProps {
  defaultWorkstream?: string;
  defaultClusterId?: string;
  onClose: () => void;
}

const PRESET_PRIORITIES = ["P0", "P1", "P2", "P3"];

export function AddNodeModal({ defaultWorkstream, defaultClusterId, onClose }: AddNodeModalProps) {
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const nodes = useGraphStore((s) => s.nodes);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [workstream, setWorkstream] = useState(defaultWorkstream ?? "");
  const [priority, setPriority] = useState("P2");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [responsible, setResponsible] = useState("");
  const [saving, setSaving] = useState(false);

  // Derive existing workstream names for suggestions
  const existingWorkstreams = Array.from(new Set(nodes.map((n) => n.workstream).filter(Boolean))) as string[];

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        workstream: workstream.trim() || null,
        priority,
        status: "not_started",
      };
      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;
      if (budget) body.budget = Number(budget);
      if (responsible.trim()) {
        body.raci = JSON.stringify({ responsible: responsible.trim() });
      }

      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify(body),
      });
      addNode(node);

      // If adding inside a cluster, create parent_of edge
      if (defaultClusterId) {
        const edge = await api<import("@rome/shared").Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({
            source_id: defaultClusterId,
            target_id: node.id,
            type: "parent_of",
          }),
        });
        addEdge(edge);
      }

      onClose();
    } catch {
      // api() handles errors
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && step < 5) {
      e.preventDefault();
      advance();
    }
    if (e.key === "Enter" && step === 5) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function advance() {
    if (step === 0 && !name.trim()) return;
    setStep((s) => Math.min(s + 1, 5));
  }

  const steps = [
    { label: "Name", required: true },
    { label: "Workstream", required: false },
    { label: "Priority", required: false },
    { label: "Dates", required: false },
    { label: "Budget", required: false },
    { label: "Responsible", required: false },
  ];

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div style={header}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Add Node</span>
          <button style={closeBtn} onClick={onClose}>&times;</button>
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, justifyContent: "center" }}>
          {steps.map((s, i) => (
            <div
              key={i}
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: i <= step ? "#B81917" : "#E7E7E7",
                cursor: i <= step ? "pointer" : "default",
                transition: "background 0.2s",
              }}
              onClick={() => { if (i <= step) setStep(i); }}
              title={s.label}
            />
          ))}
        </div>

        {/* Step 0: Name */}
        {step >= 0 && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Name *</label>
            <input
              autoFocus={step === 0}
              style={inputStyle}
              placeholder="What needs to be done?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        {/* Step 1: Workstream */}
        {step >= 1 && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Workstream</label>
            <input
              autoFocus={step === 1}
              style={inputStyle}
              list="ws-suggestions"
              placeholder="e.g. Design, Engineering..."
              value={workstream}
              onChange={(e) => setWorkstream(e.target.value)}
            />
            <datalist id="ws-suggestions">
              {existingWorkstreams.map((ws) => (
                <option key={ws} value={ws} />
              ))}
            </datalist>
          </div>
        )}

        {/* Step 2: Priority */}
        {step >= 2 && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Priority</label>
            <div style={{ display: "flex", gap: 6 }}>
              {PRESET_PRIORITIES.map((p) => (
                <button
                  key={p}
                  style={{
                    ...priorityBtn,
                    background: priority === p ? "#B81917" : "#F5F5F5",
                    color: priority === p ? "#fff" : "#1A1A1A",
                  }}
                  onClick={() => setPriority(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Dates */}
        {step >= 3 && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Dates</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input
                autoFocus={step === 3}
                type="date"
                style={inputStyle}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="Start"
              />
              <input
                type="date"
                style={inputStyle}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="End"
              />
            </div>
          </div>
        )}

        {/* Step 4: Budget */}
        {step >= 4 && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Budget</label>
            <input
              autoFocus={step === 4}
              type="number"
              style={inputStyle}
              placeholder="$0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        )}

        {/* Step 5: Responsible */}
        {step >= 5 && (
          <div style={fieldGroup}>
            <label style={labelStyle}>Responsible</label>
            <input
              autoFocus={step === 5}
              style={inputStyle}
              placeholder="Who owns this?"
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          {step < 5 && (
            <button style={skipBtn} onClick={() => setStep(5)}>
              Skip to end
            </button>
          )}
          {step < 5 ? (
            <button
              style={{ ...actionBtn, opacity: step === 0 && !name.trim() ? 0.5 : 1 }}
              onClick={advance}
              disabled={step === 0 && !name.trim()}
            >
              Next
            </button>
          ) : (
            <button
              style={{ ...actionBtn, opacity: !name.trim() || saving ? 0.5 : 1 }}
              onClick={handleSubmit}
              disabled={!name.trim() || saving}
            >
              {saving ? "Adding..." : "Add Node"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  padding: "20px 24px",
  width: 400,
  maxHeight: "80vh",
  overflowY: "auto",
  boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
  fontFamily: "Tomorrow, sans-serif",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 20,
  cursor: "pointer",
  color: "#999",
  lineHeight: 1,
};

const fieldGroup: React.CSSProperties = {
  marginBottom: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#999",
  letterSpacing: 0.5,
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#FAFAFA",
  border: "1px solid #E7E7E7",
  borderRadius: 4,
  fontFamily: "Tomorrow, sans-serif",
  fontSize: 13,
  color: "#1A1A1A",
  outline: "none",
  boxSizing: "border-box",
};

const priorityBtn: React.CSSProperties = {
  flex: 1,
  padding: "6px 0",
  border: "1px solid #E7E7E7",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "Tomorrow, sans-serif",
};

const actionBtn: React.CSSProperties = {
  padding: "8px 20px",
  background: "#B81917",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "Tomorrow, sans-serif",
};

const skipBtn: React.CSSProperties = {
  padding: "8px 16px",
  background: "none",
  color: "#999",
  border: "1px solid #E7E7E7",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "Tomorrow, sans-serif",
};
