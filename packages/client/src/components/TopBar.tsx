import { useState, useRef, useEffect } from "react";
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
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [shareOpen]);

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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
        <div style={{ position: "relative" }} ref={popoverRef}>
          <button
            style={styles.shareBtn}
            onClick={() => setShareOpen(!shareOpen)}
            title="Share"
          >
            Share
          </button>
          {shareOpen && (
            <div style={styles.popover}>
              <div style={styles.popoverTitle}>Share this view</div>
              <div style={styles.urlRow}>
                <input
                  style={styles.urlInput}
                  value={window.location.href}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <button style={styles.copyBtn} onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div style={styles.popoverHint}>
                Anyone on your network with this URL can access Rome.
              </div>
            </div>
          )}
        </div>
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
  shareBtn: {
    padding: "4px 10px",
    background: "none",
    border: "1px solid var(--rome-border)",
    borderRadius: "4px",
    color: "var(--rome-text-muted)",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 500,
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: "320px",
    background: "var(--rome-surface)",
    border: "1px solid var(--rome-border)",
    borderRadius: "8px",
    padding: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: 100,
  },
  popoverTitle: {
    fontWeight: 600,
    fontSize: "13px",
    color: "var(--rome-text)",
    marginBottom: "8px",
  },
  urlRow: {
    display: "flex",
    gap: "6px",
  },
  urlInput: {
    flex: 1,
    padding: "6px 8px",
    fontSize: "12px",
    border: "1px solid var(--rome-border)",
    borderRadius: "4px",
    background: "var(--rome-bg)",
    color: "var(--rome-text)",
    outline: "none",
  },
  copyBtn: {
    padding: "6px 12px",
    background: "var(--rome-red)",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 500,
    whiteSpace: "nowrap" as const,
  },
  popoverHint: {
    fontSize: "11px",
    color: "var(--rome-text-muted)",
    marginTop: "8px",
  },
};
