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

        <div>
          <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Color</Label>
          <div className="flex gap-2.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                title={c.name}
                onClick={() => setSelectedColor(c.hex)}
                className="h-8 w-8 rounded-md transition-all"
                style={{
                  background: c.hex,
                  border: selectedColor === c.hex ? "3px solid #1A1A1A" : "3px solid transparent",
                }}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        {name.trim() && (
          <div className="flex items-center gap-2 rounded-md bg-[#FAFAFA] p-2.5">
            <div className="h-3 w-3 shrink-0 rounded-sm" style={{ background: selectedColor }} />
            <span className="font-[Tomorrow] text-[13px] font-semibold" style={{ color: selectedColor }}>
              {name.trim()}
            </span>
          </div>
        )}

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
