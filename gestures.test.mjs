import test from "node:test";
import assert from "node:assert/strict";
import { GestureEngine } from "../src/gestures.js";
function landmarks() {
  const a = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  Object.assign(a[0], { x: 0.5, y: 0.18, z: -0.1 });
  for (let s = 0; s < 2; s++) {
    Object.assign(a[11 + s], { x: s ? 0.6 : 0.4, y: 0.35 });
    Object.assign(a[13 + s], { x: s ? 0.7 : 0.3, y: 0.48 });
    Object.assign(a[15 + s], { x: s ? 0.64 : 0.36, y: 0.38 });
    Object.assign(a[19 + s], { ...a[15 + s] });
    Object.assign(a[23 + s], { x: s ? 0.56 : 0.44, y: 0.6 });
    Object.assign(a[25 + s], { x: s ? 0.56 : 0.44, y: 0.76 });
    Object.assign(a[27 + s], { x: s ? 0.56 : 0.44, y: 0.94 });
  }
  return a;
}
function calibrated() {
  const e = new GestureEngine();
  e.calibrate();
  for (let i = 0; i <= 40; i++) e.process(landmarks(), null, i * 50);
  return e;
}
test("calibration requires measured frames over two seconds", () => {
  const e = new GestureEngine();
  e.calibrate();
  e.process(landmarks(), null, 0);
  e.process(landmarks(), null, 2100);
  assert.equal(e.baseline, null);
  assert.ok(calibrated().baseline);
});
test("one hand at face activates guard; lowering it removes guard", () => {
  const e = calibrated(),
    lm = landmarks();
  Object.assign(lm[15], { x: 0.48, y: 0.19, z: -0.15 });
  assert.equal(e.process(lm, null, 2100).pose.guard, true);
  assert.equal(e.process(landmarks(), null, 2200).pose.guard, false);
});
test("body loss clears tracking and does not emit attacks", () => {
  const r = calibrated().process(null, null, 2100);
  assert.equal(r.pose.tracked, false);
  assert.deepEqual(r.attacks, []);
});
test("fast extending arm emits one punch and held extension cannot spam", () => {
  const e = calibrated(),
    lm = landmarks();
  Object.assign(lm[13], { x: 0.4, y: 0.32, z: -0.15 });
  Object.assign(lm[15], { x: 0.4, y: 0.28, z: -0.4 });
  const first = e.process(lm, null, 2050);
  assert.ok(first.attacks.some((a) => a.type === "punch" && a.side === "left"));
  assert.equal(e.process(lm, null, 2100).attacks.length, 0);
  assert.equal(e.process(lm, null, 2600).attacks.length, 0);
});
test("stationary pose never becomes an attack", () => {
  const e = calibrated();
  for (let i = 1; i < 30; i++)
    assert.equal(e.process(landmarks(), null, 2000 + i * 50).attacks.length, 0);
});
test("raised extending foot triggers kick; holding it raised does not repeat", () => {
  const e = calibrated(),
    lm = landmarks();
  Object.assign(lm[25], { x: 0.44, y: 0.58, z: -0.2 });
  Object.assign(lm[27], { x: 0.44, y: 0.5, z: -0.55 });
  const result = e.process(lm, null, 2050);
  assert.ok(result.attacks.some((a) => a.type === "kick" && a.side === "left"));
  assert.equal(
    e.process(lm, null, 2150).attacks.filter((a) => a.type === "kick").length,
    0,
  );
});
test("head movement maps to lateral dodge and smaller body scale to retreat", () => {
  const e = calibrated(),
    lm = landmarks();
  lm[0].x += 0.25;
  assert.ok(Math.abs(e.process(lm, null, 2050).pose.headX) > 0.3);
  const far = landmarks();
  for (const p of far) {
    p.x = 0.5 + (p.x - 0.5) * 0.65;
    p.y = 0.5 + (p.y - 0.5) * 0.65;
  }
  assert.ok(e.process(far, null, 2100).pose.retreat > 0.5);
});
