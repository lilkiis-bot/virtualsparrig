import { clamp, neutralPose } from "./combat.js";
const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const visible = (p) =>
  p &&
  (p.visibility ?? 1) > 0.5 &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.y);
export class GestureEngine {
  constructor() {
    this.sensitivity = 1;
    this.reset();
  }
  reset() {
    this.baseline = null;
    this.previous = null;
    this.calibration = [];
    this.calibrating = false;
    this.armed = [true, true, true, true];
    this.last = [-1e5, -1e5, -1e5, -1e5];
    this.smoothed = null;
  }
  calibrate() {
    this.calibrating = true;
    this.calibration = [];
    this.calibrationStart = null;
    this.previous = null;
  }
  process(lm, world, t) {
    const pose = neutralPose();
    pose.tracked = false;
    if (!lm || !visible(lm[0]) || !visible(lm[11]) || !visible(lm[12])) {
      this.previous = null;
      this.smoothed = null;
      if (this.calibrating) {
        this.calibration = [];
        this.calibrationStart = null;
      }
      return { pose, attacks: [], quality: 0, calibrated: !!this.baseline };
    }
    const shoulder = Math.max(
      0.04,
      Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y),
    );
    const torso =
      visible(lm[23]) && visible(lm[24])
        ? Math.abs((lm[23].y + lm[24].y - lm[11].y - lm[12].y) / 2)
        : shoulder * 1.5;
    if (this.calibrating) {
      if (this.calibrationStart === null) this.calibrationStart = t;
      this.calibration.push({ x: lm[0].x, y: lm[0].y, shoulder, torso });
      if (t - this.calibrationStart >= 2000 && this.calibration.length >= 18) {
        const avg = (k) =>
          this.calibration.reduce((s, v) => s + v[k], 0) /
          this.calibration.length;
        this.baseline = {
          x: avg("x"),
          y: avg("y"),
          shoulder: avg("shoulder"),
          torso: avg("torso"),
        };
        this.calibrating = false;
        this.previous = null;
      }
    }
    const base = this.baseline || { x: lm[0].x, y: lm[0].y, shoulder, torso };
    pose.headX = clamp((-(lm[0].x - base.x) / base.shoulder) * 0.42, -0.8, 0.8);
    pose.headY = clamp(
      (-(lm[0].y - base.y) / base.shoulder) * 0.42,
      -0.7,
      0.35,
    );
    const sizeRatio =
      (base.shoulder / shoulder) * 0.45 +
      (base.torso / Math.max(0.03, torso)) * 0.55;
    pose.retreat = clamp((sizeRatio - 1) * 2.1, 0, 1.3);
    pose.tracked = true;
    // A SINGLE visible hand within the face region blocks a punch. No two-hand requirement.
    pose.guard = [15, 16, 19, 20].some(
      (i) =>
        visible(lm[i]) &&
        Math.abs(lm[i].x - lm[0].x) < shoulder * 0.65 &&
        Math.abs(lm[i].y - lm[0].y) < shoulder * 0.52 &&
        (lm[i].z ?? 0) - (lm[0].z ?? 0) < shoulder * 0.8,
    );
    const coords = (i) =>
      visible(lm[i])
        ? [
            (-(lm[i].x - (lm[11].x + lm[12].x) / 2) / shoulder) * 0.42,
            clamp(
              1.55 - ((lm[i].y - (lm[11].y + lm[12].y) / 2) / shoulder) * 0.42,
              0,
              2.2,
            ),
            clamp(
              (((lm[i].z || 0) - (lm[11].z + lm[12].z) / 2) / shoulder) * 0.42,
              -1.2,
              0.4,
            ),
          ]
        : null;
    pose.hands = [coords(15), coords(16)].map((p) => p || [0, 1.2, 0]);
    pose.feet = [coords(27), coords(28)].map((p) => p || [0, 0.05, 0]);
    const attacks = [],
      dt = this.previous
        ? clamp((t - this.previous.t) / 1000, 0.015, 0.2)
        : 0.05;
    const source = world?.length === 33 ? world : lm;
    for (let side = 0; side < 2; side++) {
      for (let kind = 0; kind < 2; kind++) {
        const slot = side + kind * 2,
          root = (kind ? 23 : 11) + side,
          joint = (kind ? 25 : 13) + side,
          tip = (kind ? 27 : 15) + side;
        if (![root, joint, tip].every((i) => visible(lm[i]))) {
          this.armed[slot] = true;
          continue;
        }
        const length =
          distance(source[root], source[joint]) +
          distance(source[joint], source[tip]);
        const extension =
          distance(source[root], source[tip]) / Math.max(0.01, length);
        const prev = this.previous?.lm[tip],
          speed = prev ? distance(lm[tip], prev) / shoulder / dt : 0;
        const prevWorld = this.previous?.source[tip];
        const forward = prevWorld ? (prevWorld.z - source[tip].z) / dt : 0;
        const raised = lm[tip].y < lm[23 + side].y + torso * 0.75;
        if (extension < 0.72 || (kind && (!raised || speed < 0.3)))
          this.armed[slot] = true;
        const previousExtension =
          this.previous?.extensions?.[slot] ?? extension;
        const extending =
          extension - previousExtension > 0.008 || forward > 0.35;
        const trigger = kind
          ? raised &&
            speed > 1.8 / this.sensitivity &&
            (extension > 0.68 || forward > 0.4)
          : extension > 0.78 && speed > 2.0 / this.sensitivity && extending;
        if (
          this.baseline &&
          !this.calibrating &&
          this.previous &&
          this.armed[slot] &&
          trigger &&
          t - this.last[slot] > (kind ? 750 : 340)
        ) {
          attacks.push({
            type: kind ? "kick" : "punch",
            side: side ? "right" : "left",
            target: kind && lm[tip].y > lm[11].y ? "body" : "head",
            power: clamp(0.55 + speed * 0.08, 0.55, 1.05),
          });
          this.armed[slot] = false;
          this.last[slot] = t;
        }
        if (!pose.extensions) pose.extensions = [];
        pose.extensions[slot] = extension;
      }
    }
    this.previous = {
      lm: structuredClone(lm),
      source: structuredClone(source),
      t,
      extensions: pose.extensions,
    };
    delete pose.extensions;
    if (this.smoothed) {
      for (const k of ["headX", "headY", "retreat"])
        pose[k] = this.smoothed[k] * 0.35 + pose[k] * 0.65;
    }
    this.smoothed = { ...pose };
    const quality = Math.round(
      ([0, 11, 12, 15, 16, 23, 24, 27, 28].filter((i) => visible(lm[i]))
        .length /
        9) *
        100,
    );
    return {
      pose,
      attacks,
      quality,
      calibrated: !!this.baseline,
      calibrating: this.calibrating,
      progress: this.calibrating
        ? clamp((t - this.calibrationStart) / 2000, 0, 1)
        : 1,
    };
  }
}
