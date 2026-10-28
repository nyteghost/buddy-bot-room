import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { fitWindowRect, presetWindowRects, readWorkspaceLayout, scaleWorkspaceLayout, WORKSPACE_LAYOUT_EVENT, type WindowRect, type WorkspaceLayout, type WorkspacePreset } from "@/lib/workspace";

const KEY = "pixel-pals-custom-window-layout-v1";
type Choice = "" | WorkspacePreset | "saved";

/** Arranges existing windows, never unmounts them or discards conversation/tool state. */
export function WorkspaceLayoutMenu({ onShow }: { onShow: (visibleIds: string[]) => void }) {
  const labelId = useId();
  const [choice, setChoice] = useState<Choice>("");
  const [hasSaved, setHasSaved] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    try { setHasSaved(!!readWorkspaceLayout(localStorage.getItem(KEY))); } catch { /* optional */ }
  }, []);

  const canvas = () => document.querySelector<HTMLElement>(".window-canvas");
  const apply = (rects: Record<string, WindowRect>) => {
    // Every WorkspaceWindow listens for the same layout event, including hidden windows.
    window.dispatchEvent(new CustomEvent(WORKSPACE_LAYOUT_EVENT, { detail: { windows: rects } }));
    onShow(Object.keys(rects));
  };

  function select(value: Choice) {
    if (!value) { setChoice(""); return; }
    const el = canvas();
    if (!el) return;
    const bounds = { width: el.clientWidth, height: el.clientHeight };
    if (bounds.width < 1 || bounds.height < 1) return;
    if (value === "saved") {
      let layout: WorkspaceLayout | null = null;
      try { layout = readWorkspaceLayout(localStorage.getItem(KEY)); } catch { /* optional */ }
      if (!layout) { setNotice("No saved layout found."); setHasSaved(false); return; }
      apply(scaleWorkspaceLayout(layout, bounds));
      setNotice("Your saved workspace layout is restored.");
    } else {
      apply(presetWindowRects(value, bounds));
      setNotice(`${value[0]!.toUpperCase()}${value.slice(1)} layout applied.`);
    }
    setChoice(value);
  }

  function save() {
    const el = canvas();
    if (!el) return;
    const canvasBounds = el.getBoundingClientRect();
    const bounds = { width: el.clientWidth, height: el.clientHeight };
    if (bounds.width < 1 || bounds.height < 1) return;
    const windows: Record<string, WindowRect> = {};
    for (const win of el.querySelectorAll<HTMLElement>(".workspace-window:not([hidden])")) {
      const id = win.dataset.windowId;
      if (!id || !/^[a-z0-9-]{1,40}$/.test(id)) continue;
      const r = win.getBoundingClientRect();
      windows[id] = fitWindowRect({ x: r.left - canvasBounds.left, y: r.top - canvasBounds.top, w: r.width, h: r.height }, bounds);
    }
    if (!Object.keys(windows).length) { setNotice("Open a window before saving a layout."); return; }
    const layout: WorkspaceLayout = { windows, canvas: bounds };
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
      setHasSaved(true); setChoice("saved"); setNotice("Current windows and sizes saved on this device.");
    } catch { setNotice("Could not save the layout. Browser storage may be unavailable."); }
  }

  return <div className="workspace-layout-menu">
    <label htmlFor={labelId}>Window layouts</label>
    <select id={labelId} aria-label="Workspace layout" value={choice} onChange={(e) => select(e.target.value as Choice)}>
      <option value="">Choose a layout…</option>
      <option value="chat">Chat · room + Roundtable</option>
      <option value="mail">Mail · full workspace</option>
      <option value="work">Work · tools + documents</option>
      <option value="server">Server · Today + settings</option>
      <option value="saved" disabled={!hasSaved}>My saved layout</option>
    </select>
    <Button variant="outline" size="sm" type="button" onClick={save}>Save current layout</Button>
    {hasSaved && <Button variant="ghost" size="sm" type="button" onClick={() => select("saved")}>Restore saved layout</Button>}
    {notice && <span className="workspace-layout-notice" role="status">{notice}</span>}
  </div>;
}
