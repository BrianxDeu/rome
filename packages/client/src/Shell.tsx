import { useState, useCallback, useEffect } from "react";
import { TopBar, type ViewTab } from "./components/TopBar";
import { AddNodeModal } from "./components/AddNodeModal";
import { AddNodeGroupModal } from "./components/AddNodeGroupModal";
import { AddWorkstreamModal } from "./components/AddWorkstreamModal";
import { ArchiveView } from "./pages/ArchiveView";
import { BoardView } from "./pages/BoardView";
import { BudgetView } from "./pages/BudgetView";
import { GanttView } from "./pages/GanttView";
import { GraphView } from "./pages/GraphView";
import { TasksView } from "./pages/TasksView";
import { NodePanel } from "./components/NodePanel";
import { useSync } from "./hooks/useSync";
import { useGraph } from "./hooks/useGraph";
import { useGraphStore } from "./stores/graphStore";
import { api } from "./api";

interface AddNodeModalState {
  open: boolean;
  defaultWorkstream?: string;
  defaultClusterId?: string;
}

export function Shell() {
  const [activeView, setActiveView] = useState<ViewTab>("tasks");
  const [addNodeModal, setAddNodeModal] = useState<AddNodeModalState>({ open: false });
  const [addNodeGroupModal, setAddNodeGroupModal] = useState(false);
  const [addWorkstreamModal, setAddWorkstreamModal] = useState(false);
  const selectNode = useGraphStore((s) => s.selectNode);
  useGraph();
  useSync();

  // Trigger lazy archive check on mount
  useEffect(() => {
    api<{ archived: number }>("/archive/check", { method: "POST" }).catch(console.error);
  }, []);

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
        onAddNodeGroup={() => setAddNodeGroupModal(true)}
        onAddWorkstream={() => setAddWorkstreamModal(true)}
      />
      <div className="main">
        {activeView === "tasks" ? (
          <TasksView />
        ) : activeView === "board" ? (
          <BoardView onNavigateToNode={handleNavigateToNode} onAddNode={handleOpenAddNode} />
        ) : activeView === "gantt" ? (
          <GanttView />
        ) : activeView === "budget" ? (
          <BudgetView />
        ) : activeView === "archive" ? (
          <ArchiveView />
        ) : (
          <GraphView />
        )}
        {(activeView === "graph" || activeView === "gantt" || activeView === "board" || activeView === "archive") && selectedNode && <NodePanel />}
      </div>

      {addNodeModal.open && (
        <AddNodeModal
          defaultWorkstream={addNodeModal.defaultWorkstream}
          defaultClusterId={addNodeModal.defaultClusterId}
          onClose={() => setAddNodeModal({ open: false })}
        />
      )}
      {addNodeGroupModal && (
        <AddNodeGroupModal onClose={() => setAddNodeGroupModal(false)} />
      )}
      {addWorkstreamModal && (
        <AddWorkstreamModal onClose={() => setAddWorkstreamModal(false)} />
      )}
    </div>
  );
}
