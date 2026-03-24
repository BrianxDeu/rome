import { useState, useCallback } from "react";
import { TopBar, type ViewTab } from "./components/TopBar";
import { NodePanel } from "./components/NodePanel";
import { BoardView } from "./pages/BoardView";
import { BudgetView } from "./pages/BudgetView";
import { GanttView } from "./pages/GanttView";
import { GraphView } from "./pages/GraphView";
import { useSync } from "./hooks/useSync";
import { useGraph } from "./hooks/useGraph";
import { useGraphStore } from "./stores/graphStore";

export function Shell() {
  const [activeView, setActiveView] = useState<ViewTab>("board");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar activeView={activeView} onViewChange={setActiveView} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {activeView === "board" ? (
          <BoardView onNavigateToNode={handleNavigateToNode} />
        ) : activeView === "budget" ? (
          <BudgetView onNavigateToNode={handleNavigateToNode} />
        ) : activeView === "gantt" ? (
          <GanttView onNavigateToNode={handleNavigateToNode} />
        ) : (
          <GraphView onNavigateToNode={handleNavigateToNode} />
        )}
        {selectedNode && activeView !== "board" && <NodePanel />}
      </div>
    </div>
  );
}
