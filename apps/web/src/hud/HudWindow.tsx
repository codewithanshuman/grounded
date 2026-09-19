import { useRef, useState, type ReactNode } from "react";

export function HudWindow({
  title, icon, defaultPos, width, children,
}: { title: string; icon?: ReactNode; defaultPos: { x: number; y: number }; width: number; children: ReactNode }) {
  const [pos, setPos] = useState(defaultPos);
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const windowWidth = e.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
    const nextX = Math.max(8, Math.min(e.clientX - dragging.current.dx, globalThis.innerWidth - windowWidth - 8));
    const nextY = Math.max(98, Math.min(e.clientY - dragging.current.dy, globalThis.innerHeight - 64));
    setPos({ x: nextX, y: nextY });
  };
  const onPointerUp = () => (dragging.current = null);

  return (
    <div
      className="hud-window"
      style={{ left: pos.x, top: pos.y, width, maxHeight: "calc(100vh - 122px)" }}
    >
      <div
        className="hud-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="hud-icon">{icon}</span>
        <div className="hud-title-group">
          <small>GROUNDED WORKSPACE</small>
          <span>{title}</span>
        </div>
        <div className="hud-window-status">
          <span /> LIVE DATA
        </div>
      </div>
      <div className="hud-body">{children}</div>
    </div>
  );
}
