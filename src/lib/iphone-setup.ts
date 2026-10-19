/** Pure helpers for the "Connect iPhone" dialog: the exact values to paste into an iOS Shortcut. */

export type NotesSyncOptions = { origin: string; list?: string; format?: "report" | "note"; skipTitle?: boolean };

export const cleanOrigin = (origin: string): string => origin.trim().replace(/\/+$/, "");

/** The URL for the "Get Contents of URL" action in the notes ↔ Trakt Shortcut. */
export function notesSyncUrl(o: NotesSyncOptions): string {
  const params = new URLSearchParams();
  params.set("format", o.format ?? "report");
  if (o.skipTitle ?? true) params.set("skip", "1");
  const list = (o.list ?? "").trim();
  if (list) params.set("list", list);
  return `${cleanOrigin(o.origin)}/api/notes-sync?${params.toString()}`;
}

/** The address for the share-sheet Shortcut: shared text is URL-encoded and appended. */
export const shareSheetUrl = (origin: string): string => `${cleanOrigin(origin)}/?q=`;

export const bearerHeader = (token: string): string => `Bearer ${token.trim()}`;

/** Shortcuts can call plain http on a home network, but Safari/PWA features want https. */
export const isSecure = (origin: string): boolean => /^https:\/\//i.test(origin.trim());

export const SHORTCUTS_APP_URL = "shortcuts://create-shortcut";

export type SetupStep = { title: string; detail: string; copy?: { label: string; value: string }[] };

export function notesSteps(url: string, token: string, noteTitle: string): SetupStep[] {
  return [
    { title: "Find the note", detail: `Add **Find Notes**, set Name is "${noteTitle.trim() || "your note's title"}", and limit to 1.` },
    { title: "Read its text", detail: "Add **Get Details of Notes** and choose **Body**." },
    {
      title: "Send it to Pixel Pals",
      detail: "Add **Get Contents of URL**. Paste the URL, set Method to **POST**, add the two headers, and set Request Body to **File** and pick the Body from the previous step.",
      copy: [
        { label: "URL", value: url },
        { label: "Header: Authorization", value: token ? bearerHeader(token) : "Bearer <create your token first>" },
        { label: "Header: Content-Type", value: "text/plain" },
      ],
    },
    { title: "Show the result", detail: "Add **Show Result**. For a daily run: Shortcuts → Automation → Time of Day → run this Shortcut." },
  ];
}

export function shareSteps(url: string): SetupStep[] {
  return [
    { title: "New Shortcut", detail: "In Shortcuts tap +, open the shortcut's settings and turn on **Show in Share Sheet**. Accept **Text** and **URLs**." },
    { title: "Encode the text", detail: "Add **URL Encode** and set its input to **Shortcut Input**." },
    { title: "Open Pixel Pals", detail: "Add **Open URLs**. Paste this address, then tap after it and insert the **URL Encoded Text** variable.", copy: [{ label: "Address", value: url }] },
  ];
}
