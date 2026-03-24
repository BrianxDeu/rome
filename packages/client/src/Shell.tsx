import { useState } from "react";
import { TopBar, type ViewTab } from "./components/TopBar";
import { NodePanel } from "./components/NodePanel";
import { useSync } from "./hooks/useSync";
import { useGraphStore } from "./stores/graphStore";

export function Shell() {
  const [activeView, setActiveView] = useState<ViewTab>("graph");
  const selectedNode = useGraphStore((s) => s.selectedNode);
  useSync();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TopBar activeView={activeView} onViewChange={setActiveView} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "var(--rome-text-muted)" }}>
            {activeView === "graph" && "Graph view — coming soon"}
            {activeView === "gantt" && "Gantt view — coming soon"}
            {activeView === "budget" && "Budget view — coming soon"}
          </p>
        </main>
        {selectedNode && <NodePanel />}
      </div>
    </div>
  );
}
