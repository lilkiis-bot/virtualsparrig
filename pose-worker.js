let landmarker;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const { FilesetResolver, PoseLandmarker } = await import(
        "../vendor/vision/vision_bundle.mjs"
      );
      const vision = await FilesetResolver.forVisionTasks(data.wasm);
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.model, delegate: "CPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
      });
      self.postMessage({ type: "ready" });
    } else if (data.type === "frame" && landmarker) {
      const result = landmarker.detectForVideo(data.image, data.time);
      data.image.close();
      self.postMessage({
        type: "pose",
        landmarks: result.landmarks[0] || null,
        world: result.worldLandmarks[0] || null,
        time: data.time,
      });
    }
  } catch (e) {
    data.image?.close();
    self.postMessage({ type: "error", message: e.message });
  }
};
