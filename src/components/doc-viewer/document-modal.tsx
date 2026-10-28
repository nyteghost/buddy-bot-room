import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { sourceKind, sourceName, type DocSource } from "@/lib/doc-viewer/doc-source";
import { rememberRecent } from "@/lib/doc-viewer/recent";
import { DocumentViewer } from "./document-viewer";

export const VIEW_DOCUMENT_EVENT = "pixelpals:view-document";
/** Ask the app to open a document in the viewer from anywhere (Mail, chat attachments, a future Projects area). */
export const viewDocument = (source: DocSource): void => { window.dispatchEvent(new CustomEvent<DocSource>(VIEW_DOCUMENT_EVENT, { detail: source })); };

export function DocumentModal({ source, onClose }: { source: DocSource | null; onClose: () => void }) {
  return (
    <Dialog open={!!source} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[min(1280px,98vw)] max-w-none flex-col gap-0 overflow-hidden p-0 max-md:h-[calc(var(--vvh,100dvh)-24px)]">
        <div className="flex items-center gap-2 border-b px-4 py-2 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{source ? sourceName(source) : "Document"}</DialogTitle>
          <DialogDescription className="sr-only">Read-only document viewer</DialogDescription>
        </div>
        {source && <DocumentViewer source={source} className="min-h-0 flex-1" />}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once in the room: opens the viewer whenever something dispatches `pixelpals:view-document`. */
export function DocumentModalHost() {
  const [source, setSource] = useState<DocSource | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<DocSource>).detail ?? null;
      setSource(d);
      if (d?.kind === "mail") rememberRecent({ id: `mail:${d.folder}:${d.uid}:${d.index}`, kind: sourceKind(d), name: d.name, size: d.size ?? -1, at: Date.now(), origin: "mail", folder: d.folder, uid: d.uid, index: d.index });
    };
    window.addEventListener(VIEW_DOCUMENT_EVENT, on);
    return () => window.removeEventListener(VIEW_DOCUMENT_EVENT, on);
  }, []);
  return <DocumentModal source={source} onClose={() => setSource(null)} />;
}
