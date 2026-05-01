// All API calls use relative URLs — no BASE prefix needed.
// In production the frontend is served from the same FastAPI origin.

export async function apiHealth() {
  const r = await fetch('/health');
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

export async function apiBrowse(path = '') {
  const r = await fetch(`/browse?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(`browse ${r.status}`);
  return r.json();
}

export function videoUrl(path) {
  return `/video?path=${encodeURIComponent(path)}`;
}

// Returns a Blob (video/mp4)
export async function apiClip(path, start, end, exact = true) {
  const r = await fetch('/clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, start, end, exact }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`clip ${r.status}: ${txt}`);
  }
  return r.blob();
}

export async function apiTracksForVideo(sourceRelPath) {
  const r = await fetch(`/tracks_for_video?path=${encodeURIComponent(sourceRelPath)}`);
  if (!r.ok) throw new Error(`tracks_for_video ${r.status}`);
  return r.json();
}

// FormData-based track call with bounding box
export async function apiTrack(videoBlob, bbox, srcWidth, srcHeight, config, clipMeta = {}) {
  const fd = new FormData();
  fd.append('video', videoBlob, 'clip.mp4');
  fd.append('x1', String(Math.round(bbox.x1)));
  fd.append('y1', String(Math.round(bbox.y1)));
  fd.append('x2', String(Math.round(bbox.x2)));
  fd.append('y2', String(Math.round(bbox.y2)));
  fd.append('src_width', String(srcWidth));
  fd.append('src_height', String(srcHeight));
  fd.append('mask_alpha', String(config.alpha));
  const rgb = hexToRgb(config.color);
  fd.append('mask_r', String(rgb.r));
  fd.append('mask_g', String(rgb.g));
  fd.append('mask_b', String(rgb.b));
  fd.append('draw_box', config.drawBox ? 'true' : 'false');
  fd.append('sample_fps', String(config.sampleFps));
  if (clipMeta.sourcePath) fd.append('source_path', clipMeta.sourcePath);
  if (clipMeta.clipStartSec != null && clipMeta.clipEndSec != null) {
    fd.append('clip_start_sec', String(clipMeta.clipStartSec));
    fd.append('clip_end_sec', String(clipMeta.clipEndSec));
  }

  const r = await fetch('/track', { method: 'POST', body: fd });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`track ${r.status}: ${txt}`);
  }
  return r.json();
}

// FormData-based track call with brush mask
export async function apiTrackBrush(videoBlob, maskBlob, srcWidth, srcHeight, config, clipMeta = {}) {
  const fd = new FormData();
  fd.append('video', videoBlob, 'clip.mp4');
  fd.append('mask_png', maskBlob, 'mask.png');
  fd.append('src_width', String(srcWidth));
  fd.append('src_height', String(srcHeight));
  fd.append('mask_alpha', String(config.alpha));
  const rgb = hexToRgb(config.color);
  fd.append('mask_r', String(rgb.r));
  fd.append('mask_g', String(rgb.g));
  fd.append('mask_b', String(rgb.b));
  fd.append('draw_box', config.drawBox ? 'true' : 'false');
  fd.append('sample_fps', String(config.sampleFps));
  if (clipMeta.sourcePath) fd.append('source_path', clipMeta.sourcePath);
  if (clipMeta.clipStartSec != null && clipMeta.clipEndSec != null) {
    fd.append('clip_start_sec', String(clipMeta.clipStartSec));
    fd.append('clip_end_sec', String(clipMeta.clipEndSec));
  }

  const r = await fetch('/track_brush', { method: 'POST', body: fd });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`track_brush ${r.status}: ${txt}`);
  }
  return r.json();
}

export function overlayVideoUrl(jobId) {
  return `/track_result/${jobId}/overlay.mp4`;
}

export async function apiManifest(jobId) {
  const r = await fetch(`/track_result/${jobId}/manifest`);
  if (!r.ok) throw new Error(`manifest ${r.status}`);
  return r.json();
}

export function frameUrl(jobId, fname) {
  return `/track_result/${jobId}/frame/${fname}`;
}

export function maskUrl(jobId, fname) {
  return `/track_result/${jobId}/mask/${fname}`;
}

export function overlayFrameUrl(jobId, frameFname, maskFname, alpha, color, drawBox) {
  const colorHex = color.replace('#', '');
  return `/track_result/${jobId}/overlay_frame/${frameFname}/${maskFname}?alpha=${alpha}&color=${colorHex}&draw_box=${drawBox ? '1' : '0'}`;
}

export async function apiGetProjects() {
  const r = await fetch('/projects');
  if (!r.ok) throw new Error(`projects ${r.status}`);
  return r.json();
}

export async function apiCreateProject(name, description = '') {
  const r = await fetch('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`create project ${r.status}: ${txt}`);
  }
  return r.json();
}

export async function apiSavePairs(jobId, projectName, frameIndices, prefix = '') {
  const r = await fetch('/save_pairs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: jobId,
      project_name: projectName,
      frame_indices: frameIndices,
      prefix,
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`save_pairs ${r.status}: ${txt}`);
  }
  return r.json();
}

// Helper: convert hex color string to {r,g,b}
export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return {
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  };
}
