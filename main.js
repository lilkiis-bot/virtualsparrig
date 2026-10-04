import { Combat, FORMATS, neutralPose, clamp } from "./combat.js";
import { Arena } from "./arena.js";
import { Tracker } from "./tracking.js";
import { Network } from "./network.js";
import { Sound } from "./audio.js";
const $ = (id) => document.getElementById(id),
  sound = new Sound();
let mode = "ai",
  localId = 0,
  matchId = "",
  view = null,
  myReady = false,
  otherReady = false,
  localPose = neutralPose(),
  cameraPose = neutralPose(),
  cameraActive = false,
  calibrated = false,
  loadingCamera = false,
  roundActive = false,
  lastPoseAt = 0,
  aiNext = 0,
  aiSlipUntil = 0,
  frameCount = 0,
  fpsTime = performance.now(),
  lastDraw = 0,
  lastNet = 0,
  lastSnapshot = 0,
  feedbackTimer,
  toastTimer,
  readyTimer,
  wakeLock;
const holds = new Set(),
  predicted = new Set();
const arena = new Arena($("scene"), (message) => {
  $("render-error").textContent = message;
  $("render-error").hidden = false;
  $("start-btn").disabled = true;
});
const combat = new Combat(onCombatEvent);
const net = new Network(onNetworkMessage, (message) => {
  $("network-status").textContent = message;
});
const tracker = new Tracker($("camera-video"), onPose, (message) => {
  $("camera-status").textContent = message;
  if (cameraActive && !tracker.running) {
    cameraActive = false;
    calibrated = false;
    cameraUI();
    pauseMatch();
  }
});
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function feedback(text, kind = "hit", duration = 800) {
  $("feedback").textContent = text;
  $("feedback").dataset.kind = kind;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => ($("feedback").textContent = ""), duration);
}
function current() {
  return mode === "online" && net.role === "guest" && view
    ? view
    : combat.snapshot();
}
function active() {
  return ["countdown", "fight", "break", "paused"].includes(current().phase);
}
function opponentPose() {
  return mode === "online"
    ? net.remotePose(performance.now()) || neutralPose()
    : combat.players[1].pose;
}
function cameraUI() {
  $("camera-badge").textContent = cameraActive
    ? "카메라 모드"
    : "터치 / 키보드";
  $("camera-btn").hidden = cameraActive;
  $("calibration-row").hidden = !cameraActive;
  $("camera-btn").disabled = loadingCamera;
  if (!cameraActive) {
    $("tracking-status").textContent = "카메라 대기 중";
    $("tracking-quality").textContent = "—";
    drawSkeleton(null);
  }
}
function drawSkeleton(lm) {
  const canvas = $("pose-canvas"),
    c = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = "#38505b";
  c.lineWidth = 0.5;
  for (let x = 0; x < w; x += 22) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  for (let y = 0; y < h; y += 22) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  const edges = [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
    [11, 23],
    [12, 24],
    [23, 24],
    [23, 25],
    [25, 27],
    [24, 26],
    [26, 28],
    [27, 31],
    [28, 32],
  ];
  if (!lm) {
    c.strokeStyle = "#54706f";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(187, 27, 8, 0, Math.PI * 2);
    c.moveTo(187, 35);
    c.lineTo(187, 78);
    c.moveTo(168, 45);
    c.lineTo(206, 45);
    c.moveTo(168, 45);
    c.lineTo(157, 68);
    c.moveTo(206, 45);
    c.lineTo(217, 68);
    c.moveTo(187, 78);
    c.lineTo(169, 119);
    c.moveTo(187, 78);
    c.lineTo(205, 119);
    c.stroke();
    return;
  }
  const point = (p) => [(1 - p.x) * w, p.y * h];
  c.strokeStyle = "#89f3ce";
  c.lineWidth = 1.7;
  for (const [a, b] of edges) {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4)
      continue;
    c.beginPath();
    c.moveTo(...point(lm[a]));
    c.lineTo(...point(lm[b]));
    c.stroke();
  }
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]) {
    if ((lm[i].visibility ?? 1) < 0.4) continue;
    c.beginPath();
    c.arc(...point(lm[i]), i === 0 ? 4 : 2.5, 0, Math.PI * 2);
    c.fillStyle = "#afffe5";
    c.fill();
  }
}
function onPose(result, lm) {
  cameraPose = result.pose;
  lastPoseAt = performance.now();
  const justCalibrated = !calibrated && result.calibrated;
  calibrated = result.calibrated;
  drawSkeleton(lm);
  $("tracking-quality").textContent = result.quality + "%";
  $("tracking-status").textContent = result.calibrating
    ? `기준 자세 보정 ${Math.round(result.progress * 100)}%`
    : result.pose.tracked
      ? result.quality < 90
        ? "발까지 보이도록 서 주세요"
        : "전신 추적 중"
      : "몸이 화면에서 벗어났습니다";
  if (justCalibrated) {
    $("camera-status").textContent =
      "보정 완료. 스파링 시작을 누르고 손과 발을 움직여 보세요.";
    toast("기준 자세 보정 완료");
  }
  if (result.calibrated && !result.calibrating && result.pose.tracked)
    for (const a of result.attacks) strike(a);
}
async function startCamera() {
  if (loadingCamera) return;
  loadingCamera = true;
  cameraUI();
  try {
    await tracker.start();
    cameraActive = tracker.running;
    calibrated = false;
  } catch (e) {
    $("camera-status").textContent = e.message;
    toast(e.message);
  } finally {
    loadingCamera = false;
    cameraUI();
  }
}
function buildLocalPose(now) {
  const pose = cameraActive ? structuredClone(cameraPose) : neutralPose();
  if (
    cameraActive &&
    (!calibrated || tracker.engine.calibrating || now - lastPoseAt > 650)
  )
    pose.tracked = false;
  if (holds.has("guard")) pose.guard = true;
  if (holds.has("left")) pose.headX = -0.52;
  if (holds.has("right")) pose.headX = 0.52;
  if (holds.has("back")) pose.retreat = 0.85;
  return pose;
}
function strike(input) {
  if (current().phase !== "fight") return;
  const now = performance.now(),
    opp = opponentPose();
  const a = {
    ...input,
    id: crypto.randomUUID?.() || `${now}-${Math.random()}`,
    aimX: opp.headX,
    aimY: opp.headY,
    power: input.power ?? 0.96,
  };
  if (mode === "online" && net.role === "guest") {
    // The host checks cooldown, energy, timestamps, target bounds and duplicate IDs.
    if (now - (strike.lastLocal || -1e5) < (a.type === "kick" ? 720 : 330))
      return;
    strike.lastLocal = now;
    predicted.add(a.id);
    if (predicted.size > 128) predicted.delete(predicted.values().next().value);
    arena.attack(0, a);
    net.send({
      type: "attack",
      attack: a,
      pose: buildLocalPose(now),
      time: now,
      matchId,
    });
  } else {
    combat.setPose(0, buildLocalPose(now), now);
    combat.attack(0, a, now);
  }
  if (
    mode === "ai" &&
    Math.random() <
      { easy: 0.05, normal: 0.13, hard: 0.24 }[$("difficulty").value]
  )
    aiSlipUntil = now + 500;
}
function onCombatEvent(event) {
  if (mode === "online" && net.role === "host")
    net.send({ type: "event", event, matchId });
  showEvent(event);
}
function showEvent(event) {
  if (event.kind === "attack") {
    const local = event.attack.player === localId;
    if (!(local && predicted.has(event.attack.id)))
      arena.attack(local ? 0 : 1, event.attack);
    return;
  }
  if (event.kind === "bell") {
    sound.play("bell");
    feedback(`ROUND ${event.round}`, "hit", 1200);
    return;
  }
  if (event.kind === "break") {
    sound.play("bell");
    feedback("CORNER BREAK", "miss", 2000);
    return;
  }
  if (event.kind === "end") {
    sound.play("bell");
    return;
  }
  if (!event.attack) return;
  const mine = event.attack.player === localId;
  if (["hit", "perfect"].includes(event.kind)) {
    sound.play("hit");
    if (mine) {
      arena.impact(event.kind);
      feedback(event.kind === "perfect" ? "PERFECT SHOT" : "CLEAN HIT");
    } else {
      feedback(event.kind === "perfect" ? "PERFECT SHOT" : "HIT", "damage");
      $("hit-flash").classList.add("hit");
      setTimeout(() => $("hit-flash").classList.remove("hit"), 180);
    }
  } else if (event.kind === "block") {
    sound.play("block");
    if (mine) arena.impact("block");
    feedback(mine ? "BLOCKED" : "GUARD", "miss");
  } else if (event.kind === "dodge")
    feedback(mine ? "MISSED" : "DODGE", "miss");
}
function setMode(value) {
  if (active()) {
    toast("현재 경기를 종료한 뒤 모드를 바꿀 수 있습니다.");
    return;
  }
  net.close(false);
  clearTimeout(readyTimer);
  mode = value;
  localId = 0;
  myReady = false;
  otherReady = false;
  view = null;
  combat.reset($("format").value);
  $("mode-ai").classList.toggle("selected", value === "ai");
  $("mode-online").classList.toggle("selected", value === "online");
  $("mode-ai").setAttribute("aria-pressed", value === "ai");
  $("mode-online").setAttribute("aria-pressed", value === "online");
  $("ai-options").hidden = value !== "ai";
  $("online-options").hidden = value !== "online";
  $("enemy-name").textContent = value === "ai" ? "AI FIGHTER" : "OPPONENT";
  $("room-box").hidden = true;
  $("join-form").hidden = true;
  $("network-metrics").hidden = true;
  $("format").disabled = false;
  $("network-status").textContent = "방장이 경기 판정을 맡습니다.";
  $("footer-status").textContent =
    value === "ai"
      ? "AI 스파링 · 영상 전송 없음"
      : "1:1 온라인 · 관절과 게임 상태만 전송";
}
async function openRoom(role, code) {
  if (active()) return;
  myReady = false;
  otherReady = false;
  view = null;
  localId = role === "host" ? 0 : 1;
  setRoomBusy(true);
  try {
    const actual = await net.open(role, code);
    $("room-code").textContent = actual;
    $("room-box").hidden = false;
    $("join-form").hidden = true;
    $("format").disabled = role === "guest";
  } catch (e) {
    $("network-status").textContent = e.message;
    toast(e.message);
  } finally {
    setRoomBusy(false);
  }
}
function setRoomBusy(busy) {
  $("host-room").disabled = busy;
  $("show-join").disabled = busy;
}
function onNetworkMessage(d) {
  const now = performance.now();
  if (d.type === "connected") {
    otherReady = false;
    myReady = false;
    if (net.role === "host")
      net.send({ type: "config", format: $("format").value });
    return;
  }
  if (d.type === "disconnected") {
    const wasActive = roundActive;
    view = null;
    localId = 0;
    if (wasActive) combat.end(null, "DISCONNECTED");
    myReady = false;
    otherReady = false;
    $("room-box").hidden = true;
    $("format").disabled = false;
    toast("대전 연결이 종료됐습니다.");
    return;
  }
  if (d.type === "pose") {
    if (net.role === "host") combat.setPose(1, d.pose, d.time);
    return;
  }
  if (
    d.type === "config" &&
    net.role === "guest" &&
    FORMATS[d.format] &&
    !active()
  ) {
    $("format").value = d.format;
    combat.reset(d.format);
    myReady = false;
    otherReady = false;
    net.send({ type: "ready", ready: false });
    return;
  }
  if (d.type === "ready") {
    otherReady = d.ready === true;
    $("network-status").textContent = otherReady
      ? "상대 준비 완료"
      : "상대가 준비 중입니다.";
    maybeStartOnline();
    return;
  }
  if (
    d.type === "start" &&
    net.role === "guest" &&
    FORMATS[d.format] &&
    typeof d.matchId === "string"
  ) {
    matchId = d.matchId;
    predicted.clear();
    combat.start(now, d.format);
    view = combat.snapshot();
    view.phaseEnd = d.start - net.offset + 3000;
    roundActive = true;
    focusArena();
    return;
  }
  if (d.type === "attack" && net.role === "host" && d.matchId === matchId) {
    combat.setPose(1, d.pose, clamp(d.time - net.offset, now - 250, now));
    if (d.attack) {
      const { windup, ...input } = d.attack;
      combat.attack(
        1,
        input,
        now,
        Number.isFinite(d.time) ? d.time - net.offset : now,
      );
    }
    return;
  }
  if (
    d.type === "event" &&
    net.role === "guest" &&
    d.matchId === matchId &&
    d.event &&
    typeof d.event.kind === "string"
  )
    showEvent(d.event);
  if (
    d.type === "snapshot" &&
    net.role === "guest" &&
    d.matchId === matchId &&
    validSnapshot(d.state)
  ) {
    view = d.state;
    view.phaseEnd -= net.offset;
    view.received = now;
    return;
  }
  if (d.type === "pause" && net.role === "host") {
    combat.pause(now);
    $("network-status").textContent = "상대가 경기를 일시 정지했습니다.";
    return;
  }
  if (d.type === "resume" && net.role === "host") {
    if (localPose.tracked) combat.resume(now);
    return;
  }
  if (d.type === "reset") {
    if (net.role === "host" && combat.phase === "ended") resetMatch();
    else if (net.role === "guest") {
      view = null;
      combat.reset($("format").value);
      myReady = false;
      otherReady = false;
      roundActive = false;
      matchId = "";
    }
    return;
  }
}
function validSnapshot(s) {
  return (
    s &&
    ["idle", "countdown", "fight", "break", "paused", "ended"].includes(
      s.phase,
    ) &&
    Number.isFinite(s.phaseEnd) &&
    Array.isArray(s.players) &&
    s.players.length === 2 &&
    s.players.every(
      (p) =>
        Number.isFinite(p.hp) &&
        p.hp >= 0 &&
        p.hp <= 100 &&
        Number.isFinite(p.stamina) &&
        p.pose,
    )
  );
}
function maybeStartOnline() {
  if (net.role !== "host" || !myReady || !otherReady || active()) return;
  if (net.samples < 3) {
    $("network-status").textContent = "통신 지연을 측정하고 있습니다…";
    clearTimeout(readyTimer);
    readyTimer = setTimeout(maybeStartOnline, 250);
    return;
  }
  const now = performance.now();
  matchId = crypto.randomUUID();
  combat.start(now, $("format").value);
  net.send({ type: "start", format: $("format").value, start: now, matchId });
  roundActive = true;
  focusArena();
  aiNext = now + 4000;
}
function focusArena() {
  if (innerWidth < 901)
    document
      .querySelector(".arena")
      .scrollIntoView({ block: "start", behavior: "smooth" });
}
async function acquireWake() {
  try {
    if ("wakeLock" in navigator)
      wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    /* A wake lock is optional. */
  }
}
function startMatch() {
  if ($("render-error").hidden === false) return;
  if (
    cameraActive &&
    (!calibrated || tracker.engine.calibrating || !cameraPose.tracked)
  ) {
    toast("몸 전체를 카메라에 맞추고 기준 자세 보정을 완료해 주세요.");
    return;
  }
  if (active()) return;
  if (mode === "online") {
    if (!net.connected) {
      toast("먼저 방을 만들거나 친구의 방에 참가해 주세요.");
      return;
    }
    myReady = !myReady;
    net.send({ type: "ready", ready: myReady });
    maybeStartOnline();
  } else {
    combat.start(performance.now(), $("format").value);
    roundActive = true;
    aiNext = performance.now() + 3800;
    focusArena();
  }
  acquireWake();
}
function pauseMatch() {
  const s = current();
  if (!["fight", "countdown", "break"].includes(s.phase)) return;
  if (mode === "online" && net.role === "guest") net.send({ type: "pause" });
  else combat.pause(performance.now());
  holds.clear();
}
function togglePause() {
  if (current().phase === "paused") {
    if (cameraActive && (!localPose.tracked || !calibrated)) {
      toast("카메라 안으로 돌아온 뒤 계속하기를 눌러 주세요.");
      return;
    }
    if (mode === "online" && net.role === "guest") net.send({ type: "resume" });
    else combat.resume(performance.now());
    acquireWake();
  } else pauseMatch();
}
function resetMatch() {
  if (mode === "online" && net.role === "guest") {
    net.send({ type: "reset" });
    return;
  }
  combat.reset($("format").value);
  view = null;
  roundActive = false;
  myReady = false;
  otherReady = false;
  predicted.clear();
  if (mode === "online") net.send({ type: "reset" });
}
function updateAI(now) {
  const p = neutralPose(),
    level = $("difficulty").value,
    s = combat.players[1],
    busy = s.attack && now < s.attack.impact + 220;
  p.headX = Math.sin(now * 0.00085) * 0.055;
  p.guard =
    !busy &&
    Math.sin(now * (level === "hard" ? 0.0031 : 0.002) + 1) >
      (level === "easy" ? 0.76 : level === "hard" ? 0.12 : 0.5);
  if (now < aiSlipUntil) {
    p.headX = 0.43;
    p.retreat = 0.12;
  }
  combat.setPose(1, p, now);
  if (combat.phase === "fight" && now > aiNext && localPose.tracked) {
    const type = Math.random() < 0.27 ? "kick" : "punch";
    combat.attack(
      1,
      {
        id: `ai-${now}`,
        type,
        side: Math.random() < 0.5 ? "left" : "right",
        target: type === "kick" && Math.random() < 0.65 ? "body" : "head",
        aimX: localPose.headX,
        aimY: localPose.headY,
        power: level === "hard" ? 0.96 : 0.8,
        windup: level === "easy" ? 780 : level === "hard" ? 360 : 570,
      },
      now,
    );
    aiNext =
      now +
      (level === "easy" ? 2300 : level === "hard" ? 1100 : 1750) +
      Math.random() * 650;
  }
}
function updateHUD(now) {
  const s = current(),
    me = s.players[localId] || s.players[0],
    other = s.players[1 - localId] || s.players[1],
    playing = active();
  $("welcome").hidden = s.phase !== "idle";
  $("your-hp").textContent = Math.ceil(me.hp);
  $("enemy-hp").textContent = Math.ceil(other.hp);
  $("your-health").style.width = me.hp + "%";
  $("enemy-health").style.width = other.hp + "%";
  $("your-stamina").style.width = me.stamina + "%";
  $("enemy-stamina").style.width = other.stamina + "%";
  let remaining =
    s.phase === "idle" ? FORMATS[$("format").value].seconds : s.remaining;
  if (
    mode === "online" &&
    net.role === "guest" &&
    ["fight", "countdown", "break"].includes(s.phase)
  )
    remaining = Math.max(0, (s.phaseEnd - now) / 1000);
  remaining = Math.ceil(remaining);
  if (s.phase === "countdown") {
    $("timer").textContent = String(Math.max(1, remaining));
  } else
    $("timer").textContent =
      `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  $("round-label").textContent =
    `ROUND ${String(s.round).padStart(2, "0")} / ${String(s.phase === "idle" ? FORMATS[$("format").value].rounds : s.rounds).padStart(2, "0")}`;
  $("match-state").textContent = {
    idle: "READY",
    countdown: "GET READY",
    fight: "LIVE",
    break: "REST · 15 SEC",
    paused: "PAUSED",
    ended: s.reason === "PERFECT SHOT KO" ? "PERFECT KO" : "FINISHED",
  }[s.phase];
  document.body.classList.toggle("battle-active", playing);
  $("quit-training").hidden = mode !== "ai" || s.phase !== "paused";
  $("arena-pause").hidden = !playing;
  $("arena-pause").textContent = s.phase === "paused" ? "▶" : "Ⅱ";
  $("start-btn").hidden = playing || s.phase === "ended";
  $("start-btn").querySelector("span").textContent =
    mode === "online"
      ? myReady
        ? "준비 완료 · 상대 기다리는 중"
        : "대전 준비"
      : "스파링 시작";
  $("pause-btn").hidden = !playing;
  $("pause-btn").textContent = s.phase === "paused" ? "계속하기" : "일시 정지";
  $("format").disabled = playing || (mode === "online" && net.role === "guest");
  $("difficulty").disabled = playing;
  setRoomBusy(playing);
  $("result").hidden = s.phase !== "ended";
  if (s.phase === "ended") {
    const win = s.winner === localId;
    $("result-title").textContent =
      s.reason === "DISCONNECTED"
        ? "연결 종료"
        : s.reason === "PERFECT SHOT KO"
          ? win
            ? "PERFECT KO!"
            : "KNOCKED OUT"
          : s.reason === "KO"
            ? win
              ? "KNOCKOUT!"
              : "KNOCKED OUT"
            : s.winner === null
              ? "무승부"
              : win
                ? "판정승"
                : "판정패";
    $("result-detail").textContent =
      s.reason === "DISCONNECTED"
        ? "연결이 끊겨 경기를 중단했습니다."
        : `${s.round}라운드 · 적중 ${me.hits}회 · 방어 ${me.blocks}회 · 회피 ${me.dodges}회${s.reason === "DECISION" ? ` · 점수 ${me.score} : ${other.score}` : ""}`;
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  const def = localPose.guard
    ? "GUARD · 한 손 방어"
    : localPose.retreat > 0.48
      ? "STEP BACK · 후방 회피"
      : Math.abs(localPose.headX) > 0.25
        ? "SLIP · 좌우 회피"
        : "NEUTRAL · 기본 자세";
  $("defense-badge").textContent = def;
  $("defense-badge").classList.toggle("guarding", localPose.guard);
  $("stat-hits").textContent = me.hits;
  $("stat-blocks").textContent = me.blocks;
  $("stat-dodges").textContent = me.dodges;
  $("stat-accuracy").textContent = me.attempts
    ? Math.round((me.hits / me.attempts) * 100) + "%"
    : "—";
  const attack = mode === "ai" ? combat.players[1].attack : other.attack;
  const imminent =
    attack &&
    s.phase === "fight" &&
    now < attack.impact - (net.role === "guest" ? net.offset : 0);
  $("telegraph").hidden = !imminent;
  if (imminent)
    $("telegraph").textContent =
      attack.type === "kick"
        ? "킥 준비 · 거리를 벌리세요"
        : "펀치 준비 · 가드 또는 회피";
  $("network-metrics").hidden = !net.connected;
  if (net.connected) {
    $("ping").textContent = Math.round(net.rtt) + " ms";
    $("jitter").textContent = Math.round(net.jitter) + " ms";
    $("buffer").textContent = Math.round(net.buffer) + " ms";
    if (net.rtt > 400)
      $("network-status").textContent =
        "지연이 큽니다. 가까운 Wi-Fi 환경을 권장합니다.";
  }
}
function loop(now) {
  requestAnimationFrame(loop);
  localPose = buildLocalPose(now);
  if (mode === "ai") {
    combat.setPose(0, localPose, now);
    updateAI(now);
    combat.tick(now);
  } else if (net.role === "host") {
    combat.setPose(0, localPose, now);
    const remote = net.remotePose(now);
    if (remote?.tracked === false && combat.phase === "fight") {
      combat.pause(now);
      $("network-status").textContent =
        "상대 동작 수신이 중단되어 일시 정지했습니다.";
    }
    combat.tick(now, Math.min(250, net.rtt * 0.5 + net.jitter + 25));
  }
  if (
    cameraActive &&
    !localPose.tracked &&
    ["fight", "countdown", "break"].includes(current().phase)
  )
    pauseMatch();
  if (net.connected && now - lastNet > 40) {
    lastNet = now;
    net.sendPose(localPose, now);
  }
  if (net.role === "host" && net.connected && now - lastSnapshot > 80) {
    lastSnapshot = now;
    net.send({ type: "snapshot", state: combat.snapshot(), matchId });
  }
  arena.animate(now, localPose, opponentPose(), current().phase !== "idle");
  if (now - lastDraw > 80) {
    lastDraw = now;
    updateHUD(now);
  }
  frameCount++;
  if (now - fpsTime > 1000) {
    $("fps-label").textContent =
      `${Math.round((frameCount * 1000) / (now - fpsTime))} FPS · ${cameraActive ? "CAM" : "TOUCH"}`;
    frameCount = 0;
    fpsTime = now;
  }
}
const actionMap = {
  leftPunch: { type: "punch", side: "left" },
  rightPunch: { type: "punch", side: "right" },
  leftKick: { type: "kick", side: "left", target: "body" },
  rightKick: { type: "kick", side: "right", target: "head" },
};
document.querySelectorAll("[data-action]").forEach((b) =>
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    strike(actionMap[b.dataset.action]);
    b.classList.add("active");
    setTimeout(() => b.classList.remove("active"), 160);
  }),
);
document.querySelectorAll("[data-hold]").forEach((b) => {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    holds.add(b.dataset.hold);
    b.classList.add("active");
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    b.addEventListener(event, () => {
      holds.delete(b.dataset.hold);
      b.classList.remove("active");
    });
});
const keys = { j: "leftPunch", k: "rightPunch", u: "leftKick", i: "rightKick" },
  holdKeys = { " ": "guard", a: "left", d: "right", s: "back" };
window.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
    $("help-dialog").open
  )
    return;
  const key = e.key.toLowerCase();
  if (keys[key] || holdKeys[key]) e.preventDefault();
  if (e.repeat) return;
  if (keys[key]) strike(actionMap[keys[key]]);
  if (holdKeys[key]) {
    holds.add(holdKeys[key]);
    document
      .querySelector(`[data-hold="${holdKeys[key]}"]`)
      ?.classList.add("active");
  }
  if (key === "escape") pauseMatch();
});
window.addEventListener("keyup", (e) => {
  const value = holdKeys[e.key.toLowerCase()];
  if (value) {
    holds.delete(value);
    document
      .querySelector(`[data-hold="${value}"]`)
      ?.classList.remove("active");
  }
});
window.addEventListener("blur", () => {
  holds.clear();
  document
    .querySelectorAll(".move-buttons .active")
    .forEach((b) => b.classList.remove("active"));
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseMatch();
  else if (active()) acquireWake();
});
window.addEventListener("pagehide", () => {
  tracker.stop();
  net.close(false);
  wakeLock?.release().catch(() => {});
});
$("mode-ai").onclick = () => setMode("ai");
$("mode-online").onclick = () => setMode("online");
$("camera-btn").onclick = startCamera;
$("camera-stop").onclick = () => {
  pauseMatch();
  tracker.stop();
  cameraActive = false;
  calibrated = false;
  cameraUI();
  $("camera-status").textContent =
    "카메라를 껐습니다. 터치 / 키보드 모드로 계속할 수 있습니다.";
};
$("calibrate").onclick = () => {
  pauseMatch();
  calibrated = false;
  tracker.engine.calibrate();
  $("camera-status").textContent =
    "정면을 보고 2초 동안 기준 자세를 유지해 주세요.";
};
$("sensitivity").oninput = (e) => {
  tracker.engine.sensitivity = Number(e.target.value) / 100;
  $("sensitivity-value").textContent =
    e.target.value < 85 ? "낮음" : e.target.value > 115 ? "높음" : "보통";
};
$("start-btn").onclick = startMatch;
$("quick-start").onclick = startMatch;
$("pause-btn").onclick = togglePause;
$("rematch").onclick = resetMatch;
$("host-room").onclick = () => openRoom("host");
$("show-join").onclick = () => {
  $("join-form").hidden = false;
  $("room-input").focus();
};
$("join-form").onsubmit = (e) => {
  e.preventDefault();
  const code = $("room-input").value.trim();
  if (!/^\d{4}$/.test(code)) {
    toast("숫자 4자리 코드를 입력해 주세요.");
    return;
  }
  openRoom("guest", code);
};
$("room-input").oninput = (e) =>
  (e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4));
$("leave-room").onclick = () => {
  net.close();
  setMode("online");
};
$("room-code").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("room-code").textContent);
    toast("방 코드를 복사했습니다.");
  } catch {
    toast("방 코드: " + $("room-code").textContent);
  }
};
$("format").onchange = () => {
  if (!active()) {
    combat.reset($("format").value);
    if (mode === "online" && net.role === "host") {
      myReady = false;
      otherReady = false;
      net.send({ type: "config", format: $("format").value });
      net.send({ type: "ready", ready: false });
    }
  }
};
$("sound-btn").onclick = async () => {
  const on = await sound.toggle();
  $("sound-btn").setAttribute("aria-pressed", on);
  $("sound-btn").setAttribute("aria-label", on ? "효과음 끄기" : "효과음 켜기");
  if (on) sound.play("bell");
};
$("help-btn").onclick = () => {
  $("help-dialog").showModal();
  pauseMatch();
};
$("close-help").onclick = $("help-done").onclick = () =>
  $("help-dialog").close();
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.querySelector(".arena").requestFullscreen)
      await document.querySelector(".arena").requestFullscreen();
    else toast("이 기기에서는 가로 화면으로 플레이해 주세요.");
  } catch {
    toast("전체 화면을 사용할 수 없습니다. 가로 화면으로 플레이해 주세요.");
  }
};
$("arena-pause").onclick = togglePause;
$("quit-training").onclick = () => {
  resetMatch();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
};
drawSkeleton(null);
requestAnimationFrame(loop);
