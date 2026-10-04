import { clamp, sanitizePose } from "./combat.js";
const prefix = "octagon-motion-v1-";
export class Network {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.generation = 0;
    this.clear();
  }
  clear() {
    this.connected = false;
    this.role = null;
    this.code = null;
    this.rtt = 0;
    this.jitter = 0;
    this.offset = 0;
    this.samples = 0;
    this.bestRTT = Infinity;
    this.remoteFrames = [];
    this.lastSeen = 0;
    this.seq = 0;
    this.remoteSeq = -1;
    this.tokens = 0;
  }
  async open(role, code) {
    this.close(false);
    if (typeof window.Peer !== "function")
      throw new Error(
        "온라인 연결 파일을 불러오지 못했습니다. 새로고침해 주세요.",
      );
    this.role = role;
    this.code =
      code ||
      String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    const generation = this.generation;
    const cfg = window.OCTAGON_CONFIG || {};
    this.peer = new window.Peer(
      role === "host" ? prefix + this.code : undefined,
      {
        ...cfg.peer,
        debug: 0,
        config: {
          iceServers: cfg.iceServers || [
            { urls: "stun:stun.l.google.com:19302" },
          ],
        },
      },
    );
    return new Promise((resolve, reject) => {
      let opened = false;
      const timeout = setTimeout(() => {
        reject(
          new Error("연결 서버에 응답이 없습니다. 네트워크를 확인해 주세요."),
        );
        this.close(false);
      }, 15000);
      this.peer.on("open", () => {
        if (generation !== this.generation) return;
        opened = true;
        clearTimeout(timeout);
        this.onStatus(
          role === "host" ? "친구를 기다리는 중…" : "방에 연결하고 있습니다…",
        );
        if (role === "guest") {
          this.accept(
            this.peer.connect(prefix + this.code, {
              label: "events",
              serialization: "json",
              reliable: true,
              metadata: { protocol: 1 },
            }),
          );
          this.joinTimeout = setTimeout(() => {
            if (!this.connected) {
              this.onStatus(
                "방에 연결하지 못했습니다. 코드 또는 TURN 설정을 확인해 주세요.",
              );
              this.close(false);
            }
          }, 15000);
        }
        resolve(this.code);
      });
      this.peer.on("connection", (conn) => {
        if (
          role !== "host" ||
          conn.metadata?.protocol !== 1 ||
          !["events", "motion"].includes(conn.label)
        ) {
          conn.on("open", () => conn.close());
          return;
        }
        if (
          conn.label === "events" &&
          this.events &&
          this.events.peer !== conn.peer
        ) {
          conn.on("open", () => {
            conn.send({ type: "full" });
            setTimeout(() => conn.close(), 150);
          });
          return;
        }
        if (conn.label === "motion" && conn.peer !== this.events?.peer) {
          conn.on("open", () => conn.close());
          return;
        }
        this.accept(conn);
      });
      this.peer.on("error", (error) => {
        const messages = {
          "unavailable-id":
            "이 코드의 방이 이미 있습니다. 방 만들기를 다시 눌러 주세요.",
          "peer-unavailable":
            "해당 코드의 방이 없습니다. 코드를 확인해 주세요.",
          network:
            "연결 서버에 접속하지 못했습니다. 인터넷 연결을 확인해 주세요.",
          webrtc:
            "직접 연결에 실패했습니다. 다른 네트워크 또는 TURN 서버가 필요합니다.",
        };
        const message =
          messages[error.type] ||
          "온라인 연결에 문제가 생겼습니다. 방을 다시 만들어 주세요.";
        clearTimeout(timeout);
        if (!opened) {
          reject(new Error(message));
          this.close(false);
        } else {
          this.onStatus(message);
          this.close();
        }
      });
      this.peer.on("disconnected", () => {
        if (this.connected)
          this.onStatus(
            "연결 서버가 끊겼습니다. 현재 대전 연결은 유지 중입니다.",
          );
      });
    });
  }
  accept(conn) {
    if (conn.label === "motion") {
      this.motion?.close();
      this.motion = conn;
    } else {
      if (this.events && this.events !== conn) {
        conn.on("open", () => conn.close());
        return;
      }
      this.events = conn;
    }
    conn.on("open", () => {
      if (conn.label !== "events") return;
      this.connected = true;
      this.lastSeen = performance.now();
      clearTimeout(this.joinTimeout);
      if (this.role === "guest")
        this.accept(
          this.peer.connect(prefix + this.code, {
            label: "motion",
            serialization: "json",
            reliable: false,
            metadata: { protocol: 1 },
          }),
        );
      this.onStatus("상대 연결 완료 · 두 명 모두 준비해 주세요.");
      this.onMessage({ type: "connected" });
      this.ping();
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (performance.now() - this.lastSeen > 10000) {
          this.onStatus("상대의 연결이 끊겼습니다.");
          this.close();
          return;
        }
        this.ping();
      }, 1000);
    });
    conn.on("data", (d) => this.receive(d, conn.label));
    conn.on("error", () => {
      if (conn.label === "events") {
        this.onStatus("대전 연결에 문제가 생겼습니다.");
        this.close();
      }
    });
    conn.on("close", () => {
      if (conn === this.events && this.connected) {
        this.onStatus("상대가 방을 나갔습니다.");
        this.close();
      }
    });
  }
  ping() {
    const sent = performance.now();
    this.pendingPings ??= new Set();
    this.pendingPings.add(sent);
    if (this.pendingPings.size > 10)
      this.pendingPings.delete(this.pendingPings.values().next().value);
    this.send({ type: "ping", sent });
  }
  receive(d, channel) {
    if (!d || typeof d !== "object" || typeof d.type !== "string") return;
    const now = performance.now();
    this.lastSeen = now;
    if (d.type === "ping" && Number.isFinite(d.sent)) {
      this.send({
        type: "pong",
        sent: d.sent,
        received: now,
        reply: performance.now(),
      });
      return;
    }
    if (
      d.type === "pong" &&
      this.pendingPings?.has(d.sent) &&
      [d.received, d.reply].every(Number.isFinite)
    ) {
      this.pendingPings.delete(d.sent);
      const rtt = now - d.sent - (d.reply - d.received);
      if (rtt < 0 || rtt > 5000) return;
      const offset = (d.received - d.sent + (d.reply - now)) / 2;
      this.jitter = this.samples
        ? this.jitter * 0.8 + Math.abs(rtt - this.rtt) * 0.2
        : 0;
      this.rtt = this.samples ? this.rtt * 0.75 + rtt * 0.25 : rtt;
      if (rtt <= this.bestRTT * 1.3) {
        this.offset = this.samples ? this.offset * 0.5 + offset * 0.5 : offset;
        this.bestRTT = Math.min(this.bestRTT, rtt);
      }
      this.samples++;
      return;
    }
    if (d.type === "pose") {
      if (
        !Number.isFinite(d.seq) ||
        d.seq <= this.remoteSeq ||
        !Number.isFinite(d.time)
      )
        return;
      const pose = sanitizePose(d.pose);
      if (!pose) return;
      this.remoteSeq = d.seq;
      const localTime = clamp(d.time - this.offset, now - 500, now + 30);
      this.remoteFrames.push({ time: localTime, pose });
      this.remoteFrames = this.remoteFrames
        .filter((f) => f.time > now - 1500)
        .slice(-60);
      this.onMessage({ type: "pose", pose, time: localTime });
      return;
    }
    if (channel !== "events") return;
    if (
      ![
        "ready",
        "config",
        "start",
        "attack",
        "event",
        "snapshot",
        "pause",
        "resume",
        "reset",
        "full",
      ].includes(d.type)
    )
      return;
    if (d.type === "full") {
      this.onStatus("이미 두 명이 들어간 방입니다.");
      this.close(false);
      return;
    }
    // Control messages have a bounded rate; motion is handled separately.
    if (now - (this.tokenTime || 0) > 1000) {
      this.tokenTime = now;
      this.tokens = 0;
    }
    if (++this.tokens > 90) return;
    this.onMessage(d);
  }
  send(message, motion = false) {
    const conn = motion && this.motion?.open ? this.motion : this.events;
    if (!conn?.open) return false;
    if (conn.dataChannel?.bufferedAmount > (motion ? 16384 : 262144))
      return false;
    try {
      conn.send(message);
      return true;
    } catch {
      return false;
    }
  }
  sendPose(pose, now) {
    this.send({ type: "pose", pose, time: now, seq: this.seq++ }, true);
  }
  remotePose(now) {
    const frames = this.remoteFrames;
    if (!frames.length) return null;
    const target = now - this.buffer;
    let a = frames[0],
      b = a;
    for (const frame of frames) {
      if (frame.time <= target) a = frame;
      if (frame.time >= target) {
        b = frame;
        break;
      }
      b = frame;
    }
    const t =
      a === b
        ? 0
        : clamp((target - a.time) / Math.max(1, b.time - a.time), 0, 1);
    const pose = structuredClone(a.pose);
    for (const k of ["headX", "headY", "retreat"])
      pose[k] = a.pose[k] + (b.pose[k] - a.pose[k]) * t;
    for (const k of ["hands", "feet"])
      if (a.pose[k] && b.pose[k])
        pose[k] = a.pose[k].map((p, i) =>
          p.map((v, j) => v + (b.pose[k][i][j] - v) * t),
        );
    if (now - frames.at(-1).time > 600) pose.tracked = false;
    return pose;
  }
  get buffer() {
    return clamp(50 + this.jitter * 2, 50, 180);
  }
  close(notify = true) {
    this.generation++;
    clearInterval(this.heartbeat);
    clearTimeout(this.joinTimeout);
    const events = this.events,
      peer = this.peer;
    this.events = null;
    this.peer = null;
    this.motion?.close();
    this.motion = null;
    events?.close();
    peer?.destroy();
    const was = this.connected;
    this.clear();
    this.pendingPings?.clear();
    if (notify && was) this.onMessage({ type: "disconnected" });
  }
}
