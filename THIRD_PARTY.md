# Sources, attribution and license scope

Shadow Room's MIT license applies to original application code only. The files in `vendor/` are redistributed unmodified under their own licenses.

| Source | Used here | Terms / retained notice |
| --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) r160 | 3D rendering, shadows, post-processing passes (`vendor/three/`) | MIT; [vendor/three/LICENSE](vendor/three/LICENSE). |
| [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.21 | Pose Landmarker runtime and WebAssembly files (`vendor/mediapipe/`) | Apache-2.0; [vendor/mediapipe/LICENSE](vendor/mediapipe/LICENSE). |
| [MediaPipe Pose Landmarker (lite, float16, v1)](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) | Body landmarks and segmentation mask (`vendor/models/pose_landmarker_lite.task`) | Apache-2.0, released by Google with MediaPipe; see the [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf) for intended use and limitations. |
| [One Euro filter](https://gery.casiez.net/1euro/) | Smoothing of head position and turn (`src/oneEuro.js`) | Original implementation of the published method by Casiez, Roussel & Vogel, *CHI 2012*. |

The pose model file is byte-identical to Google's published file:

```text
https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
sha256 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a
```

The room, its textures (wood, rug, fabric, paintings, city, TV picture), the cat and the demo figure are generated in code. No image, font or 3D model files are bundled apart from the Lively thumbnail and the README media in `docs/media/`, which were recorded from the app itself. The interface uses system fonts.
