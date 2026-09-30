// Pose tracking worker: runs MediaPipe off the main thread, so a detection (or the multi-second
// warm-up of the first one) never delays a rendered frame.
// Deliberately a classic worker, not a module worker: MediaPipe loads its WASM glue with
// importScripts(), which module workers do not allow. The engine itself is an ES module.
let engine = null;

import('./poseEngine.js')
  .then(({ PoseEngine }) => new PoseEngine().load())
  .then((e) => { engine = e; postMessage({ type: 'ready', delegate: e.delegate }); })
  .catch((err) => postMessage({ type: 'error', message: String((err && err.message) || err) }));

onmessage = ({ data }) => {
  if (data.type !== 'frame') return;
  const { id, bitmap, ts, buffers } = data;
  let out = null;
  let error = null;
  try {
    if (engine) {
      engine.recycle(buffers || []);
      out = engine.detect(bitmap, ts);
    }
  } catch (err) {
    error = String((err && err.message) || err);
  }
  // Send the frame back too: it is what the tracking view shows as "what the computer sees".
  const transfer = [bitmap];
  if (out) for (const p of out.people) transfer.push(p.rgba);
  postMessage({ type: 'result', id, out, error, bitmap }, transfer);
};
