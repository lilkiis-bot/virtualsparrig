export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const neutralPose = () => ({
  headX: 0,
  headY: 0,
  retreat: 0,
  guard: false,
  tracked: true,
  hands: null,
  feet: null,
});
export const FORMATS = {
  "5x3": { seconds: 300, rounds: 3 },
  "5x5": { seconds: 300, rounds: 5 },
  "3x3": { seconds: 180, rounds: 3 },
  "3x5": { seconds: 180, rounds: 5 },
};
export function sanitizePose(p) {
  if (!p || !["headX", "headY", "retreat"].every((k) => Number.isFinite(p[k])))
    return null;
  const points = (a) =>
    Array.isArray(a) && a.length === 2
      ? a.map((v) =>
          Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
            ? v.map((n) => clamp(n, -3, 3))
            : [0, 0, 0],
        )
      : null;
  return {
    headX: clamp(p.headX, -0.8, 0.8),
    headY: clamp(p.headY, -0.7, 0.35),
    retreat: clamp(p.retreat, 0, 1.3),
    guard: p.guard === true,
    tracked: p.tracked !== false,
    hands: points(p.hands),
    feet: points(p.feet),
  };
}
export class History {
  constructor() {
    this.samples = [];
  }
  push(t, pose) {
    if (!Number.isFinite(t)) return;
    this.samples.push({ t, ...structuredClone(pose) });
    this.samples.sort((a, b) => a.t - b.t);
    const latest = this.samples.at(-1).t;
    this.samples = this.samples.filter((p) => p.t >= latest - 1500).slice(-90);
  }
  at(t) {
    const s = this.samples;
    if (!s.length) return neutralPose();
    let before = s[0];
    for (const p of s) {
      if (p.t > t) break;
      before = p;
    }
    return before;
  }
}
export function judgeStrike(attack, defender, attacker, counter = false) {
  if (!defender.tracked || !attacker.tracked)
    return { kind: "miss", damage: 0, reason: "tracking" };
  if (
    attacker.retreat + defender.retreat >
    (attack.type === "kick" ? 0.88 : 0.48)
  )
    return { kind: "dodge", damage: 0, reason: "range" };
  if (defender.guard && (attack.type === "punch" || attack.target === "head"))
    return { kind: "block", damage: 0 };
  const dx = Math.abs(attack.aimX - defender.headX),
    dy = Math.abs(attack.aimY - defender.headY);
  if (
    dx > (attack.target === "head" ? 0.25 : 0.38) ||
    (attack.target === "head" && dy > 0.26)
  )
    return { kind: "dodge", damage: 0, reason: "slip" };
  const perfect =
    attack.target === "head" &&
    attack.power >= 0.9 &&
    attack.energy >= 65 &&
    dx < 0.085 &&
    dy < 0.09 &&
    attacker.retreat + defender.retreat < 0.28 &&
    counter;
  return {
    kind: perfect ? "perfect" : "hit",
    damage: perfect
      ? 100
      : Math.round((attack.type === "kick" ? 17 : 10) * attack.power),
    ko: perfect,
  };
}
export class Combat {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.phase = "idle";
    this.reset("5x3");
  }
  reset(format = "5x3") {
    this.format = FORMATS[format] ? format : "5x3";
    Object.assign(this, FORMATS[this.format]);
    this.round = 1;
    this.phase = "idle";
    this.pending = [];
    this.seen = new Set();
    this.winner = null;
    this.reason = "";
    this.remaining = this.seconds;
    this.players = [0, 1].map(() => ({
      hp: 100,
      stamina: 100,
      pose: neutralPose(),
      history: new History(),
      attackHistory: [],
      lastAttack: -1e9,
      attack: null,
      hits: 0,
      attempts: 0,
      blocks: 0,
      dodges: 0,
      roundDamage: 0,
      score: 0,
    }));
  }
  start(now, format = this.format) {
    this.reset(format);
    this.phase = "countdown";
    this.phaseEnd = now + 3000;
    this.lastTick = now;
    this.onEvent({ kind: "countdown" });
  }
  setPose(id, pose, time) {
    const clean = sanitizePose(pose);
    if (!clean) return;
    this.players[id].pose = clean;
    this.players[id].history.push(time, clean);
  }
  attack(id, input, now, eventTime = now) {
    if (
      this.phase !== "fight" ||
      !input ||
      !["punch", "kick"].includes(input.type)
    )
      return null;
    const p = this.players[id],
      t = clamp(eventTime, now - 250, now + 25),
      cooldown = input.type === "kick" ? 720 : 330,
      cost = input.type === "kick" ? 19 : 8;
    if (
      t - p.lastAttack < cooldown ||
      p.stamina < cost ||
      p.pose.tracked === false
    )
      return null;
    const key = String(input.id || `${id}-${now}`);
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    if (this.seen.size > 4096)
      this.seen.delete(this.seen.values().next().value);
    const target =
      input.type === "punch"
        ? "head"
        : input.target === "head"
          ? "head"
          : "body";
    const attack = {
      id: key,
      player: id,
      type: input.type,
      side: input.side === "right" ? "right" : "left",
      target,
      aimX: clamp(Number.isFinite(input.aimX) ? input.aimX : 0, -0.8, 0.8),
      aimY: clamp(Number.isFinite(input.aimY) ? input.aimY : 0, -0.7, 0.35),
      power: clamp(Number.isFinite(input.power) ? input.power : 0.8, 0.5, 1.05),
      energy: p.stamina,
      start: t,
      impact:
        t +
        (input.windup
          ? clamp(input.windup, 160, 800)
          : input.type === "kick"
            ? 290
            : 170),
    };
    p.stamina -= cost;
    p.lastAttack = t;
    p.attempts++;
    p.attack = attack;
    p.attackHistory.push(attack);
    p.attackHistory = p.attackHistory.filter((a) => a.impact > now - 1500);
    this.pending.push(attack);
    this.onEvent({ kind: "attack", attack });
    return attack;
  }
  tick(now, lag = 0) {
    const dt = clamp((now - (this.lastTick ?? now)) / 1000, 0, 0.1);
    this.lastTick = now;
    if (
      this.phase === "idle" ||
      this.phase === "ended" ||
      this.phase === "paused"
    )
      return;
    if (this.phase === "countdown" && now >= this.phaseEnd) {
      this.phase = "fight";
      this.phaseEnd = now + this.seconds * 1000;
      this.onEvent({ kind: "bell", round: this.round });
    }
    if (this.phase === "break" && now >= this.phaseEnd) {
      this.round++;
      for (const p of this.players) {
        p.hp = Math.min(100, p.hp + 18);
        p.stamina = 100;
        p.roundDamage = 0;
        p.lastAttack = -1e9;
        p.attack = null;
      }
      this.phase = "countdown";
      this.phaseEnd = now + 3000;
      this.onEvent({ kind: "countdown" });
    }
    this.remaining =
      this.phase === "fight"
        ? Math.max(0, (this.phaseEnd - now) / 1000)
        : this.phase === "countdown"
          ? Math.ceil((this.phaseEnd - now) / 1000)
          : this.phase === "break"
            ? Math.ceil((this.phaseEnd - now) / 1000)
            : this.remaining;
    if (this.phase !== "fight") return;
    for (const p of this.players) {
      p.stamina = Math.min(100, p.stamina + dt * (p.pose.guard ? 7 : 12));
    }
    const ready = this.pending
      .filter((a) => now >= a.impact + clamp(lag, 0, 250))
      .sort((a, b) => a.impact - b.impact);
    this.pending = this.pending.filter(
      (a) => now < a.impact + clamp(lag, 0, 250),
    );
    for (const a of ready) {
      if (this.phase !== "fight") break;
      const atk = this.players[a.player],
        def = this.players[1 - a.player];
      const pose = def.history.at(a.impact),
        attacker = atk.history.at(a.impact);
      const counter = def.attackHistory.some(
        (b) => Math.abs(a.impact - b.impact) < 125,
      );
      const outcome = judgeStrike(a, pose, attacker, counter);
      if (outcome.damage) {
        def.hp = Math.max(0, def.hp - outcome.damage);
        atk.hits++;
        atk.roundDamage += outcome.damage;
      }
      if (outcome.kind === "block") def.blocks++;
      if (outcome.kind === "dodge") def.dodges++;
      this.onEvent({ ...outcome, attack: a, defender: 1 - a.player });
      if (def.hp <= 0)
        this.end(a.player, outcome.ko ? "PERFECT SHOT KO" : "KO");
    }
    if (this.phase === "fight" && now >= this.phaseEnd) {
      this.pending = [];
      const [a, b] = this.players;
      a.score += a.roundDamage >= b.roundDamage ? 10 : 9;
      b.score += b.roundDamage >= a.roundDamage ? 10 : 9;
      if (this.round >= this.rounds)
        this.end(
          a.score === b.score ? null : a.score > b.score ? 0 : 1,
          "DECISION",
        );
      else {
        this.phase = "break";
        this.phaseEnd = now + 15000;
        this.onEvent({ kind: "break", round: this.round });
      }
    }
  }
  pause(now) {
    if (!["fight", "countdown", "break"].includes(this.phase)) return;
    this.beforePause = this.phase;
    this.pausedAt = now;
    this.phase = "paused";
  }
  resume(now) {
    if (this.phase !== "paused") return;
    const shift = now - this.pausedAt;
    this.phaseEnd += shift;
    for (const a of this.pending) {
      a.start += shift;
      a.impact += shift;
    }
    this.phase = this.beforePause;
    this.lastTick = now;
  }
  end(winner, reason) {
    this.winner = winner;
    this.reason = reason;
    this.phase = "ended";
    this.pending = [];
    this.onEvent({ kind: "end", winner, reason });
  }
  snapshot() {
    return {
      phase: this.phase,
      phaseEnd: this.phaseEnd,
      remaining: this.remaining,
      round: this.round,
      rounds: this.rounds,
      seconds: this.seconds,
      format: this.format,
      winner: this.winner,
      reason: this.reason,
      players: this.players.map(({ history, attackHistory, ...p }) => p),
    };
  }
}
