import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Input } from "./ui/input";

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
      <Tabs value={activeView} onValueChange={(v) => onViewChange(v as ViewTab)}>
        <TabsList variant="line" className="h-auto gap-0 bg-transparent p-0">
          {tabs.map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              className="rounded-none border-b-2 border-transparent px-4 py-2 font-[Tomorrow] text-[10px] tracking-[2px] uppercase text-[#999] hover:text-[#1A1A1A] data-active:border-b-[#B81917] data-active:text-[#B81917] data-active:shadow-none"
            >
              {t.toUpperCase()}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="top-actions">
        {onAddNode && (
          <Button variant="outline" size="sm" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={onAddNode}>+ NODE</Button>
        )}
        {onAddWorkstream && (
          <Button variant="outline" size="sm" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={onAddWorkstream}>+ STREAM</Button>
        )}
        <Button variant="outline" size="sm" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={() => setShareOpen(!shareOpen)}>SHARE</Button>
        {user && <span style={{ fontSize: 9, color: "#999", letterSpacing: 1 }}>{user.username}</span>}
        <Button variant="outline" size="sm" className="font-[Tomorrow] text-[9px] tracking-[1px] uppercase" onClick={logout}>LOGOUT</Button>
      </div>

      {shareOpen && (
        <div className="share-pop" ref={popoverRef}>
          <div className="share-pop-title">SHARE LINK</div>
          <Input
            className="mb-2 font-[Tomorrow] text-[10px]"
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
