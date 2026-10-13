import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { askPal, desktop, findTerminalError, onPty, recentTerminal, recordTerminal, stripAnsi } from "@/lib/linux";
import { PixelCharacter } from "./pixel-character";

/** Real shell inside the app (desktop only). Loaded client-side via React.lazy. */
export default function LinuxTerminal() {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    let recent = "";
    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !host.current) return;
      const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true, convertEol: false });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host.current);
      fit.fit();
      cleanups.push(() => term.dispose());
      const unOut = await onPty("pty-output", (data) => {
        term.write(data);
        const plain = stripAnsi(data);
        recordTerminal(plain);
        recent = (recent + plain).slice(-3000);
        const err = findTerminalError(recent);
        if (err) setProblem(err);
      });
      const unExit = await onPty("pty-exit", () => setExited(true));
      cleanups.push(unOut, unExit);
      term.onData((d) => {
        if (d === "\r") recent = ""; // new command: forget old errors
        void desktop.ptyWrite(d);
      });
      const resize = () => {
        fit.fit();
        void desktop.ptyResize(term.cols, term.rows);
      };
      window.addEventListener("resize", resize);
      cleanups.push(() => window.removeEventListener("resize", resize));
      const run = (e: Event) => {
        const cmd = (e as CustomEvent<string>).detail;
        void desktop.ptyWrite(cmd.replace(/\n/g, "\r") + "\r");
        term.focus();
      };
      window.addEventListener("pixelpals:run", run);
      cleanups.push(() => window.removeEventListener("pixelpals:run", run));
      await desktop.ptySpawn(term.cols, term.rows);
      term.focus();
    })();
    return () => {
      disposed = true;
      cleanups.forEach((c) => c());
    };
  }, []);

  function askTux(text: string) {
    askPal("claude", `${text}\n\nRecent terminal output:\n\`\`\`\n${recentTerminal(60)}\n\`\`\``);
    setProblem(null);
  }

  return (
    <section className="linux-terminal" aria-label="Terminal">
      <div className="linux-terminal-bar">
        <span>TERMINAL · your shell</span>
        {exited && (
          <button type="button" onClick={() => { setExited(false); void desktop.ptySpawn(80, 24); }}>
            Restart shell
          </button>
        )}
      </div>
      <div ref={host} className="linux-terminal-screen" />
      {problem && (
        <div className="tux-alert" role="status">
          <PixelCharacter id="claude" mode="linux" />
          <div>
            <b>Tux spotted a problem</b>
            <span>{problem.slice(0, 140)}</span>
          </div>
          <button type="button" onClick={() => askTux(`This just went wrong in my terminal: "${problem}". What happened and how do I fix it?`)}>
            Want help?
          </button>
          <button type="button" className="ghost" onClick={() => setProblem(null)}>Dismiss</button>
        </div>
      )}
      <form
        className="tux-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) askTux(question.trim());
          setQuestion("");
        }}
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask Tux about your system… e.g. why is my wifi dropping?" aria-label="Ask Tux" />
        <button type="submit">Ask Tux</button>
      </form>
    </section>
  );
}
