# Built-in PDF and Excel viewer

Read-only viewers for PDF and spreadsheet files, used by Mail attachments and a new **Documents** window. No paid services, no new dependencies: it reuses `pdfjs-dist`, `exceljs` and `xlsx`, which were already in `package.json`.

## What you can do

- **Mail**: open a message and each attachment shows its size, **Preview** (PDF, .xlsx, .xlsm, .xls, .csv) and **Download**. Nothing is downloaded until you press one of them.
- **Documents window** (sidebar, or the command palette): drop or choose a PDF / Excel / CSV file from your device. A **Recent** list remembers names and sizes only (never contents); Mail attachments can be reopened from it, local files must be chosen again after a reload.
- From anywhere else in the app: `viewDocument({ kind: "file", file })` or `viewDocument({ kind: "mail", folder, uid, index, name })` (from `components/doc-viewer/document-modal.tsx`) opens the same viewer in a dialog. That is the hook for chat attachments and a future Projects area; neither is wired up yet.

## PDF viewer

pdf.js in its own lazy-loaded chunk with its worker. Features: previous/next, go to page, zoom out/in (25–400%), fit width, fit page, page thumbnails, search with highlighted matches (next/previous, wraps, shows "3 of 17" and reading progress), selectable text, print, download, full screen, Ctrl/Cmd+F, Ctrl/Cmd +/-.

- **Bounded memory**: pages are positioned from their sizes; only pages near the viewport are drawn, never more than 9 canvases, however far you zoom out. Leaving the window frees the pixels. Canvases are capped at about 16 megapixels. Renders are cancelled when you scroll away, zoom or close the viewer; the document and its worker are destroyed on close.
- **Untrusted files**: scripting is never enabled (no annotation or scripting layer is created), `eval` is off, XFA forms are off, links in the PDF are not followed or rendered, and the bytes are only ever read inside the browser tab. Password-protected PDFs give a plain message instead of prompting.
- **Print** renders the pages (up to 300) to images in a hidden print-only layer, then calls the browser's print. It works the same in every browser and needs no PDF plugin.
- Limit: 40 MB per PDF.

## Spreadsheet viewer

- `.xlsx` / `.xlsm` are read with **exceljs**, `.csv` with a small built-in reader (quotes, embedded newlines, comma/semicolon/tab, UTF-8 or Windows-1252), legacy `.xls` with **SheetJS** (see the security note). The format is decided from the file's first bytes, so a renamed file still opens.
- Parsing happens in a **Web Worker** (`sheet.worker.ts`), so the page stays responsive; the worker is terminated on cancel, close or after 90 seconds. Without worker support, `.xlsx` and `.csv` fall back to the main thread; `.xls` does not.
- Read only: formulas are never recalculated (the saved result is shown, the formula text appears in the formula bar), macros are never loaded or run, external links are never followed, nothing is edited or saved.
- **Grid**: column letters, row numbers, sheet tabs, formula bar, merged cells, frozen panes, column widths and row heights, bold/italic/underline, text and fill colours, alignment, wrap, hidden rows/columns/sheets, number and date formats (General, decimals, thousands, currency, percent, scientific, dates and times, quoted text), keyboard arrows/Home/End/PageUp/PageDown, copy of the selected cell, find with next/previous and "3 of 17", go to cell (`B7`).
- **Virtual**: only the rows and columns in view are drawn (position lookups are binary searches), so 50,000 rows scroll as smoothly as 50.
- Limits: 30 MB per file, 50,000 rows, 200 columns, 400,000 cells, 5,000 merges. Anything beyond shows "(first part shown)".

## Mail attachment pipeline

- `GET /api/mailbox?op=attachment&folder=&uid=&index=[&download=1]`, owner only (same gate as all of Mail).
- The listing (`MailMessage.files`: index, name, type, size, kind) comes from the message that is already downloaded when you open it, so no extra request. Sizes show `-1` (hidden) when only the start of a very long message was fetched.
- The bytes are fetched **only on request**: the message size is checked first (`RFC822.SIZE`), a message over 1.4 × the limit is refused before any download, then the message is read with `BODY.PEEK[]` (it is not marked read) and the one attachment is decoded.
- Runs on the shared IMAP pool, so it reuses a signed-in connection. A small memory-only cache (6 files, 48 MB, 5 minutes, keyed by account + folder + UIDVALIDITY + UID + index) lets a preview be downloaded or reopened without another fetch. It is cleared with the rest of the account's mail cache.
- Response headers: `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, safe `Content-Disposition` (names cleaned, header injection impossible), type decided from the extension (PDF and spreadsheets only; everything else is forced to a download as `application/octet-stream`).
- Setting: `MAIL_ATTACHMENT_MAX_MB` (default 25, 1–100) in Setup → Mail.

## Code map

| Area | Files |
|---|---|
| Pure logic (all unit tested) | `src/lib/doc-viewer/pdf-model.ts` (zoom, fit, page layout, windowing, search), `sheet-model.ts` (cell refs, number/date formats, CSV, virtual ranges, merges, search), `recent.ts`, `doc-source.ts` |
| Parsing | `sheet-parse.ts` (xlsx / xls / csv → `Workbook`), `sheet.worker.ts`, `sheet-client.ts`, `pdfjs-loader.ts` |
| UI | `src/components/doc-viewer/` `pdf-viewer.tsx`, `spreadsheet-viewer.tsx`, `document-viewer.tsx` (lazy shell), `document-modal.tsx`, `documents-panel.tsx`, `toolbar.tsx` |
| Mail | `mailbox.ts` (`attachmentList`, `attachmentBytes`, `attachmentKind`), `mailbox.server.ts` (`readAttachment`, `attachmentResponse`), `components/mailbox.tsx` (Preview/Download) |
| Styles | `src/styles.css` (text layer, search highlight, print) |

The viewers and the libraries behind them load only when a file of that kind is opened, so the main bundle does not grow.

## Tests

- Unit (Vitest, CI): `doc-viewer-model` (zoom/fit/layout/windowing/search, cell refs, formats, CSV, merges, virtual ranges, sheet search), `doc-viewer-parse` (format sniffing, CSV, a real .xlsx built with exceljs and read back, a real .xls built with SheetJS), `doc-viewer-recent`, `mail-attachments` (listing, exact bytes, size limit before download, caching, UIDVALIDITY, headers).
- Real browser (CI "smoke" job, Playwright + Chromium against the production build): a generated 2-page PDF renders non-blank pixels, shows its text layer and page count, finds and highlights a search hit on page 2, zoom/thumbnail/fit controls work; a broken "PDF" gives a plain error; a CSV opens as a grid, search and go-to-cell work; a generated .xlsx opens through the worker with a formatted currency cell, a merged block, a frozen header that stays after scrolling 300 rows, only nearby rows drawn, and a second sheet tab; a non-document file is refused politely.

## Security notes

- Everything is read-only and inside the browser tab. Files you open in Documents are not uploaded; Mail attachments come through the owner-only endpoint and are not written to disk on the server.
- The `xlsx` package is pinned at 0.18.5 (already a dependency), which has a known prototype-pollution advisory for specially crafted files. To limit that, the viewer **only uses it for legacy `.xls`, and only inside the worker**, so anything odd in a hostile file stays out of the page; `.xlsx`/`.xlsm` use exceljs and `.csv` uses the built-in reader. Upgrading `xlsx` beyond what npm publishes is a separate decision.
- Macros in `.xlsm` are never loaded. Formulas are never evaluated.

## Known limitations

- Scanned (image-only) PDFs have no text to select or search; there is no OCR.
- Some PDFs that use CJK character maps may draw or search poorly, because the pdf.js CMap files are not bundled.
- PDF form fields and annotations (comments, links) are not shown.
- The spreadsheet viewer does not draw charts, images, conditional formatting or data bars, and does not recalculate formulas. Theme-based colours (as opposed to explicit RGB) show as the default colour.
- The legacy `.xls` reader shows values and merges only (no colours or fonts).
- A Mail attachment preview downloads the whole message once (up to the size limit); fetching just one MIME part would be faster for very large messages and is a possible follow-up.
- Local files in Documents can't be reopened after a page reload (only their names are remembered).
- Not done yet: editing, saving or exporting spreadsheets, a Projects area, chat attachments, a mobile-specific layout (the viewers are responsive but were not designed for phones), accessibility audit beyond labelled controls and keyboard support.

## Settings

| Setting | Default | |
|---|---|---|
| `MAIL_ATTACHMENT_MAX_MB` | 25 | largest attachment to open from Mail (1–100) |
