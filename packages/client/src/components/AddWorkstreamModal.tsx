import { useState } from "react";
import { api } from "../api";
import { useGraphStore } from "../stores/graphStore";
import type { Node } from "@rome/shared";
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

interface AddWorkstreamModalProps {
  onClose: () => void;
}

const WS_PALETTE = ["#B81917", "#3B82F6", "#8B5CF6", "#16a34a", "#f59e0b", "#06b6d4", "#ec4899"];

export function AddWorkstreamModal({ onClose }: AddWorkstreamModalProps) {
  const addNode = useGraphStore((s) => s.addNode);
  const nodes = useGraphStore((s) => s.nodes);

  const existingWorkstreams = [...new Set(nodes.map((n) => n.workstream).filter(Boolean))].sort();
  const nextColorIdx = existingWorkstreams.length % WS_PALETTE.length;
  const assignedColor = WS_PALETTE[nextColorIdx];

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Create a workstream header node — name IS the workstream display name
      // workstream field is null (matching production data pattern — ws headers sit above the hierarchy)
      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          priority: "P2",
          status: "not_started",
        }),
      });
      addNode(node);
      // Refetch to ensure the new node is picked up consistently
      const graph = await api<{ nodes: Node[]; edges: import("@rome/shared").Edge[] }>("/graph");
      const setNodes = useGraphStore.getState().setNodes;
      const setEdges = useGraphStore.getState().setEdges;
      setNodes(graph.nodes);
      setEdges(graph.edges);
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[380px] font-[Tomorrow]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="font-[Tomorrow] text-[15px] font-bold">Add Workstream</DialogTitle>
        </DialogHeader>

        <div>
          <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Workstream Name *</Label>
          <Input
            autoFocus
            className="font-[Tomorrow] text-[13px]"
            placeholder="e.g. Design, Engineering, Marketing..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Preview with auto-assigned color */}
        <div className="flex items-center gap-2 rounded-md bg-[#FAFAFA] p-2.5">
          <div className="h-3 w-3 shrink-0 rounded-sm" style={{ background: assignedColor }} />
          <span className="font-[Tomorrow] text-[13px] font-semibold" style={{ color: assignedColor }}>
            {name.trim() || "New Workstream"}
          </span>
          <span className="ml-auto text-[9px] text-[#999]">color auto-assigned</span>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" size="sm" className="font-[Tomorrow] text-xs" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="font-[Tomorrow] text-xs font-semibold"
            style={{ background: "#B81917" }}
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
          >
            {saving ? "Creating..." : "Create Workstream"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
