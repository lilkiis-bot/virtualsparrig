import { mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const files = {
  "vendor/three.module.js":
    "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
  "vendor/three.core.js":
    "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.core.js",
  "vendor/THREE-LICENSE.txt":
    "https://cdn.jsdelivr.net/npm/three@0.186.1/LICENSE",
  "vendor/peerjs.min.js":
    "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js",
  "vendor/PEERJS-LICENSE.txt":
    "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/LICENSE",
  "vendor/vision/vision_bundle.mjs":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs",
  "vendor/vision/vision_wasm_internal.js":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_internal.js",
  "vendor/vision/vision_wasm_internal.wasm":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_internal.wasm",
  "vendor/vision/vision_wasm_nosimd_internal.js":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_nosimd_internal.js",
  "vendor/vision/vision_wasm_nosimd_internal.wasm":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_nosimd_internal.wasm",
  "vendor/vision/MEDIAPIPE-LICENSE.txt":
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/README.md",
  "vendor/vision/APACHE-LICENSE.txt":
    "https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.32/LICENSE",
  "vendor/pose_landmarker_lite.task":
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
};
await Promise.all(
  Object.entries(files).map(async ([name, url]) => {
    const destination = path.join(root, name);
    if ((await stat(destination).catch(() => null))?.size > 100) return;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
    console.log(`${name}: ${(data.length / 1024).toFixed(0)} KB`);
  }),
);
