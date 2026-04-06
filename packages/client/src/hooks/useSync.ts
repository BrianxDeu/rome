import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "../stores/authStore";
import { useGraphStore } from "../stores/graphStore";
import { api } from "../api";
import type { Node, Edge } from "@rome/shared";

export function useSync() {
  const token = useAuthStore((s) => s.token);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = io({
      auth: { token },
    });
    socketRef.current = socket;

    socket.on("node:created", (payload: Node) => {
      useGraphStore.getState().addNode(payload);
    });

    socket.on("node:updated", (payload: { id: string } & Partial<Node>) => {
      const { id, ...patch } = payload;
      useGraphStore.getState().updateNode(id, patch);
    });

    socket.on("node:deleted", (payload: { id: string }) => {
      useGraphStore.getState().removeNode(payload.id);
    });

    socket.on("edge:created", (payload: Edge) => {
      useGraphStore.getState().addEdge(payload);
    });

    socket.on("edge:deleted", (payload: { id: string }) => {
      useGraphStore.getState().removeEdge(payload.id);
    });

    socket.on("graph:refetch", () => {
      api<{ nodes: Node[]; edges: Edge[] }>("/graph").then(({ nodes, edges }) => {
        useGraphStore.getState().setNodes(nodes);
        useGraphStore.getState().setEdges(edges);
      }).catch(console.error);
    });

    // Refetch graph on reconnect to catch any changes missed while disconnected
    socket.on("connect", () => {
      if (socketRef.current) {
        api<{ nodes: Node[]; edges: Edge[] }>("/graph").then(({ nodes, edges }) => {
          useGraphStore.getState().setNodes(nodes);
          useGraphStore.getState().setEdges(edges);
        }).catch(console.error);
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);
}
