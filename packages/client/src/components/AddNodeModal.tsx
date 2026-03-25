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

interface AddNodeModalProps {
  defaultWorkstream?: string;
  defaultClusterId?: string;
  onClose: () => void;
}

const PRESET_PRIORITIES = ["P0", "P1", "P2", "P3"];

export function AddNodeModal({ defaultWorkstream, defaultClusterId, onClose }: AddNodeModalProps) {
  const addNode = useGraphStore((s) => s.addNode);
  const addEdge = useGraphStore((s) => s.addEdge);
  const nodes = useGraphStore((s) => s.nodes);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [workstream, setWorkstream] = useState(defaultWorkstream ?? "");
  const [priority, setPriority] = useState("P2");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [responsible, setResponsible] = useState("");
  const [saving, setSaving] = useState(false);

  // Derive existing workstream names for suggestions
  const existingWorkstreams = Array.from(new Set(nodes.map((n) => n.workstream).filter(Boolean))) as string[];

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        workstream: workstream.trim() || null,
        priority,
        status: "not_started",
      };
      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;
      if (budget) body.budget = Number(budget);
      if (responsible.trim()) {
        body.raci = JSON.stringify({ responsible: responsible.trim() });
      }

      const node = await api<Node>("/nodes", {
        method: "POST",
        body: JSON.stringify(body),
      });
      addNode(node);

      // If adding inside a cluster, create parent_of edge
      if (defaultClusterId) {
        const edge = await api<import("@rome/shared").Edge>("/edges", {
          method: "POST",
          body: JSON.stringify({
            source_id: defaultClusterId,
            target_id: node.id,
            type: "parent_of",
          }),
        });
        addEdge(edge);
      }

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
    { label: "Workstream", required: false },
    { label: "Priority", required: false },
    { label: "Dates", required: false },
    { label: "Budget", required: false },
    { label: "Responsible", required: false },
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[400px] font-[Tomorrow]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="font-[Tomorrow] text-[15px] font-bold">Add Node</DialogTitle>
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
            <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Name *</Label>
            <Input
              autoFocus={step === 0}
              className="font-[Tomorrow] text-[13px]"
              placeholder="What needs to be done?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        {/* Step 1: Workstream */}
        {step >= 1 && (
          <div>
            <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Workstream</Label>
            <Input
              autoFocus={step === 1}
              className="font-[Tomorrow] text-[13px]"
              list="ws-suggestions"
              placeholder="e.g. Design, Engineering..."
              value={workstream}
              onChange={(e) => setWorkstream(e.target.value)}
            />
            <datalist id="ws-suggestions">
              {existingWorkstreams.map((ws) => (
                <option key={ws} value={ws} />
              ))}
            </datalist>
          </div>
        )}

        {/* Step 2: Priority */}
        {step >= 2 && (
          <div>
            <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Priority</Label>
            <div className="flex gap-1.5">
              {PRESET_PRIORITIES.map((p) => (
                <Button
                  key={p}
                  variant={priority === p ? "default" : "outline"}
                  size="sm"
                  className="flex-1 font-[Tomorrow] text-xs font-semibold"
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
            <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Dates</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                autoFocus={step === 3}
                type="date"
                className="font-[Tomorrow] text-[13px]"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                placeholder="Start"
              />
              <Input
                type="date"
                className="font-[Tomorrow] text-[13px]"
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
            <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Budget</Label>
            <Input
              autoFocus={step === 4}
              type="number"
              className="font-[Tomorrow] text-[13px]"
              placeholder="$0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        )}

        {/* Step 5: Responsible */}
        {step >= 5 && (
          <div>
            <Label className="mb-1 text-[10px] uppercase tracking-wider text-[#999]">Responsible</Label>
            <Input
              autoFocus={step === 5}
              className="font-[Tomorrow] text-[13px]"
              placeholder="Who owns this?"
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
            />
          </div>
        )}

        {/* Actions */}
        <DialogFooter className="flex-row justify-end gap-2">
          {step < 5 && (
            <Button variant="outline" size="sm" className="font-[Tomorrow] text-xs" onClick={() => setStep(5)}>
              Skip to end
            </Button>
          )}
          {step < 5 ? (
            <Button
              size="sm"
              className="font-[Tomorrow] text-xs font-semibold"
              style={{ background: "#B81917" }}
              onClick={advance}
              disabled={step === 0 && !name.trim()}
            >
              Next
            </Button>
          ) : (
            <Button
              size="sm"
              className="font-[Tomorrow] text-xs font-semibold"
              style={{ background: "#B81917" }}
              onClick={handleSubmit}
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
