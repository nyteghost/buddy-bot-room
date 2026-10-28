// Lets the mail benchmark import mailbox.server.ts without the rest of the server (accounts, push notices, SMTP): those modules
// are replaced by empty stand-ins. Nothing the benchmark measures (IMAP traffic) goes through them.
import { plugin } from "bun";

const stubs: Record<string, string> = {
  "accounts.server": "export const currentUser = async () => ({ owner: true });",
  "inbox.server": "export const clearMailCache = () => undefined;",
  "mail-alerts.server": "export const ackAlert = async () => undefined; export const addAlertRule = async () => []; export const alertState = async () => ({}); export const removeAlertRule = async () => []; export const tickMailAlerts = async () => undefined;",
  "smtp.server": "export const smtpCheck = async () => undefined; export const smtpConfig = () => null; export const smtpSend = async () => undefined;",
};
plugin({
  name: "mail-bench-stubs",
  setup(build) {
    build.onResolve({ filter: /\/(accounts|inbox|mail-alerts|smtp)\.server$/ }, (args) => ({ path: args.path.split("/").pop()!, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "", loader: "ts" }));
  },
});
