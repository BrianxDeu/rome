import { useState, useEffect, useRef, useMemo } from "react";
import { io } from "socket.io-client";
import { useAuthStore } from "../stores/authStore";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import { buildClusterMaps } from "../constants";
import type { PersonalTask, Node, Edge } from "@rome/shared";
import { isGoalNode } from "../utils/graphLayout";

const PRIORITY_COLORS: Record<string, string> = {
  P0: "#1A1A1A",
  P1: "#B81917",
  P2: "#3B82F6",
  P3: "#C0C0C0",
};

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function TasksView() {
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [newText, setNewText] = useState("");
  const [newPriority, setNewPriority] = useState("P1");
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const token = useAuthStore((s) => s.token);
  const [promotingTaskId, setPromotingTaskId] = useState<string | null>(null);
  const [hoveringWs, setHoveringWs] = useState<string | null>(null);
  const [promoteToast, setPromoteToast] = useState<string | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  // --- Graph structure for promote flyout ---
  const graphNodes = useGraphStore((s) => s.nodes);
  const graphEdges = useGraphStore((s) => s.edges);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);

  const { parentMap: graphParentMap, childrenMap: graphChildrenMap } = useMemo(
    () => buildClusterMaps(graphEdges),
    [graphEdges]
  );

  // Workstream headers: top-level nodes with no parent and no workstream field
  const wsHeaders = useMemo(
    () =>
      graphNodes
        .filter((n) => !graphParentMap.has(n.id) && !isGoalNode(n) && !n.workstream && !n.archivedAt)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [graphNodes, graphParentMap]
  );

  // Returns node groups (direct children of a workstream header) for a given ws name
  function nodeGroupsForWs(wsName: string): Node[] {
    const wsHeader = wsHeaders.find((h) => h.name === wsName);
    if (!wsHeader) return [];
    return (graphChildrenMap.get(wsHeader.id) ?? [])
      .map((id) => graphNodes.find((n) => n.id === id))
      .filter((n): n is Node => !!n && !n.archivedAt)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }

  // Fetch tasks on mount
  useEffect(() => {
    api<PersonalTask[]>("/tasks").then((fetched) => {
      fetched.forEach((t) => knownIdsRef.current.add(t.id));
      setTasks(fetched);
    }).catch(console.error);
  }, []);

  function startDeleteTimer(taskId: string) {
    clearDeleteTimer(taskId);
    const timer = setTimeout(async () => {
      try {
        await api(`/tasks/${taskId}`, { method: "DELETE" });
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      } catch (e) {
        console.error("Failed to delete task:", e);
      }
      timersRef.current.delete(taskId);
    }, 60_000);
    timersRef.current.set(taskId, timer);
  }

  function clearDeleteTimer(taskId: string) {
    const existing = timersRef.current.get(taskId);
    if (existing) {
      clearTimeout(existing);
      timersRef.current.delete(taskId);
    }
  }

  // Socket.IO for cross-tab sync
  useEffect(() => {
    if (!token) return;
    const socket = io({ auth: { token } });

    socket.on("task:created", (task: PersonalTask) => {
      if (knownIdsRef.current.has(task.id)) return;
      knownIdsRef.current.add(task.id);
      setTasks((prev) => {
        if (prev.some((t) => t.id === task.id)) return prev;
        return [...prev, task];
      });
    });

    socket.on("task:updated", (payload: { id: string; done: number; doneAt: string | null }) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === payload.id ? { ...t, done: payload.done, doneAt: payload.doneAt } : t))
      );
      // If task was checked via another tab, start the cleanup timer here too
      if (payload.done) {
        startDeleteTimer(payload.id);
      } else {
        clearDeleteTimer(payload.id);
      }
    });

    socket.on("task:deleted", (payload: { id: string }) => {
      setTasks((prev) => prev.filter((t) => t.id !== payload.id));
      clearDeleteTimer(payload.id);
    });

    return () => { socket.disconnect(); };
  }, [token]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  // Close promote flyout on outside click
  useEffect(() => {
    if (!promotingTaskId) return;
    function handleClick(e: MouseEvent) {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as HTMLElement)) {
        setPromotingTaskId(null);
        setHoveringWs(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [promotingTaskId]);

  async function addTask() {
    const text = newText.trim();
    if (!text) return;
    try {
      const task = await api<PersonalTask>("/tasks", {
        method: "POST",
        body: JSON.stringify({ text, priority: newPriority }),
      });
      knownIdsRef.current.add(task.id);
      setTasks((prev) => {
        if (prev.some((t) => t.id === task.id)) return prev;
        return [...prev, task];
      });
      setNewText("");
    } catch (e) {
      console.error("Failed to add task:", e);
    }
  }

  async function promoteTask(task: PersonalTask, wsName: string, nodeGroupId: string) {
    setPromotingTaskId(null);
    setHoveringWs(null);
    try {
      // 1. Create the graph node
      const newNode = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: task.text,
          workstream: wsName,
          status: "not_started",
          priority: task.priority,
        }),
      });

      // 2. parent_of edge: nodeGroup → newNode
      await api("/edges", {
        method: "POST",
        body: JSON.stringify({
          source_id: nodeGroupId,
          target_id: newNode.id,
          type: "parent_of",
        }),
      });

      // 3. produces edge: newNode → nodeGroup
      await api("/edges", {
        method: "POST",
        body: JSON.stringify({
          source_id: newNode.id,
          target_id: nodeGroupId,
          type: "produces",
        }),
      });

      // 4. Delete the personal task
      await api(`/tasks/${task.id}`, { method: "DELETE" });

      // Sync graph store so other views (Board, Kanban) immediately reflect the new node
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);

      // 5. Remove from local task state
      clearDeleteTimer(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));

      // 6. Show confirmation toast
      const ng = graphNodes.find((n) => n.id === nodeGroupId);
      setPromoteToast(`✓ Added to ${wsName} › ${ng?.name ?? ""}`);
      setTimeout(() => setPromoteToast(null), 3000);
    } catch (err) {
      console.error("Failed to promote task:", err);
    }
  }

  async function toggleDone(task: PersonalTask) {
    const newDone = task.done ? false : true;
    try {
      const updated = await api<PersonalTask>(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: newDone }),
      });
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
      if (newDone) {
        startDeleteTimer(task.id);
      } else {
        clearDeleteTimer(task.id);
      }
    } catch (e) {
      console.error("Failed to toggle task:", e);
    }
  }

  // Sort: unchecked first (by priority then newest), then checked at bottom
  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done - b.done;
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  // Start timers for any tasks that are already done on load
  useEffect(() => {
    tasks.forEach((t) => {
      if (t.done && !timersRef.current.has(t.id)) {
        startDeleteTimer(t.id);
      }
    });
  }, [tasks]);

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "40px 20px", overflowY: "auto", flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 300, color: "#414042", letterSpacing: 1 }}>My Tasks</div>
        <div style={{ fontSize: 11, color: "#999", letterSpacing: 0.5 }}>{dateStr}</div>
      </div>

      {promoteToast && (
        <div style={{
          marginBottom: 12, padding: "8px 14px", background: "#FEF2F2", border: "1px solid #FECACA",
          borderRadius: 6, fontSize: 12, color: "#B81917", fontWeight: 500,
        }}>
          {promoteToast}
        </div>
      )}

      {/* Add row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          style={{
            flex: 1, padding: "10px 14px", border: "1px solid #E0E0E0", borderRadius: 8,
            fontSize: 13, fontFamily: "inherit", outline: "none", background: "#fff",
          }}
          placeholder="What needs to get done?"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
          onFocus={(e) => (e.target.style.borderColor = "#B81917")}
          onBlur={(e) => (e.target.style.borderColor = "#E0E0E0")}
        />
        <select
          style={{
            padding: "10px 12px", border: "1px solid #E0E0E0", borderRadius: 8,
            fontSize: 11, fontFamily: "inherit", background: "#fff", color: "#888", minWidth: 60,
          }}
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value)}
        >
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
        <button
          style={{
            padding: "10px 18px", background: "#B81917", color: "#fff", border: "none", borderRadius: 8,
            fontSize: 11, fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit",
          }}
          onClick={addTask}
        >
          Add
        </button>
      </div>

      {/* Task list */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#C0C0C0", fontSize: 13 }}>
          Nothing to do. Add a task above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                background: t.done ? "#FAFAFA" : "#fff", borderRadius: 8,
                border: "1px solid #F0F0F0",
                borderLeft: `3px solid ${PRIORITY_COLORS[t.priority] || "#C0C0C0"}`,
                opacity: t.done ? 0.4 : 1,
                textDecoration: t.done ? "line-through" : "none",
                transition: "all 0.3s",
              }}
            >
              <div
                onClick={() => toggleDone(t)}
                style={{
                  width: 18, height: 18, border: `2px solid ${t.done ? "#B81917" : "#D0D0D0"}`,
                  borderRadius: 4, cursor: "pointer", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: t.done ? "#B81917" : "transparent",
                  color: "#fff", fontSize: 11, fontWeight: 700,
                }}
              >
                {t.done ? "\u2713" : ""}
              </div>
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>{t.text}</div>
              {/* Priority chip + promote button */}
              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3, padding: "2px 6px", borderRadius: 4,
                    color: PRIORITY_COLORS[t.priority] || "#999",
                    background: t.priority === "P0" ? "#F0F0F0" : t.priority === "P1" ? "#FFF0F0" : t.priority === "P2" ? "#F0F6FF" : "#F8F8F8",
                  }}
                >
                  {t.priority}
                </div>

                {!t.done && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPromotingTaskId(promotingTaskId === t.id ? null : t.id);
                      setHoveringWs(null);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 3, padding: "2px 7px",
                      border: `1px solid ${promotingTaskId === t.id ? "#B81917" : "#E0E0E0"}`,
                      borderRadius: 4, fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                      color: promotingTaskId === t.id ? "#B81917" : "#888",
                      background: promotingTaskId === t.id ? "#FFF0F0" : "#FAFAFA",
                    }}
                    title="Promote to project node"
                  >
                    ↗ promote
                  </button>
                )}

                {/* Promote flyout */}
                {promotingTaskId === t.id && (
                  <div
                    ref={flyoutRef}
                    style={{
                      position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 200,
                      display: "flex", background: "#fff",
                      border: "1px solid #E0E0E0", borderRadius: 6,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden",
                      minWidth: 180,
                    }}
                  >
                    {/* Workstream list */}
                    <div style={{ minWidth: 180, borderRight: hoveringWs ? "1px solid #F0F0F0" : "none" }}>
                      <div style={{
                        padding: "7px 12px", fontSize: 10, fontWeight: 600,
                        letterSpacing: 1.5, textTransform: "uppercase", color: "#999",
                        borderBottom: "1px solid #F0F0F0",
                      }}>
                        Move to workstream
                      </div>
                      {wsHeaders.length === 0 ? (
                        <div style={{ padding: "10px 14px", fontSize: 12, color: "#C0C0C0" }}>
                          No workstreams
                        </div>
                      ) : (
                        wsHeaders.map((ws) => (
                          <div
                            key={ws.id}
                            onMouseEnter={() => setHoveringWs(ws.name)}
                            style={{
                              padding: "8px 14px", fontSize: 12, cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "space-between",
                              background: hoveringWs === ws.name ? "#FEF2F2" : "transparent",
                              color: hoveringWs === ws.name ? "#B81917" : "#414042",
                              fontWeight: hoveringWs === ws.name ? 600 : 400,
                            }}
                          >
                            {ws.name}
                            <span style={{ fontSize: 10, color: hoveringWs === ws.name ? "#B81917" : "#C0C0C0" }}>▸</span>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Node group submenu */}
                    {hoveringWs && (
                      <div style={{ minWidth: 160 }}>
                        <div style={{
                          padding: "7px 12px", fontSize: 10, fontWeight: 600,
                          letterSpacing: 1.5, textTransform: "uppercase", color: "#999",
                          borderBottom: "1px solid #F0F0F0",
                        }}>
                          Node group
                        </div>
                        {nodeGroupsForWs(hoveringWs).length === 0 ? (
                          <div style={{ padding: "10px 14px", fontSize: 12, color: "#C0C0C0" }}>
                            No groups
                          </div>
                        ) : (
                          nodeGroupsForWs(hoveringWs).map((ng) => (
                            <div
                              key={ng.id}
                              onClick={() => promoteTask(t, hoveringWs, ng.id)}
                              style={{
                                padding: "8px 14px", fontSize: 12, cursor: "pointer", color: "#414042",
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#B81917"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#414042"; }}
                            >
                              {ng.name}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
