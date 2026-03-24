import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node } from "@rome/shared";

export function NodePanel() {
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const updateNode = useGraphStore((s) => s.updateNode);
  const selectNode = useGraphStore((s) => s.selectNode);

  if (!selectedNode) return null;

  function handleChange(field: keyof Node, value: string) {
    updateNode(selectedNode!.id, { [field]: value });
  }

  async function handleSave() {
    const node = selectedNode!;
    try {
      await api(`/nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: node.title,
          body: node.body,
          type: node.type,
          status: node.status,
        }),
      });
    } catch {
      // API errors handled by api() — 401 auto-logout
    }
  }

  return (
    <aside style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>Edit Node</h3>
        <button style={styles.closeBtn} onClick={() => selectNode(null)}>
          ×
        </button>
      </div>

      <label style={styles.label}>
        Title
        <input
          style={styles.input}
          value={selectedNode.title}
          onChange={(e) => handleChange("title", e.target.value)}
        />
      </label>

      <label style={styles.label}>
        Body
        <textarea
          style={{ ...styles.input, minHeight: "80px", resize: "vertical" }}
          value={selectedNode.body}
          onChange={(e) => handleChange("body", e.target.value)}
        />
      </label>

      <label style={styles.label}>
        Type
        <select
          style={styles.input}
          value={selectedNode.type}
          onChange={(e) => handleChange("type", e.target.value)}
        >
          <option value="default">Default</option>
          <option value="task">Task</option>
          <option value="milestone">Milestone</option>
          <option value="workstream">Workstream</option>
        </select>
      </label>

      <label style={styles.label}>
        Status
        <select
          style={styles.input}
          value={selectedNode.status}
          onChange={(e) => handleChange("status", e.target.value)}
        >
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
          <option value="deferred">Deferred</option>
        </select>
      </label>

      <label style={styles.label}>
        Created by
        <input style={styles.inputReadonly} value={selectedNode.createdBy} readOnly />
      </label>

      <button style={styles.saveBtn} onClick={handleSave}>
        Save
      </button>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: "320px",
    borderLeft: "1px solid var(--rome-border)",
    background: "var(--rome-surface)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 600,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--rome-text-muted)",
    fontSize: "20px",
    cursor: "pointer",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    fontSize: "13px",
    color: "var(--rome-text-muted)",
  },
  input: {
    padding: "8px 10px",
    background: "var(--rome-bg)",
    border: "1px solid var(--rome-border)",
    borderRadius: "4px",
    color: "var(--rome-text)",
    outline: "none",
    fontSize: "14px",
  },
  inputReadonly: {
    padding: "8px 10px",
    background: "var(--rome-bg)",
    border: "1px solid var(--rome-border)",
    borderRadius: "4px",
    color: "var(--rome-text-muted)",
    outline: "none",
    fontSize: "14px",
  },
  saveBtn: {
    padding: "8px",
    background: "var(--rome-red)",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: 600,
    marginTop: "8px",
  },
};
