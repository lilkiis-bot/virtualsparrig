import { GestureEngine } from "./gestures.js";
export class Tracker {
  constructor(video, onPose, onStatus) {
    this.video = video;
    this.onPose = onPose;
    this.onStatus = onStatus;
    this.engine = new GestureEngine();
    this.running = false;
    this.generation = 0;
  }
  async start() {
    if (this.running) return;
    const generation = ++this.generation;
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "카메라는 HTTPS 또는 localhost 주소에서 사용할 수 있습니다. GitHub Pages 주소로 열어 주세요.",
      );
    this.onStatus("카메라 접근을 허용해 주세요.");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (generation !== this.generation) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.video.srcObject = this.stream;
      await this.video.play();
      this.onStatus("동작 인식 모델을 준비하고 있습니다…");
      try {
        await this.initWorker();
      } catch {
        this.worker?.terminate();
        this.worker = null;
        await this.initMain();
      }
      if (generation !== this.generation) {
        this.stop();
        return;
      }
      this.running = true;
      this.lastVideo = -1;
      this.lastInfer = 0;
      this.busy = false;
      this.engine.reset();
      this.engine.calibrate();
      this.onStatus(
        "정면을 보고 편안히 서세요. 2초 동안 기준 자세를 보정합니다.",
      );
      this.loop();
      this.stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (this.running) {
          this.stop();
          this.onStatus("카메라 연결이 끊겼습니다. 다시 연결해 주세요.");
        }
      });
    } catch (e) {
      this.stop();
      const message = {
        NotAllowedError:
          "카메라 권한이 거절됐습니다. 브라우저의 사이트 설정에서 카메라를 허용해 주세요.",
        NotFoundError:
          "사용 가능한 카메라를 찾지 못했습니다. 터치 모드로 플레이할 수 있습니다.",
        NotReadableError:
          "다른 앱에서 카메라를 사용 중입니다. 카메라를 사용하는 앱을 닫아 주세요.",
      }[e.name];
      throw new Error(message || e.message);
    }
  }
  async initWorker() {
    if (!window.Worker || !window.createImageBitmap)
      throw new Error("worker unavailable");
    this.worker = new Worker(new URL("./pose-worker.js", import.meta.url));
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("worker timeout")),
        20000,
      );
      this.worker.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("worker init"));
      };
      this.worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (data.type === "error") {
          clearTimeout(timeout);
          reject(new Error(data.message));
        }
      };
      this.worker.postMessage({
        type: "init",
        wasm: new URL("../vendor/vision/", import.meta.url).href,
        model: new URL("../vendor/pose_landmarker_lite.task", import.meta.url)
          .href,
      });
    });
    this.worker.onerror = () =>
      this.fail("동작 인식이 중단됐습니다. 카메라를 다시 연결해 주세요.");
    this.worker.onmessage = ({ data }) => {
      this.busy = false;
      if (data.type === "pose")
        this.consume(data.landmarks, data.world, data.time);
      else if (data.type === "error")
        this.fail(
          "동작 인식에 문제가 생겼습니다. 카메라를 다시 연결해 주세요.",
        );
    };
  }
  async initMain() {
    const { FilesetResolver, PoseLandmarker } = await import(
      "../vendor/vision/vision_bundle.mjs"
    );
    const vision = await FilesetResolver.forVisionTasks(
      new URL("../vendor/vision/", import.meta.url).href,
    );
    const options = {
      baseOptions: {
        modelAssetPath: new URL(
          "../vendor/pose_landmarker_lite.task",
          import.meta.url,
        ).href,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    };
    try {
      this.model = await PoseLandmarker.createFromOptions(vision, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      this.model = await PoseLandmarker.createFromOptions(vision, options);
    }
  }
  consume(lm, world, time) {
    if (!this.running) return;
    const result = this.engine.process(lm, world, time);
    this.onPose(result, lm);
  }
  async loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    if (
      this.busy ||
      now - this.lastInfer < (this.worker ? 45 : 75) ||
      this.video.readyState < 2 ||
      this.lastVideo === this.video.currentTime
    )
      return;
    this.lastVideo = this.video.currentTime;
    this.lastInfer = now;
    this.busy = true;
    try {
      if (this.worker) {
        const bitmap = await createImageBitmap(this.video);
        if (!this.running) {
          bitmap.close();
          return;
        }
        this.worker.postMessage({ type: "frame", image: bitmap, time: now }, [
          bitmap,
        ]);
      } else {
        const result = this.model.detectForVideo(this.video, now);
        this.consume(result.landmarks[0], result.worldLandmarks[0], now);
        this.busy = false;
      }
    } catch {
      this.busy = false;
      this.fail("카메라 프레임을 읽을 수 없습니다. 다시 연결해 주세요.");
    }
  }
  fail(message) {
    this.stop();
    this.onStatus(message);
  }
  stop() {
    this.generation++;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.worker?.terminate();
    this.worker = null;
    this.model?.close();
    this.model = null;
    this.busy = false;
  }
}
