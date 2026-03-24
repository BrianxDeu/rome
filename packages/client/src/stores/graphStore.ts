import { create } from "zustand";
import type { Node, Edge } from "@rome/shared";

interface Filters {
  status: string | null;
  workstream: string | null;
  responsible: string | null;
}

interface GraphState {
  nodes: Node[];
  edges: Edge[];
  selectedNode: Node | null;
  filters: Filters;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  selectNode: (node: Node | null) => void;
  updateNode: (id: string, patch: Partial<Node>) => void;
  removeNode: (id: string) => void;
  addNode: (node: Node) => void;
  addEdge: (edge: Edge) => void;
  removeEdge: (id: string) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  filters: { status: null, workstream: null, responsible: null },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  selectNode: (node) => set({ selectedNode: node }),

  updateNode: (id, patch) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      selectedNode:
        state.selectedNode?.id === id
          ? { ...state.selectedNode, ...patch }
          : state.selectedNode,
    })),

  removeNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.sourceId !== id && e.targetId !== id),
      selectedNode: state.selectedNode?.id === id ? null : state.selectedNode,
    })),

  addNode: (node) =>
    set((state) => ({ nodes: [...state.nodes, node] })),

  addEdge: (edge) =>
    set((state) => ({ edges: [...state.edges, edge] })),

  removeEdge: (id) =>
    set((state) => ({ edges: state.edges.filter((e) => e.id !== id) })),

  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value } })),
}));
