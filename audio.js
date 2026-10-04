export class Sound {
  constructor() {
    this.enabled = false;
  }
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) {
        this.context ??= new Audio();
        try {
          await this.context.resume();
        } catch {
          this.enabled = false;
        }
      } else this.enabled = false;
    }
    return this.enabled;
  }
  play(kind) {
    if (!this.enabled || !this.context || this.context.state !== "running")
      return;
    const c = this.context,
      g = c.createGain(),
      o = c.createOscillator();
    o.connect(g);
    g.connect(c.destination);
    const now = c.currentTime;
    if (kind === "bell") {
      o.type = "sine";
      o.frequency.setValueAtTime(740, now);
      o.frequency.exponentialRampToValueAtTime(620, now + 0.55);
      g.gain.setValueAtTime(0.1, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      o.start();
      o.stop(now + 0.65);
    } else {
      o.type = kind === "block" ? "triangle" : "sine";
      o.frequency.setValueAtTime(kind === "block" ? 360 : 115, now);
      o.frequency.exponentialRampToValueAtTime(42, now + 0.12);
      g.gain.setValueAtTime(0.13, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      o.start();
      o.stop(now + 0.15);
    }
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
}
