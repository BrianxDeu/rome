import { useState, useCallback } from "react";
import { TopBar, type ViewTab } from "./components/TopBar";
import { AddNodeModal } from "./components/AddNodeModal";
import { AddWorkstreamModal } from "./components/AddWorkstreamModal";
import { BoardView } from "./pages/BoardView";
import { BudgetView } from "./pages/BudgetView";
import { GanttView } from "./pages/GanttView";
import { GraphView } from "./pages/GraphView";
import { NodePanel } from "./components/NodePanel";
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
  const selectNode = useGraphStore((s) => s.selectNode);
  useGraph();
  useSync();

  const selectedNode = useGraphStore((s) => s.selectedNode);

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      setActiveView("graph");
      const nodes = useGraphStore.getState().nodes;
      const node = nodes.find((n) => n.id === nodeId) ?? null;
      selectNode(node);
    },
    [selectNode],
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
        onViewChange={(v) => { setActiveView(v); selectNode(null); }}
        onAddNode={() => handleOpenAddNode()}
        onAddWorkstream={() => setAddWorkstreamModal(true)}
      />
      <div className="main">
        {activeView === "board" ? (
          <BoardView onNavigateToNode={handleNavigateToNode} onAddNode={handleOpenAddNode} />
        ) : activeView === "gantt" ? (
          <GanttView />
        ) : activeView === "budget" ? (
          <BudgetView />
        ) : (
          <GraphView />
        )}
        {activeView === "graph" && selectedNode && <NodePanel />}
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
