// Which GPU did the browser give WebGL, and is it a real one? With graphics acceleration turned
// off (or a broken driver) browsers fall back to a software rasteriser that runs on the CPU:
// Chrome/Edge on Windows use "Microsoft Basic Render Driver" (WARP), elsewhere SwiftShader or
// llvmpipe. Everything then renders many times slower. No DOM access: also used in the worker.

export function rendererName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return '';
  }
}

export const isSoftware = (name) => /SwiftShader|Basic Render|llvmpipe|softpipe|\bWARP\b|Software/i.test(name);

// "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x…) Direct3D11 …)" → the GPU's name.
export function gpuName(name) {
  const m = name.match(/ANGLE \([^,]*,\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,|\))/i);
  return (m ? m[1] : name || 'unknown GPU').trim();
}

// Does WebGL in this context (page or worker) run on a real GPU?
export function webglIsSoftware() {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
    if (!gl) return true;
    const name = rendererName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return isSoftware(name);
  } catch {
    return false;
  }
}
