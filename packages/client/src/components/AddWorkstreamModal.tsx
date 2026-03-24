import { useState } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import type { Node } from "@rome/shared";

interface AddWorkstreamModalProps {
  onClose: () => void;
}

const PRESET_COLORS = [
  { name: "Red", hex: "#B81917" },
  { name: "Blue", hex: "#3B82F6" },
  { name: "Purple", hex: "#8B5CF6" },
  { name: "Green", hex: "#16a34a" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Cyan", hex: "#06b6d4" },
];

export function AddWorkstreamModal({ onClose }: AddWorkstreamModalProps) {
  const addNode = useGraphStore((s) => s.addNode);

  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0].hex);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Create a workstream header node — the workstream name IS the node name
      // and the workstream field groups it on the board
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          workstream: name.trim(),
          priority: "P2",
          status: "not_started",
        }),
      });
      addNode(node);
      onClose();
    } catch {
      // api() handles errors
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div style={header}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Add Workstream</span>
          <button style={closeBtn} onClick={onClose}>&times;</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Workstream Name *</label>
          <input
            autoFocus
            style={inputStyle}
            placeholder="e.g. Design, Engineering, Marketing..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Color</label>
          <div style={{ display: "flex", gap: 10 }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                title={c.name}
                onClick={() => setSelectedColor(c.hex)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: c.hex,
                  border: selectedColor === c.hex ? "3px solid #1A1A1A" : "3px solid transparent",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                }}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        {name.trim() && (
          <div style={{ marginBottom: 16, padding: "10px 12px", background: "#FAFAFA", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: selectedColor, flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: selectedColor, fontFamily: "Tomorrow, sans-serif" }}>
              {name.trim()}
            </span>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={cancelBtn} onClick={onClose}>Cancel</button>
          <button
            style={{ ...actionBtn, opacity: !name.trim() || saving ? 0.5 : 1 }}
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
          >
            {saving ? "Creating..." : "Create Workstream"}
          </button>
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
  width: 380,
  boxShadow: "0 8px 30px rgba(0,0,0,0.2)",
  fontFamily: "Tomorrow, sans-serif",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 20,
  cursor: "pointer",
  color: "#999",
  lineHeight: 1,
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

const cancelBtn: React.CSSProperties = {
  padding: "8px 16px",
  background: "none",
  color: "#999",
  border: "1px solid #E7E7E7",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontFamily: "Tomorrow, sans-serif",
};
