import { BOT_TOKEN_VALUE, DISCORD_GATEWAY, INTENTS } from "./discordApi";

// Communities round 2: the Glofly Bridge bot's live connection to Discord (the Gateway). One
// connection for every bridged server. It says hello, keeps a heartbeat, resumes after a drop
// (or starts over when Discord says so) and hands each event to `onEvent`. Only one server
// process should run it (Glofly runs one).

type Handler = (type: string, data: unknown) => void;

export class DiscordGateway {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private acked = true;
  private stopped = false;
  private tries = 0;
  ready = false;
  botUserId: string | null = null;

  constructor(private onEvent: Handler) {}

  start(): void {
    this.stopped = false;
    this.open(false);
  }

  stop(): void {
    this.stopped = true;
    this.clear();
    try {
      this.ws?.close(1000);
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private clear(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private send(op: number, d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  private open(resume: boolean): void {
    if (this.stopped) return;
    const url = resume && this.resumeUrl ? `${this.resumeUrl.replace(/\/?$/, "/")}?v=10&encoding=json` : DISCORD_GATEWAY;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      let p: { op: number; d: unknown; s?: number | null; t?: string | null };
      try {
        p = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (typeof p.s === "number") this.seq = p.s;
      switch (p.op) {
        case 10: {
          // Hello: beat every heartbeat_interval (the first one after a random part of it).
          const every = Number((p.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41_250);
          this.clear();
          this.acked = true;
          setTimeout(() => this.beat(), Math.random() * every).unref?.();
          this.heartbeat = setInterval(() => this.beat(), every);
          this.heartbeat.unref?.();
          if (resume && this.sessionId) this.send(6, { token: BOT_TOKEN_VALUE, session_id: this.sessionId, seq: this.seq });
          else
            this.send(2, {
              token: BOT_TOKEN_VALUE,
              intents: INTENTS,
              properties: { os: "linux", browser: "glofly-bridge", device: "glofly-bridge" },
            });
          break;
        }
        case 11:
          this.acked = true;
          break;
        case 1:
          this.beat();
          break;
        case 7: // reconnect (resume)
          ws.close(4000);
          break;
        case 9: // invalid session: start over (resumable says whether to resume)
          if (!p.d) {
            this.sessionId = null;
            this.seq = null;
          }
          setTimeout(() => ws.close(4000), 1000 + Math.random() * 4000).unref?.();
          break;
        case 0: {
          if (p.t === "READY") {
            const d = p.d as { session_id: string; resume_gateway_url?: string; user?: { id: string } };
            this.sessionId = d.session_id;
            this.resumeUrl = d.resume_gateway_url ?? null;
            this.botUserId = d.user?.id ?? null;
            this.ready = true;
            this.tries = 0;
          }
          if (p.t === "RESUMED") {
            this.ready = true;
            this.tries = 0;
          }
          if (p.t) {
            try {
              this.onEvent(p.t, p.d);
            } catch (err) {
              console.error("Discord bridge event failed:", err);
            }
          }
          break;
        }
      }
    };
    ws.onclose = (e) => {
      this.clear();
      this.ready = false;
      if (this.stopped || this.ws !== ws) return;
      // These mean the settings are wrong (bad token, intents not allowed): don't hammer Discord.
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(e.code)) {
        console.error(
          `Discord bridge stopped (${e.code}). ${e.code === 4014 ? "Turn on Message Content Intent in the Developer Portal (Bot page)." : "Check DISCORD_BOT_TOKEN."}`,
        );
        return;
      }
      this.tries++;
      const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.tries, 6));
      setTimeout(() => this.open(!!this.sessionId), wait).unref?.();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private beat(): void {
    if (!this.acked) {
      // No answer to the last heartbeat: the connection is dead; reconnect and resume.
      this.ws?.close(4000);
      return;
    }
    this.acked = false;
    this.send(1, this.seq);
  }
}
