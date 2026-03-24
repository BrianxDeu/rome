import { useState, useCallback } from "react";
import { TopBar, type ViewTab } from "./components/TopBar";
import { NodePanel } from "./components/NodePanel";
import { AddNodeModal } from "./components/AddNodeModal";
import { AddWorkstreamModal } from "./components/AddWorkstreamModal";
import { BoardView } from "./pages/BoardView";
import { BudgetView } from "./pages/BudgetView";
import { GanttView } from "./pages/GanttView";
import { GraphView } from "./pages/GraphView";
import { useSync } from "./hooks/useSync";
import { useGraph } from "./hooks/useGraph";
import { useGraphStore } from "./stores/graphStore";

interface AddNodeModalState {
  open: boolean;
  defaultWorkstream?: string;
  defaultClusterId?: string;
}

export function Shell() {
  const [activeView, setActiveView] = useState<ViewTab>("board");
  const [addNodeModal, setAddNodeModal] = useState<AddNodeModalState>({ open: false });
  const [addWorkstreamModal, setAddWorkstreamModal] = useState(false);
  const selectedNode = useGraphStore((s) => s.selectedNode);
  const nodes = useGraphStore((s) => s.nodes);
  const selectNode = useGraphStore((s) => s.selectNode);
  useGraph();
  useSync();

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId) ?? null;
      if (node) selectNode(node);
      setActiveView("graph");
    },
    [nodes, selectNode],
  );

  const handleOpenAddNode = useCallback(
    (defaultWorkstream?: string, defaultClusterId?: string) => {
      setAddNodeModal({ open: true, defaultWorkstream, defaultClusterId });
    },
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar
        activeView={activeView}
        onViewChange={(v) => { setActiveView(v); if (v === "board") selectNode(null); }}
        onAddNode={() => handleOpenAddNode()}
        onAddWorkstream={() => setAddWorkstreamModal(true)}
      />
      <div className="main">
        {activeView === "board" ? (
          <BoardView onNavigateToNode={handleNavigateToNode} onAddNode={handleOpenAddNode} />
        ) : activeView === "gantt" ? (
          <GanttView onNavigateToNode={handleNavigateToNode} />
        ) : activeView === "budget" ? (
          <BudgetView onNavigateToNode={handleNavigateToNode} />
        ) : (
          <GraphView onNavigateToNode={handleNavigateToNode} />
        )}
        {selectedNode && activeView !== "board" && <NodePanel />}
      </div>

      {addNodeModal.open && (
        <AddNodeModal
          defaultWorkstream={addNodeModal.defaultWorkstream}
          defaultClusterId={addNodeModal.defaultClusterId}
          onClose={() => setAddNodeModal({ open: false })}
        />
      )}
      {addWorkstreamModal && (
        <AddWorkstreamModal onClose={() => setAddWorkstreamModal(false)} />
      )}
    </div>
  );
}
