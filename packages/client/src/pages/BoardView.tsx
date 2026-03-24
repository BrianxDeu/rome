interface BoardViewProps {
  onNavigateToNode: (nodeId: string) => void;
}

export function BoardView({ onNavigateToNode: _onNavigateToNode }: BoardViewProps) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--rome-text-muted)" }}>
      Board view — loading...
    </div>
  );
}
