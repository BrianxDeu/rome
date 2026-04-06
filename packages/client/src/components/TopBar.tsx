import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";

export type ViewTab = "tasks" | "board" | "graph" | "gantt" | "budget" | "kanban" | "archive";

interface TopBarProps {
  activeView: ViewTab;
  onViewChange: (view: ViewTab) => void;
  onAddNode?: () => void;
  onAddNodeGroup?: () => void;
  onAddWorkstream?: () => void;
}

const tabs: ViewTab[] = ["tasks", "board", "graph", "gantt", "budget", "kanban"];

export function TopBar({ activeView, onViewChange, onAddNode, onAddNodeGroup, onAddWorkstream }: TopBarProps) {
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

  function shareUrl() {
    return `${window.location.origin}/${activeView}`;
  }

  function handleCopy() {
    navigator.clipboard.writeText(shareUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="top-bar">
      <div className="logo">
        <div className="logo-diamond" />
        DXD HALO OPS
      </div>
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={`tab ${activeView === t ? "active" : ""}`}
            onClick={() => onViewChange(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="top-actions">
        {onAddNode && activeView !== "archive" && <button className="btn" onClick={onAddNode}>+ Node</button>}
        {onAddNodeGroup && activeView !== "archive" && <button className="btn" onClick={onAddNodeGroup}>+ Group</button>}
        {onAddWorkstream && activeView !== "archive" && <button className="btn" onClick={onAddWorkstream}>+ Stream</button>}
        <button
          className={`btn ${activeView === "archive" ? "primary" : ""}`}
          onClick={() => onViewChange("archive")}
        >
          Archive
        </button>
        <button className="btn" onClick={() => setShareOpen(!shareOpen)}>Share</button>
        {user && <span style={{ fontSize: 11, color: "var(--rome-text-muted)" }}>{user.username}</span>}
        <button className="btn" onClick={logout}>Logout</button>
      </div>

      {shareOpen && (
        <div className="share-pop" ref={popoverRef}>
          <div className="share-pop-title">Share Link</div>
          <input
            className="share-input"
            value={shareUrl()}
            readOnly
            onFocus={(e) => e.target.select()}
            onClick={handleCopy}
          />
          <div style={{ fontSize: 11, color: copied ? "#2E7D32" : "#999" }}>
            {copied ? "Copied!" : "Click to copy URL"}
          </div>
        </div>
      )}
    </div>
  );
}
