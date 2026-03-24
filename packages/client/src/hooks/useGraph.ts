import { useEffect } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import { useAuthStore } from "../stores/authStore";
import type { Node, Edge } from "@rome/shared";

export function useGraph() {
  const token = useAuthStore((s) => s.token);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);

  useEffect(() => {
    if (!token) return;

    api<{ nodes: Node[]; edges: Edge[] }>("/graph").then(({ nodes, edges }) => {
      setNodes(nodes);
      setEdges(edges);
    }).catch(console.error);
  }, [token, setNodes, setEdges]);
}
