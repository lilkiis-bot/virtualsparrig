import * as T from "../vendor/three.module.js";
const mix = (a, b, t) => a + (b - a) * t;
export class Arena {
  constructor(container, onError) {
    this.container = container;
    this.animations = [null, null];
    this.time = 0;
    this.onError = onError;
    try {
      this.renderer = new T.WebGLRenderer({
        antialias: devicePixelRatio < 2,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      onError(
        "이 브라우저에서 3D 그래픽을 시작하지 못했습니다. 최신 Safari 또는 Chrome에서 다시 열어 주세요.",
      );
      return;
    }
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x0b1520);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      onError("3D 화면이 중단됐습니다. 페이지를 새로고침해 주세요.");
    });
    this.scene = new T.Scene();
    this.scene.fog = new T.FogExp2(0x0c1722, 0.072);
    this.camera = new T.PerspectiveCamera(55, 1, 0.05, 45);
    this.camera.position.set(0, 1.58, 2.9);
    this.scene.add(new T.HemisphereLight(0xc8e3f4, 0x17252e, 2.6));
    const key = new T.DirectionalLight(0xd4e8ff, 3);
    key.position.set(2, 6, 3);
    this.scene.add(key);
    const red = new T.PointLight(0xff3b55, 8, 6);
    red.position.set(0, 2, -1);
    this.scene.add(red);
    const cyan = new T.PointLight(0x75eaca, 5, 5);
    cyan.position.set(0, 1.5, 2);
    this.scene.add(cyan);
    this.buildCage();
    this.enemy = this.fighter();
    this.enemy.root.position.set(0.35, 0, -0.6);
    this.scene.add(this.enemy.root);
    this.hands = [this.glove(0x9ce8d4), this.glove(0x9ce8d4)];
    this.feet = [this.foot(0x9ce8d4), this.foot(0x9ce8d4)];
    for (const mesh of [...this.hands, ...this.feet]) this.scene.add(mesh);
    this.spark = new T.Mesh(
      new T.RingGeometry(0.05, 0.075, 28),
      new T.MeshBasicMaterial({
        color: 0xc5ffe9,
        transparent: true,
        opacity: 0,
        side: T.DoubleSide,
      }),
    );
    this.scene.add(this.spark);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  resize() {
    if (!this.renderer) return;
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = w < h ? 65 : 54;
    this.camera.updateProjectionMatrix();
  }
  material(color, opacity = 0.48) {
    return new T.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity,
      roughness: 0.32,
      metalness: 0.3,
      depthWrite: false,
    });
  }
  mesh(geometry, material, parent, position = [0, 0, 0]) {
    const m = new T.Mesh(geometry, material);
    m.position.set(...position);
    parent.add(m);
    return m;
  }
  outline(mesh, color = 0xff7181) {
    const edges = new T.LineSegments(
      new T.EdgesGeometry(mesh.geometry, 32),
      new T.LineBasicMaterial({ color, transparent: true, opacity: 0.34 }),
    );
    mesh.add(edges);
  }
  glove(color) {
    const g = new T.Group(),
      mat = this.material(color, 0.84);
    const palm = this.mesh(
      new T.SphereGeometry(0.13, 14, 10),
      mat,
      g,
      [0, 0, 0],
    );
    palm.scale.set(1, 1.12, 1.25);
    this.mesh(
      new T.CapsuleGeometry(0.072, 0.1, 4, 10),
      this.material(color, 0.65),
      g,
      [0, -0.1, 0.03],
    );
    const band = this.mesh(
      new T.CylinderGeometry(0.085, 0.078, 0.065, 12),
      new T.MeshStandardMaterial({ color: 0x172a32, roughness: 0.75 }),
      g,
      [0, -0.13, 0.04],
    );
    band.rotation.x = 0.15;
    this.outline(palm, color);
    return g;
  }
  foot(color) {
    const g = new T.Group();
    const shape = this.mesh(
      new T.CapsuleGeometry(0.075, 0.15, 4, 12),
      this.material(color, 0.7),
      g,
    );
    shape.rotation.x = Math.PI / 2;
    this.outline(shape, color);
    return g;
  }
  fighter() {
    const root = new T.Group(),
      mat = this.material(0xff465b, 0.3),
      head = this.mesh(
        new T.SphereGeometry(0.185, 20, 14),
        this.material(0xff5267, 0.48),
        root,
        [0, 1.77, 0],
      );
    head.scale.set(0.88, 1.15, 0.97);
    this.outline(head);
    const face = this.mesh(
      new T.BoxGeometry(0.18, 0.028, 0.04),
      this.material(0xffa0a4, 0.9),
      head,
      [0, 0.015, 0.17],
    );
    const torso = this.mesh(
      new T.CylinderGeometry(0.26, 0.17, 0.58, 8),
      mat,
      root,
      [0, 1.23, 0],
    );
    torso.scale.z = 0.68;
    this.outline(torso);
    const pelvis = this.mesh(
      new T.CylinderGeometry(0.17, 0.18, 0.2, 8),
      mat,
      root,
      [0, 0.85, 0],
    );
    this.outline(pelvis);
    const hands = [this.glove(0xff5365), this.glove(0xff5365)],
      feet = [this.foot(0xff5365), this.foot(0xff5365)];
    for (const p of [...hands, ...feet]) root.add(p);
    const limbs = [];
    for (let i = 0; i < 8; i++) {
      const limb = this.mesh(
        new T.CylinderGeometry(0.037, 0.047, 1, 8),
        this.material(0xff5267, 0.22),
        root,
      );
      limbs.push(limb);
    }
    return { root, head, torso, pelvis, hands, feet, limbs };
  }
  link(mesh, a, b) {
    const av = new T.Vector3(...a),
      bv = new T.Vector3(...b),
      delta = bv.clone().sub(av);
    mesh.position.copy(av.add(bv).multiplyScalar(0.5));
    mesh.scale.y = delta.length();
    mesh.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      delta.normalize(),
    );
  }
  buildCage() {
    const floor = this.mesh(
      new T.CylinderGeometry(4.5, 4.5, 0.16, 8),
      new T.MeshStandardMaterial({
        color: 0x233540,
        roughness: 0.88,
        metalness: 0.08,
      }),
      this.scene,
      [0, -0.13, 0],
    );
    floor.rotation.y = Math.PI / 8;
    const ringPoints = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      ringPoints.push(
        new T.Vector3(Math.cos(a) * 4.42, 0.005, Math.sin(a) * 4.42),
      );
    }
    this.scene.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints(ringPoints),
        new T.LineBasicMaterial({
          color: 0x79d9c3,
          transparent: true,
          opacity: 0.6,
        }),
      ),
    );
    const inner = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      inner.push(new T.Vector3(Math.cos(a) * 2.0, 0.006, Math.sin(a) * 2.0));
    }
    this.scene.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints(inner),
        new T.LineBasicMaterial({
          color: 0x536b79,
          transparent: true,
          opacity: 0.5,
        }),
      ),
    );
    const tex = document.createElement("canvas");
    tex.width = 1024;
    tex.height = 1024;
    const c = tex.getContext("2d");
    c.translate(512, 512);
    c.strokeStyle = "#668390";
    c.lineWidth = 2;
    for (let i = -480; i < 500; i += 50) {
      c.beginPath();
      c.moveTo(i, -500);
      c.lineTo(i, 500);
      c.stroke();
      c.beginPath();
      c.moveTo(-500, i);
      c.lineTo(500, i);
      c.stroke();
    }
    c.clearRect(-370, -95, 740, 190);
    c.fillStyle = "#a1b4b9";
    c.textAlign = "center";
    c.font = "bold 105px Arial";
    c.fillText("OCTAGON", 0, 18);
    c.font = "22px Arial";
    c.fillText("M O T I O N   S P A R R I N G", 0, 75);
    const texture = new T.CanvasTexture(tex);
    texture.colorSpace = T.SRGBColorSpace;
    const print = this.mesh(
      new T.PlaneGeometry(5.3, 5.3),
      new T.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      this.scene,
      [0, 0.008, 0],
    );
    print.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8,
        b = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
      const p = [Math.cos(a) * 4.42, 0, Math.sin(a) * 4.42],
        q = [Math.cos(b) * 4.42, 0, Math.sin(b) * 4.42];
      this.mesh(
        new T.CylinderGeometry(0.048, 0.06, 2.05, 8),
        new T.MeshStandardMaterial({
          color: 0x345260,
          metalness: 0.6,
          roughness: 0.6,
        }),
        this.scene,
        [p[0], 1, p[2]],
      );
      const points = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        points.push(
          new T.Vector3(mix(p[0], q[0], t), 0.06, mix(p[2], q[2], t)),
          new T.Vector3(mix(p[0], q[0], t), 1.98, mix(p[2], q[2], t)),
        );
      }
      for (let h = 0.08; h < 2; h += 0.13)
        points.push(new T.Vector3(p[0], h, p[2]), new T.Vector3(q[0], h, q[2]));
      this.scene.add(
        new T.LineSegments(
          new T.BufferGeometry().setFromPoints(points),
          new T.LineBasicMaterial({
            color: 0x627b87,
            transparent: true,
            opacity: 0.18,
          }),
        ),
      );
      for (const y of [0.06, 2]) {
        const rail = this.mesh(
          new T.CylinderGeometry(0.027, 0.027, 1, 6),
          new T.MeshStandardMaterial({ color: y === 2 ? 0x557887 : 0x244a4b }),
          this.scene,
        );
        this.link(rail, [p[0], y, p[2]], [q[0], y, q[2]]);
      }
    }
    for (const z of [-5, -7]) {
      for (const x of [-3, 3]) {
        const light = this.mesh(
          new T.BoxGeometry(0.6, 0.035, 0.12),
          new T.MeshBasicMaterial({ color: 0xcbe9f5 }),
          this.scene,
          [x, 3.8, z],
        );
      }
    }
    const shadow = this.mesh(
      new T.CircleGeometry(0.43, 32),
      new T.MeshBasicMaterial({
        color: 0x090d14,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
      this.scene,
      [0, 0.012, -0.6],
    );
    shadow.rotation.x = -Math.PI / 2;
  }
  attack(player, a) {
    this.animations[player] = {
      ...a,
      visualStart:
        performance.now() +
        Math.max(
          0,
          (a.impact - a.start || 0) - (a.type === "kick" ? 290 : 170),
        ),
    };
  }
  impact(kind) {
    if (!this.renderer) return;
    this.sparkStart = performance.now();
    this.spark.material.color.set(kind === "block" ? 0x9df3d5 : 0xffffff);
  }
  animate(now, me, opponent, active = false) {
    if (!this.renderer) return;
    const dt = Math.min(0.05, (now - (this.lastTime || now)) / 1000);
    this.lastTime = now;
    const smooth = 1 - Math.exp(-dt * 14),
      e = this.enemy,
      bob = Math.sin(now * 0.0028) * 0.018;
    const ex = (active ? 0 : 0.38) - opponent.headX * 0.6;
    e.root.position.x = mix(e.root.position.x, ex, smooth);
    e.root.position.z = mix(
      e.root.position.z,
      -0.48 - opponent.retreat,
      smooth,
    );
    e.head.position.set(-opponent.headX * 0.6, 1.77 + opponent.headY + bob, 0);
    e.torso.rotation.z = opponent.headX * 0.3;
    e.torso.position.y = 1.23 + bob;
    this.camera.position.x = mix(
      this.camera.position.x,
      me.headX * 0.5,
      smooth,
    );
    this.camera.position.y = mix(
      this.camera.position.y,
      1.62 + me.headY * 0.5,
      smooth,
    );
    this.camera.position.z = mix(
      this.camera.position.z,
      2.6 + me.retreat * 0.65,
      smooth,
    );
    this.camera.lookAt(0, 1.23, -0.55);
    const eHands = [
        [-0.28, opponent.guard ? 1.72 : 1.33, 0.3],
        [0.28, opponent.guard ? 1.72 : 1.43, 0.32],
      ],
      eFeet = [
        [-0.2, 0.08, 0.16],
        [0.2, 0.08, -0.1],
      ],
      pHands = [
        [-0.38, me.guard ? 1.56 : 1.14, 1.76],
        [0.38, me.guard ? 1.56 : 1.12, 1.8],
      ],
      pFeet = [
        [-0.25, 0.25, 1.55],
        [0.25, 0.25, 1.55],
      ];
    if (opponent.hands) {
      opponent.hands.forEach((p, i) => {
        eHands[i] = [-p[0], p[1], -p[2] + 0.05];
      });
    }
    if (opponent.feet) {
      opponent.feet.forEach((p, i) => {
        eFeet[i] = [-p[0], p[1], -p[2]];
      });
    }
    if (me.hands) {
      me.hands.forEach((p, i) => {
        pHands[i] = [p[0], Math.max(0.8, p[1]), 1.8 + p[2] * 0.45];
      });
    }
    if (me.feet) {
      me.feet.forEach((p, i) => {
        pFeet[i] = [p[0], p[1], 1.8 + p[2] * 0.5];
      });
    }
    for (let id = 0; id < 2; id++) {
      const a = this.animations[id];
      if (!a) continue;
      const elapsed = now - a.visualStart,
        duration = a.type === "kick" ? 590 : 400,
        progress = Math.max(0, elapsed / duration);
      if (progress >= 1) {
        this.animations[id] = null;
        continue;
      }
      const f = Math.sin(progress * Math.PI),
        side = a.side === "right" ? 1 : 0;
      const hands = id === 0 ? pHands : eHands,
        feet = id === 0 ? pFeet : eFeet;
      if (a.type === "punch") {
        hands[side][0] = mix(hands[side][0], id === 0 ? a.aimX : -a.aimX, f);
        hands[side][1] = mix(hands[side][1], 1.68 + a.aimY, f);
        hands[side][2] += f * (id === 0 ? -1.65 : 1.6);
      } else {
        feet[side][1] = mix(feet[side][1], a.target === "head" ? 1.7 : 1.08, f);
        feet[side][2] += f * (id === 0 ? -1.75 : 1.5);
        feet[side][0] = mix(feet[side][0], a.aimX, f);
      }
    }
    for (let i = 0; i < 2; i++) {
      e.hands[i].position.set(...eHands[i]);
      e.feet[i].position.set(...eFeet[i]);
      this.hands[i].position.set(
        pHands[i][0] + me.headX * 0.3,
        pHands[i][1] + me.headY * 0.3,
        pHands[i][2] + me.retreat * 0.6,
      );
      this.hands[i].rotation.set(-0.3, 0, i === 0 ? -0.2 : 0.2);
      this.feet[i].position.set(...pFeet[i]);
      this.feet[i].visible =
        pFeet[i][1] > 0.35 ||
        (!!this.animations[0] && this.animations[0].type === "kick");
      const s = i === 0 ? -1 : 1,
        elbow = [s * 0.4, 1.12, eHands[i][2] * 0.4],
        knee = [s * 0.22, 0.44, eFeet[i][2] * 0.5];
      this.link(e.limbs[i * 4], [s * 0.24, 1.5, 0], elbow);
      this.link(e.limbs[i * 4 + 1], elbow, eHands[i]);
      this.link(e.limbs[i * 4 + 2], [s * 0.14, 0.85, 0], knee);
      this.link(e.limbs[i * 4 + 3], knee, eFeet[i]);
    }
    const age = now - (this.sparkStart || -1e5);
    this.spark.material.opacity = Math.max(0, 1 - age / 350);
    this.spark.position.set(e.root.position.x, 1.7, e.root.position.z + 0.23);
    this.spark.scale.setScalar(1 + age / 90);
    if (age > 400) this.spark.visible = false;
    else this.spark.visible = true;
    this.renderer.render(this.scene, this.camera);
  }
}
