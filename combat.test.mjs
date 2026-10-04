import test from "node:test";
import assert from "node:assert/strict";
import {
  Combat,
  FORMATS,
  History,
  judgeStrike,
  neutralPose,
  sanitizePose,
} from "../src/combat.js";
const attack = (extra = {}) => ({
  type: "punch",
  target: "head",
  aimX: 0,
  aimY: 0,
  power: 1,
  energy: 100,
  ...extra,
});
test("one-hand face guard cancels ALL punch damage", () => {
  assert.equal(
    judgeStrike(
      attack(),
      { ...neutralPose(), guard: true },
      neutralPose(),
      true,
    ).damage,
    0,
  );
});
test("unprotected clean punch damages; body kick bypasses face guard", () => {
  assert.equal(judgeStrike(attack(), neutralPose(), neutralPose()).damage, 10);
  assert.equal(
    judgeStrike(
      attack({ type: "kick", target: "body" }),
      { ...neutralPose(), guard: true },
      neutralPose(),
    ).damage,
    17,
  );
});
test("lateral, duck and backward evasion avoid strikes", () => {
  for (const p of [{ headX: 0.5 }, { headY: -0.4 }, { retreat: 0.65 }])
    assert.equal(
      judgeStrike(attack(), { ...neutralPose(), ...p }, neutralPose()).damage,
      0,
    );
});
test("perfect KO requires counter timing, center aim, full power and energy", () => {
  assert.equal(
    judgeStrike(attack(), neutralPose(), neutralPose(), true).ko,
    true,
  );
  for (const a of [
    attack({ power: 0.8 }),
    attack({ energy: 30 }),
    attack({ aimX: 0.15 }),
  ])
    assert.equal(judgeStrike(a, neutralPose(), neutralPose(), true).ko, false);
  assert.equal(
    judgeStrike(attack(), neutralPose(), neutralPose(), false).ko,
    false,
  );
});
test("missing tracking never awards a hit", () => {
  assert.equal(
    judgeStrike(attack(), { ...neutralPose(), tracked: false }, neutralPose())
      .damage,
    0,
  );
});
test("host rejects cooldown spam, duplicate attacks and exhausted attacks", () => {
  const c = new Combat();
  c.start(0);
  c.tick(3000);
  const first = c.attack(0, { ...attack(), id: "first" }, 3001);
  assert.ok(first);
  assert.equal(c.attack(0, { ...attack(), id: "spam" }, 3002), null);
  assert.equal(c.attack(0, { ...attack(), id: "first" }, 4000), null);
  c.players[0].stamina = 0;
  assert.equal(c.attack(0, { ...attack(), id: "empty" }, 5000), null);
});
test("lag-compensated impact samples guard at impact, not delivery time", () => {
  const events = [],
    c = new Combat((e) => events.push(e));
  c.start(0);
  c.tick(3000);
  c.setPose(0, neutralPose(), 3000);
  c.setPose(1, { ...neutralPose(), guard: true }, 3000);
  c.attack(0, { ...attack(), id: "lag" }, 3010);
  c.setPose(1, neutralPose(), 3240);
  c.tick(3400, 150);
  assert.equal(c.players[1].hp, 100);
  assert.ok(events.find((e) => e.kind === "block"));
});
test("KO ends immediately and cancels queued damage", () => {
  const c = new Combat();
  c.start(0);
  c.tick(3000);
  c.players[1].hp = 5;
  c.attack(0, { ...attack(), id: "ko" }, 3100);
  c.tick(3300);
  assert.equal(c.phase, "ended");
  assert.equal(c.winner, 0);
  assert.equal(c.reason, "KO");
  assert.equal(c.pending.length, 0);
});
test("perfect counter produces immediate KO from full health in the live engine", () => {
  const c = new Combat();
  c.start(0);
  c.tick(3000);
  c.attack(1, { ...attack({ power: 0.6 }), id: "opponent", windup: 570 }, 3100);
  c.attack(0, { ...attack(), id: "counter" }, 3490);
  c.tick(3690);
  assert.equal(c.phase, "ended");
  assert.equal(c.winner, 0);
  assert.equal(c.reason, "PERFECT SHOT KO");
});
test("late packets resolve in impact-time order rather than arrival order", () => {
  const c = new Combat();
  c.start(0);
  c.tick(3000);
  c.players.forEach((p) => (p.hp = 5));
  c.attack(1, { ...attack(), id: "slow", windup: 600 }, 3100);
  c.attack(0, { ...attack(), id: "fast" }, 3400);
  c.tick(3800);
  assert.equal(c.winner, 0);
});
for (const [key, format] of Object.entries(FORMATS))
  test(`${key}: requested durations, breaks and complete decision`, () => {
    const c = new Combat();
    c.start(0, key);
    let now = 3000;
    c.tick(now);
    for (let round = 1; round <= format.rounds; round++) {
      assert.equal(c.round, round);
      assert.equal(c.seconds, format.seconds);
      now = c.phaseEnd;
      c.tick(now);
      if (round < format.rounds) {
        assert.equal(c.phase, "break");
        now = c.phaseEnd;
        c.tick(now);
        assert.equal(c.phase, "countdown");
        now = c.phaseEnd;
        c.tick(now);
      }
    }
    assert.equal(c.phase, "ended");
    assert.equal(c.reason, "DECISION");
    assert.equal(c.players[0].score, format.rounds * 10);
  });
test("pause freezes round and scheduled strikes", () => {
  const c = new Combat();
  c.start(0);
  c.tick(3000);
  c.attack(0, { ...attack(), id: "pause" }, 3100);
  const end = c.phaseEnd,
    impact = c.pending[0].impact;
  c.pause(3150);
  c.tick(20000);
  assert.equal(c.players[1].hp, 100);
  c.resume(21000);
  assert.equal(c.phaseEnd, end + 17850);
  assert.equal(c.pending[0].impact, impact + 17850);
});
test("history is sorted, bounded and does not mutate source poses", () => {
  const h = new History(),
    p = neutralPose();
  h.push(100, p);
  p.guard = true;
  h.push(50, p);
  assert.equal(h.at(110).guard, false);
  h.push(2000, p);
  assert.equal(h.samples.length, 1);
});
test("remote pose sanitizer rejects NaN and clamps displacement", () => {
  assert.equal(sanitizePose({ headX: NaN, headY: 0, retreat: 0 }), null);
  assert.equal(sanitizePose({ ...neutralPose(), headX: 999 }).headX, 0.8);
});
