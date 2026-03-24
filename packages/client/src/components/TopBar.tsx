import { useAuthStore } from "../stores/authStore";

export type ViewTab = "graph" | "board" | "gantt" | "budget";

interface TopBarProps {
  activeView: ViewTab;
  onViewChange: (view: ViewTab) => void;
}

const tabs: { id: ViewTab; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "graph", label: "Graph" },
  { id: "gantt", label: "Gantt" },
  { id: "budget", label: "Budget" },
];

export function TopBar({ activeView, onViewChange }: TopBarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header style={styles.bar}>
      <span style={styles.logo}>Rome</span>

      <nav style={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...styles.tab,
              ...(activeView === tab.id ? styles.tabActive : {}),
            }}
            onClick={() => onViewChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div style={styles.user}>
        <span style={styles.username}>{user?.username}</span>
        <button style={styles.logoutBtn} onClick={logout}>
          Logout
        </button>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    height: "48px",
    background: "var(--rome-surface)",
    borderBottom: "1px solid var(--rome-border)",
  },
  logo: {
    fontWeight: 700,
    fontSize: "18px",
    color: "var(--rome-red)",
    letterSpacing: "1px",
  },
  tabs: {
    display: "flex",
    gap: "4px",
  },
  tab: {
    padding: "6px 14px",
    background: "none",
    border: "none",
    borderRadius: "4px",
    color: "var(--rome-text-muted)",
    cursor: "pointer",
    fontWeight: 500,
    fontSize: "14px",
  },
  tabActive: {
    background: "var(--rome-red)",
    color: "#FFFFFF",
  },
  user: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  username: {
    color: "var(--rome-text-muted)",
    fontSize: "13px",
  },
  logoutBtn: {
    padding: "4px 10px",
    background: "none",
    border: "1px solid var(--rome-border)",
    borderRadius: "4px",
    color: "var(--rome-text-muted)",
    cursor: "pointer",
    fontSize: "12px",
  },
};
