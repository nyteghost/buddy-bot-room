import tls from "node:tls";
import type { AddressInfo } from "node:net";
import { pem } from "./fake-imap";

/** A tiny implicit-TLS SMTP server for tests. `mode: "drop-after-data"` takes the message and then hangs up without the final 250, like a flaky network. */
export class FakeSmtpServer {
  user = "me@example.com";
  pass = "app-password";
  mode: "ok" | "drop-after-data" | "refuse-rcpt" = "ok";
  connections = 0;
  dataAttempts = 0;
  delivered: string[] = [];
  port = 0;
  private server!: tls.Server;
  private sockets = new Set<tls.TLSSocket>();

  async start(): Promise<this> {
    const { key, cert } = pem();
    this.server = tls.createServer({ key, cert }, (sock) => this.onConnection(sock));
    await new Promise<void>((res) => this.server.listen(0, "127.0.0.1", res));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }
  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((res) => this.server.close(() => res()));
  }
  reset(): void { this.connections = 0; this.dataAttempts = 0; this.delivered = []; this.mode = "ok"; }

  private onConnection(sock: tls.TLSSocket): void {
    this.connections++;
    this.sockets.add(sock);
    sock.setEncoding("latin1");
    sock.on("error", () => undefined);
    sock.on("close", () => this.sockets.delete(sock));
    let buf = "";
    let inData = false;
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (d: string) => {
      buf += d;
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const body = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          this.delivered.push(body);
          if (this.mode === "drop-after-data") { sock.destroy(); return; }
          sock.write("250 queued\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (/^EHLO/i.test(line)) sock.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH PLAIN/i.test(line)) {
          const [, u, p] = Buffer.from(line.split(" ")[2] ?? "", "base64").toString("utf8").split("\0");
          sock.write(u === this.user && p === this.pass ? "235 ok\r\n" : "535 bad credentials\r\n");
        } else if (/^MAIL FROM/i.test(line)) sock.write("250 ok\r\n");
        else if (/^RCPT TO/i.test(line)) sock.write(this.mode === "refuse-rcpt" ? "550 no such user\r\n" : "250 ok\r\n");
        else if (/^DATA/i.test(line)) { this.dataAttempts++; inData = true; sock.write("354 go\r\n"); }
        else if (/^QUIT/i.test(line)) sock.end("221 bye\r\n");
        else sock.write("500 what\r\n");
      }
    });
  }
}
