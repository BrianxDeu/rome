import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { useAuthStore } from "../stores/authStore";
import { api } from "../api";
import type { PersonalTask } from "@rome/shared";

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
    <div style={{ maxWidth: 600, margin: "40px auto", padding: "0 20px", fontFamily: "Tomorrow, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 300, color: "#414042", letterSpacing: 1 }}>My Tasks</div>
        <div style={{ fontSize: 11, color: "#999", letterSpacing: 0.5 }}>{dateStr}</div>
      </div>

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
          ADD
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
              <div
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "2px 6px", borderRadius: 4,
                  color: PRIORITY_COLORS[t.priority] || "#999",
                  background: t.priority === "P0" ? "#F0F0F0" : t.priority === "P1" ? "#FFF0F0" : t.priority === "P2" ? "#F0F6FF" : "#F8F8F8",
                }}
              >
                {t.priority}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
