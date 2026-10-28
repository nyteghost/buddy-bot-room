import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The row of tools above a document. Buttons are plain, labelled, and reachable by keyboard. */
export function ViewerToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="toolbar" className={cn("flex flex-wrap items-center gap-1 border-b bg-background/80 px-2 py-1 text-sm", className)}>{children}</div>;
}
export function ToolButton({ label, onClick, active, disabled, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}
      className={cn("inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-40", active && "bg-accent")}>
      {children}
    </button>
  );
}
export const Divider = () => <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
