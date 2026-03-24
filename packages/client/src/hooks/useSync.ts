import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { useGraphStore } from "../stores/graphStore";
import type { Node, Edge } from "@rome/shared";

interface Delta {
  type: "node:create" | "node:update" | "node:delete" | "edge:create" | "edge:delete";
  payload: Record<string, unknown>;
}

export function useSync() {
  const token = useAuthStore((s) => s.token);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const delta: Delta = JSON.parse(event.data);
      const store = useGraphStore.getState();

      switch (delta.type) {
        case "node:create":
          store.addNode(delta.payload as unknown as Node);
          break;
        case "node:update": {
          const { id, ...patch } = delta.payload as { id: string } & Partial<Node>;
          store.updateNode(id, patch);
          break;
        }
        case "node:delete":
          store.removeNode(delta.payload.id as string);
          break;
        case "edge:create":
          store.addEdge(delta.payload as unknown as Edge);
          break;
        case "edge:delete":
          store.removeEdge(delta.payload.id as string);
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [token]);
}
