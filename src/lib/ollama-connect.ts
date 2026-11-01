/** An owner-entered Ollama base, not a browser-direct URL or a network scanner. */
export function ollamaConnectUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1000) return null;
  try {
    const u = new URL(raw.trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) return null;
    if (/^(169\.254\.|0\.|22[4-9]\.|2[3-5]\d\.)/.test(u.hostname) || /^(metadata|metadata\.google\.internal)$/i.test(u.hostname)) return null;
    u.pathname = u.pathname.replace(/\/(?:api\/tags|api|v1)\/?$/, "");
    if (!/^\/[a-z0-9/_-]*$/i.test(u.pathname)) return null;
    return u.toString().replace(/\/+$/, "");
  } catch { return null; }
}
export const OLLAMA_PC_SETUP = `sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '%s\\n' '[Service]' 'Environment="OLLAMA_HOST=0.0.0.0:11434"' | sudo tee /etc/systemd/system/ollama.service.d/pixelpals-network.conf
sudo systemctl daemon-reload
sudo systemctl restart ollama`;
