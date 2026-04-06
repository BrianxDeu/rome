import { useState, useMemo } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import type { Node, Edge } from "@rome/shared";
import { buildClusterMaps } from "../constants";
import { isGoalNode } from "../utils/graphLayout";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface AddNodeGroupModalProps {
  onClose: () => void;
}

export function AddNodeGroupModal({ onClose }: AddNodeGroupModalProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);

  const [name, setName] = useState("");
  const [selectedWs, setSelectedWs] = useState("");
  const [saving, setSaving] = useState(false);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Find workstream header nodes (top-level, ws=null, has children or name matches ws field)
  const wsHeaders = useMemo(() => {
    const wsFieldValues = new Set<string>();
    for (const n of nodes) {
      if (n.workstream) wsFieldValues.add(n.workstream);
    }
    return nodes.filter((n) => {
      if (parentMap.has(n.id) || isGoalNode(n) || n.workstream) return false;
      if ((childrenMap.get(n.id)?.length ?? 0) > 0) return true;
      if (wsFieldValues.has(n.name)) return true;
      return false;
    });
  }, [nodes, parentMap, childrenMap]);

  async function handleSubmit() {
    if (!name.trim() || !selectedWs) return;
    setSaving(true);
    try {
      const wsHeader = nodes.find((n) => n.id === selectedWs);
      if (!wsHeader) return;

      // Create the node group with workstream field matching the ws header name
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          workstream: wsHeader.name,
          priority: "P1",
          status: "not_started",
        }),
      });

      // parent_of edge: workstream header → node group
      await api<Edge>("/edges", {
        method: "POST",
        body: JSON.stringify({ source_id: wsHeader.id, target_id: node.id, type: "parent_of" }),
      });

      // sequence edge: node group → workstream header (feeds into)
      await api<Edge>("/edges", {
        method: "POST",
        body: JSON.stringify({ source_id: node.id, target_id: wsHeader.id, type: "produces" }),
      });

      // Refetch
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
      setNodes(graph.nodes);
      setEdges(graph.edges);
      onClose();
    } catch (err) {
      console.error("Failed to create node group:", err);
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[380px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold">Add Node Group</DialogTitle>
        </DialogHeader>

        <div>
          <Label className="mb-1 text-[11px] text-[#999]">Group Name *</Label>
          <Input
            autoFocus
            className="text-[13px]"
            placeholder="e.g. Key Results, Milestones..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <Label className="mb-1 text-[11px] text-[#999]">Under Workstream *</Label>
          <select
            className="w-full rounded-md border border-[#E0E0E0] bg-white px-3 py-2 text-[13px]"
            value={selectedWs}
            onChange={(e) => setSelectedWs(e.target.value)}
          >
            <option value="">Select workstream...</option>
            {wsHeaders.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="text-xs font-semibold"
            style={{ background: "#B81917" }}
            onClick={handleSubmit}
            disabled={!name.trim() || !selectedWs || saving}
          >
            {saving ? "Creating..." : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
