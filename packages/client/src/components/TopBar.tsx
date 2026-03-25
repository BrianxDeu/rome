import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";

export type ViewTab = "board" | "graph" | "gantt" | "budget";

interface TopBarProps {
  activeView: ViewTab;
  onViewChange: (view: ViewTab) => void;
  onAddNode?: () => void;
  onAddWorkstream?: () => void;
}

const tabs: ViewTab[] = ["board", "graph", "gantt", "budget"];

export function TopBar({ activeView, onViewChange, onAddNode, onAddWorkstream }: TopBarProps) {
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
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="top-actions">
        {onAddNode && <button className="btn" onClick={onAddNode}>+ NODE</button>}
        {onAddWorkstream && <button className="btn" onClick={onAddWorkstream}>+ STREAM</button>}
        <button className="btn" onClick={() => setShareOpen(!shareOpen)}>SHARE</button>
        {user && <span style={{ fontSize: 9, color: "#999", letterSpacing: 1 }}>{user.username}</span>}
        <button className="btn" onClick={logout}>LOGOUT</button>
      </div>

      {shareOpen && (
        <div className="share-pop" ref={popoverRef}>
          <div className="share-pop-title">SHARE LINK</div>
          <input
            className="share-input"
            value={window.location.href}
            readOnly
            onFocus={(e) => e.target.select()}
            onClick={handleCopy}
          />
          <div style={{ fontSize: 9, color: copied ? "#2E7D32" : "#999" }}>
            {copied ? "Copied!" : "Click to copy URL"}
          </div>
        </div>
      )}
    </div>
  );
}
