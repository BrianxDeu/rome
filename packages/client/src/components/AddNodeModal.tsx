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

interface AddNodeModalProps {
  defaultWorkstream?: string;
  defaultClusterId?: string;
  onClose: () => void;
}

const PRESET_PRIORITIES = ["P0", "P1", "P2", "P3"];

export function AddNodeModal({ defaultWorkstream, defaultClusterId, onClose }: AddNodeModalProps) {
  const addNode = useGraphStore((s) => s.addNode);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);

  const { parentMap, childrenMap } = useMemo(() => buildClusterMaps(edges), [edges]);

  // Build hierarchy for the "Place under" dropdown
  const hierarchy = useMemo(() => {
    // Workstream headers: no parent, no ws field, not goal
    const wsHeaders = nodes.filter((n) => !parentMap.has(n.id) && !isGoalNode(n) && !n.workstream);
    const groups: Array<{ wsHeader: Node; nodeGroups: Node[] }> = [];

    for (const ws of wsHeaders) {
      const ngIds = childrenMap.get(ws.id) ?? [];
      const nodeGroups = ngIds
        .map((id) => nodes.find((n) => n.id === id))
        .filter(Boolean) as Node[];
      groups.push({ wsHeader: ws, nodeGroups });
    }
    return groups;
  }, [nodes, parentMap, childrenMap]);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(defaultClusterId ?? "");
  const [priority, setPriority] = useState("P2");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [responsible, setResponsible] = useState("");
  const [saving, setSaving] = useState(false);

  // Resolve workstream from selected parent
  const resolvedWorkstream = useMemo(() => {
    if (defaultWorkstream) return defaultWorkstream;
    if (!parentId) return "";
    // Check if parentId is a workstream header
    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) return "";
    // If parent has workstream field, use it. Otherwise parent IS the workstream header — use its name.
    return parentNode.workstream || parentNode.name;
  }, [parentId, nodes, defaultWorkstream]);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        workstream: resolvedWorkstream || null,
        priority,
        status: "not_started",
      };
      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;
      if (budget) body.budget = Number(budget);
      if (responsible.trim()) {
        body.raci = { responsible: responsible.trim() };
      }

      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify(body),
      });

      // Create parent_of edge if a parent is selected
      const effectiveParent = defaultClusterId || parentId;
      if (effectiveParent) {
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: effectiveParent, target_id: node.id, type: "parent_of" }),
        });
        // Also create produces edge: node → parent (feeds into)
        await api<Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({ source_id: node.id, target_id: effectiveParent, type: "produces" }),
        });
      }

      // Refetch for consistency
      const graph = await api<{ nodes: Node[]; edges: Edge[] }>("/graph");
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
    if (e.key === "Enter" && step < 5) {
      e.preventDefault();
      advance();
    }
    if (e.key === "Enter" && step === 5) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function advance() {
    if (step === 0 && !name.trim()) return;
    setStep((s) => Math.min(s + 1, 5));
  }

  const steps = [
    { label: "Name", required: true },
    { label: "Place under", required: false },
    { label: "Priority", required: false },
    { label: "Dates", required: false },
    { label: "Budget", required: false },
    { label: "Responsible", required: false },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[400px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold">Add Node</DialogTitle>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5">
          {steps.map((s, i) => (
            <div
              key={i}
              className="h-2 w-2 rounded-full transition-colors"
              style={{
                background: i <= step ? "#B81917" : "#E7E7E7",
                cursor: i <= step ? "pointer" : "default",
              }}
              onClick={() => { if (i <= step) setStep(i); }}
              title={s.label}
            />
          ))}
        </div>

        {/* Step 0: Name */}
        {step >= 0 && (
          <div>
            <Label className="mb-1 text-[11px] text-[#999]">Name *</Label>
            <Input
              autoFocus={step === 0}
              className="text-[13px]"
              placeholder="What needs to be done?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        {/* Step 1: Place under (workstream or node group) */}
        {step >= 1 && !defaultClusterId && (
          <div>
            <Label className="mb-1 text-[11px] text-[#999]">Place under</Label>
            <select
              className="w-full rounded-md border border-[#E0E0E0] bg-white px-3 py-2 text-[13px]"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              autoFocus={step === 1}
            >
              <option value="">None (standalone)</option>
              {hierarchy.map(({ wsHeader, nodeGroups }) => (
                <optgroup key={wsHeader.id} label={wsHeader.name}>
                  <option value={wsHeader.id}>↳ {wsHeader.name} (workstream)</option>
                  {nodeGroups.map((ng) => (
                    <option key={ng.id} value={ng.id}>↳ ↳ {ng.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {resolvedWorkstream && (
              <div className="mt-1 text-[10px] text-[#999]">Workstream: {resolvedWorkstream}</div>
            )}
          </div>
        )}

        {/* Step 2: Priority */}
        {step >= 2 && (
          <div>
            <Label className="mb-1 text-[11px] text-[#999]">Priority</Label>
            <div className="flex gap-1.5">
              {PRESET_PRIORITIES.map((p) => (
                <Button
                  key={p}
                  variant={priority === p ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs font-semibold"
                  style={priority === p ? { background: "#B81917", borderColor: "#B81917" } : {}}
                  onClick={() => setPriority(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Dates */}
        {step >= 3 && (
          <div>
            <Label className="mb-1 text-[11px] text-[#999]">Dates</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                autoFocus={step === 3}
                type="date"
                className="text-[13px]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="Start"
              />
              <Input
                type="date"
                className="text-[13px]"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder="End"
              />
            </div>
          </div>
        )}

        {/* Step 4: Budget */}
        {step >= 4 && (
          <div>
            <Label className="mb-1 text-[11px] text-[#999]">Budget</Label>
            <Input
              autoFocus={step === 4}
              type="number"
              className="text-[13px]"
              placeholder="$0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        )}

        {/* Step 5: Responsible */}
        {step >= 5 && (
          <div>
            <Label className="mb-1 text-[11px] text-[#999]">Responsible</Label>
            <Input
              autoFocus={step === 5}
              className="text-[13px]"
              placeholder="Who owns this?"
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <DialogFooter className="flex-row justify-end gap-2">
          {step < 5 && (
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setStep(5)}>
              Skip to end
            </Button>
          )}
          {step < 5 ? (
            <Button
              size="sm"
              className="text-xs font-semibold"
              style={{ background: "#B81917" }}
              onClick={(e) => { e.stopPropagation(); advance(); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={step === 0 && !name.trim()}
            >
              Next
            </Button>
          ) : (
            <Button
              size="sm"
              className="text-xs font-semibold"
              style={{ background: "#B81917" }}
              onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!name.trim() || saving}
            >
              {saving ? "Adding..." : "Add Node"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
