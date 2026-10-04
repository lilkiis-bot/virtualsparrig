# Third-party components

Project-specific code is provided for the user's use and modification. Third-party assets retain their original licenses.

| Component | Pinned version / source | License / notice |
| --- | --- | --- |
| Three.js | 0.186.1, https://github.com/mrdoob/three.js | MIT; `vendor/THREE-LICENSE.txt` |
| PeerJS client | 1.5.5, https://github.com/peers/peerjs | MIT; `vendor/PEERJS-LICENSE.txt` |
| MediaPipe Tasks Vision | 0.10.32, https://github.com/google-ai-edge/mediapipe | Apache-2.0; `vendor/vision/APACHE-LICENSE.txt`, package README in `MEDIAPIPE-LICENSE.txt` |
| Pose Landmarker Lite | float16, model revision 1; Google MediaPipe model distribution | Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task ; model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker |
| Optional PeerServer | 1.0.2, installed separately | MIT; https://github.com/peers/peerjs-server |

All URLs in `tools/setup-assets.mjs` specify exact package versions or a model revision. No remote images, fonts, recordings, or proprietary character models are included. Character meshes and audio are generated locally by the application.
