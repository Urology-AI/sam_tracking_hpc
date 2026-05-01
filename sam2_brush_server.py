""" 1605.00, 1600.00
singularity shell --nv --writable /sc/arion/projects/video_rarp/neel_projects/sam3_dev
SAM2 Video Tracking + Dataset Curation Server
===============================================
Unified backend for Minerva GPU node. Handles:
  1. Video browsing from local filesystem
  2. Clip extraction via native ffmpeg
  3. SAM2 tracking inference
  4. Dataset curation: review tracked frames, sample, delete, export

Launch (inside your environment on GPU node):
    python3 sam2_brush_server.py --port 8892 --video-dir /sc/arion/projects/video_rarp/neel_projects 

Then tunnel from local machine:
    ssh -J gahaln01@minerva.hpc.mssm.edu -L 8892:127.0.0.1:8892 gahaln01@lg03e07
    Open http://localhost:8890
"""

import os
import sys
import cv2
import torch
import numpy as np
import tempfile
import shutil
import subprocess
import uuid
import json
import argparse
import mimetypes
from pathlib import Path
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional

# ── SAM2 imports ─────────────────────────────────────────────────────────────
from sam2.build_sam import build_sam2_video_predictor

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="SAM2 Tracking + Dataset Curation Server")
parser.add_argument("--port", type=int, default=8890)
parser.add_argument("--host", type=str, default="0.0.0.0")
parser.add_argument("--video-dir", type=str, default=".")
parser.add_argument("--projects-dir", type=str, default="./projects")
parser.add_argument("--sam2-checkpoint", type=str,
                    default=os.environ.get("SAM2_CHECKPOINT", "./checkpoints/sam2.1_hiera_large.pt"))
parser.add_argument("--sam2-config", type=str,
                    default=os.environ.get("SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_l.yaml"))

args, _ = parser.parse_known_args()

VIDEO_DIR = os.path.abspath(args.video_dir)
PROJECTS_DIR = os.path.abspath(args.projects_dir)
CLIP_DIR = tempfile.mkdtemp(prefix="sam2_clips_")
TRACK_DIR = tempfile.mkdtemp(prefix="sam2_tracks_")

os.makedirs(PROJECTS_DIR, exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
OBJ_ID = 1

print(f"[server] Video directory:  {VIDEO_DIR}")
print(f"[server] Projects directory: {PROJECTS_DIR}")
print(f"[server] Clip temp dir:    {CLIP_DIR}")
print(f"[server] Track temp dir:   {TRACK_DIR}")
print(f"[server] Device: {DEVICE}")

# Verify ffmpeg
try:
    result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
    ffmpeg_version = result.stdout.split("\n")[0] if result.stdout else "unknown"
    print(f"[server] ffmpeg: {ffmpeg_version}")
except FileNotFoundError:
    print("[server] ERROR: ffmpeg not found!")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# MODEL
# ─────────────────────────────────────────────────────────────────────────────
predictor = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global predictor
    print(f"[startup] Loading SAM2 on {DEVICE}...")
    print(f"[startup]   checkpoint: {args.sam2_checkpoint}")
    print(f"[startup]   config:     {args.sam2_config}")
    predictor = build_sam2_video_predictor(
        args.sam2_config, args.sam2_checkpoint, device=DEVICE,
    )
    print("[startup] SAM2 loaded")
    yield
    predictor = None
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


app = FastAPI(title="SAM2 Tracker + Curator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# SERVE FRONTEND
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR   = os.path.join(SCRIPT_DIR, "frontend", "dist")


@app.get("/", response_class=HTMLResponse)
def serve_frontend():
    # Prefer the built React app; fall back to the legacy HTML during development
    index_path = os.path.join(DIST_DIR, "index.html")
    if not os.path.exists(index_path):
        index_path = os.path.join(SCRIPT_DIR, "index_brush.html")
    if not os.path.exists(index_path):
        raise HTTPException(404, detail="Frontend not found. Run: cd frontend && npm install && npm run build")
    with open(index_path, "r") as f:
        return HTMLResponse(content=f.read())


# Serve Vite's hashed static assets (JS/CSS bundles)
_assets_dir = os.path.join(DIST_DIR, "assets")
if os.path.isdir(_assets_dir):
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {
        "status": "ok",
        "sam2_loaded": predictor is not None,
        "device": DEVICE,
        "video_dir": VIDEO_DIR,
        "projects_dir": PROJECTS_DIR,
        "ffmpeg": True,
    }


# ─────────────────────────────────────────────────────────────────────────────
# BROWSE VIDEOS
# ─────────────────────────────────────────────────────────────────────────────
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".flv", ".wmv"}


@app.get("/browse")
def browse_videos(path: str = Query(default="")):
    # Normalize VIDEO_DIR to its resolved absolute form for safe comparison
    video_dir_resolved = os.path.realpath(VIDEO_DIR)
    target = os.path.realpath(os.path.join(video_dir_resolved, path))

    # Security: ensure target is within or equal to VIDEO_DIR
    if not (target == video_dir_resolved or target.startswith(video_dir_resolved + os.sep)):
        raise HTTPException(403, detail="Access denied")
    if not os.path.isdir(target):
        raise HTTPException(404, detail=f"Directory not found: {path}")

    entries = []
    try:
        for name in sorted(os.listdir(target)):
            if name.startswith('.'):
                continue
            full = os.path.join(target, name)
            rel = os.path.relpath(full, video_dir_resolved)
            if os.path.isdir(full):
                entries.append({"name": name, "path": rel, "type": "dir"})
            elif os.path.isfile(full):
                ext = os.path.splitext(name)[1].lower()
                if ext in VIDEO_EXTENSIONS:
                    try:
                        size_mb = os.path.getsize(full) / (1024 * 1024)
                    except OSError:
                        size_mb = 0
                    entries.append({
                        "name": name, "path": rel, "type": "video",
                        "size_mb": round(size_mb, 2),
                    })
    except PermissionError:
        raise HTTPException(403, detail="Permission denied")

    is_root = (target == video_dir_resolved)
    current_rel = os.path.relpath(target, video_dir_resolved) if not is_root else ""
    parent_rel = os.path.relpath(os.path.dirname(target), video_dir_resolved) if not is_root else None
    # Fix: relpath returns '.' when same dir
    if current_rel == '.':
        current_rel = ""
    if parent_rel == '.':
        parent_rel = ""

    return {
        "current": current_rel,
        "parent": parent_rel,
        "entries": entries,
    }


# ─────────────────────────────────────────────────────────────────────────────
# STREAM VIDEO (with explicit Range header support)
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/video")
def stream_video(path: str = Query(...), request: Request = None):
    video_dir_resolved = os.path.realpath(VIDEO_DIR)
    full = os.path.realpath(os.path.join(video_dir_resolved, path))
    if not (full == video_dir_resolved or full.startswith(video_dir_resolved + os.sep)):
        raise HTTPException(403, detail="Access denied")
    if not os.path.isfile(full):
        raise HTTPException(404, detail="Video not found")

    mime, _ = mimetypes.guess_type(full)
    media_type = mime or "video/mp4"
    file_size = os.path.getsize(full)

    range_header = request.headers.get("range") if request else None

    if range_header:
        # Parse range: "bytes=start-end"
        range_str = range_header.strip().replace("bytes=", "")
        parts = range_str.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        length = end - start + 1

        def iter_range():
            with open(full, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
            },
        )
    else:
        return FileResponse(full, media_type=media_type)


# ─────────────────────────────────────────────────────────────────────────────
# CLIP VIDEO (native ffmpeg on backend)
# ─────────────────────────────────────────────────────────────────────────────
class ClipRequest(BaseModel):
    path: str
    start: float
    end: float
    exact: bool = True


@app.post("/clip")
def clip_video(req: ClipRequest):
    video_dir_resolved = os.path.realpath(VIDEO_DIR)
    full = os.path.realpath(os.path.join(video_dir_resolved, req.path))
    if not (full == video_dir_resolved or full.startswith(video_dir_resolved + os.sep)):
        raise HTTPException(403, detail="Access denied")
    if not os.path.isfile(full):
        raise HTTPException(404, detail=f"Video not found: {req.path}")
    if req.end <= req.start:
        raise HTTPException(400, detail="end must be > start")

    clip_id = uuid.uuid4().hex[:8]
    output_path = os.path.join(CLIP_DIR, f"clip_{clip_id}.mp4")
    duration = req.end - req.start

    if req.exact:
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{req.start:.3f}",
            "-i", full,
            "-t", f"{duration:.3f}",
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ]
    else:
        src_ext = os.path.splitext(full)[1] or ".mp4"
        output_path = os.path.join(CLIP_DIR, f"clip_{clip_id}{src_ext}")
        cmd = [
            "ffmpeg", "-y",
            "-ss", f"{req.start:.3f}",
            "-i", full,
            "-t", f"{duration:.3f}",
            "-c", "copy",
            "-avoid_negative_ts", "1",
            output_path,
        ]

    print(f"[clip] {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            err = result.stderr[-1500:] if result.stderr else "unknown error"
            raise HTTPException(500, detail=f"ffmpeg failed: {err}")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, detail="ffmpeg timed out")

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise HTTPException(500, detail="ffmpeg produced no output")

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[clip] done {output_path} ({size_mb:.2f} MB)")

    return FileResponse(output_path, media_type="video/mp4", filename=os.path.basename(output_path))


# ─────────────────────────────────────────────────────────────────────────────
# SAM2 HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def extract_frames_sampled(video_path, out_dir, sample_fps):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    if sample_fps <= 0 or sample_fps >= src_fps:
        paths, indices, idx = [], [], 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            fpath = os.path.join(out_dir, f"{idx:06d}.jpg")
            cv2.imwrite(fpath, frame)
            paths.append(fpath)
            indices.append(idx)
            idx += 1
        cap.release()
        return paths, indices, src_fps

    interval = src_fps / sample_fps
    paths, indices = [], []
    next_target, idx, written = 0.0, 0, 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx >= next_target:
            fpath = os.path.join(out_dir, f"{written:06d}.jpg")
            cv2.imwrite(fpath, frame)
            paths.append(fpath)
            indices.append(idx)
            written += 1
            next_target += interval
        idx += 1
    cap.release()
    return paths, indices, src_fps


def overlay_mask(frame, mask, color_bgr, alpha):
    overlay = frame.copy()
    overlay[mask] = color_bgr
    return cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0)


def draw_bbox_from_mask(frame, mask, color, thickness):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return frame
    x1, y1 = int(xs.min()), int(ys.min())
    x2, y2 = int(xs.max()), int(ys.max())
    return cv2.rectangle(frame.copy(), (x1, y1), (x2, y2), color, thickness)


def build_overlay_video(video_path, frame_paths, frame_indices, video_segments,
                        vid_fps, vid_w, vid_h, sample_fps, mask_color_bgr,
                        mask_alpha, do_draw_box, output_path):
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    n_frames = len(frame_paths)

    if sample_fps > 0 and sample_fps < vid_fps:
        cap = cv2.VideoCapture(video_path)
        writer = cv2.VideoWriter(output_path, fourcc, vid_fps, (vid_w, vid_h))
        sampled_map = {orig: si for si, orig in enumerate(frame_indices)}
        fidx = 0
        last_mask = None
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if fidx in sampled_map:
                si = sampled_map[fidx]
                if si in video_segments and OBJ_ID in video_segments[si]:
                    last_mask = video_segments[si][OBJ_ID]
                else:
                    last_mask = None
            if last_mask is not None:
                mask = last_mask
                if mask.shape != (vid_h, vid_w):
                    mask = cv2.resize(mask.astype(np.uint8), (vid_w, vid_h),
                                      interpolation=cv2.INTER_NEAREST).astype(bool)
                frame = overlay_mask(frame, mask, mask_color_bgr, mask_alpha)
                if do_draw_box:
                    frame = draw_bbox_from_mask(frame, mask, mask_color_bgr, 2)
            writer.write(frame)
            fidx += 1
        cap.release()
        writer.release()
    else:
        writer = cv2.VideoWriter(output_path, fourcc, vid_fps, (vid_w, vid_h))
        for idx in range(n_frames):
            frame = cv2.imread(frame_paths[idx])
            if idx in video_segments and OBJ_ID in video_segments[idx]:
                mask = video_segments[idx][OBJ_ID]
                if mask.shape != (vid_h, vid_w):
                    mask = cv2.resize(mask.astype(np.uint8), (vid_w, vid_h),
                                      interpolation=cv2.INTER_NEAREST).astype(bool)
                frame_out = overlay_mask(frame, mask, mask_color_bgr, mask_alpha)
                if do_draw_box:
                    frame_out = draw_bbox_from_mask(frame_out, mask, mask_color_bgr, 2)
                writer.write(frame_out)
            else:
                writer.write(frame)
        writer.release()


def save_frame_assets(frame_paths, frame_indices, video_segments, vid_w, vid_h, track_out):
    frame_manifest = []
    for idx in range(len(frame_paths)):
        frame = cv2.imread(frame_paths[idx])
        frame_fname = f"{idx:06d}.jpg"
        cv2.imwrite(os.path.join(track_out, "frames", frame_fname), frame)

        if idx in video_segments and OBJ_ID in video_segments[idx]:
            mask = video_segments[idx][OBJ_ID]
            if mask.shape != (vid_h, vid_w):
                mask = cv2.resize(mask.astype(np.uint8), (vid_w, vid_h),
                                  interpolation=cv2.INTER_NEAREST).astype(bool)
            mask_fname = f"{idx:06d}.png"
            cv2.imwrite(os.path.join(track_out, "masks", mask_fname),
                        (mask.astype(np.uint8) * 255))
            frame_manifest.append({
                "idx": idx,
                "frame": frame_fname,
                "mask": mask_fname,
                "has_mask": True,
                "original_frame_idx": frame_indices[idx] if idx < len(frame_indices) else idx,
            })
        else:
            frame_manifest.append({
                "idx": idx,
                "frame": frame_fname,
                "mask": None,
                "has_mask": False,
                "original_frame_idx": frame_indices[idx] if idx < len(frame_indices) else idx,
            })
    return frame_manifest


# ─────────────────────────────────────────────────────────────────────────────
# SAM2 TRACKING — bounding box (original)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/track")
async def track(
    video: UploadFile = File(...),
    x1: int = Form(...),
    y1: int = Form(...),
    x2: int = Form(...),
    y2: int = Form(...),
    src_width: int = Form(0),
    src_height: int = Form(0),
    mask_alpha: float = Form(0.45),
    mask_r: int = Form(0),
    mask_g: int = Form(255),
    mask_b: int = Form(0),
    draw_box: str = Form("true"),
    sample_fps: float = Form(0),
):
    if predictor is None:
        raise HTTPException(503, detail="SAM2 model not loaded yet")

    job_id = uuid.uuid4().hex[:8]
    tmp_dir = tempfile.mkdtemp(prefix=f"sam2_job_{job_id}_")

    try:
        video_path = os.path.join(tmp_dir, "input.mp4")
        with open(video_path, "wb") as f:
            content = await video.read()
            f.write(content)

        cap = cv2.VideoCapture(video_path)
        vid_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        bx1, by1, bx2, by2 = float(x1), float(y1), float(x2), float(y2)
        if src_width > 0 and src_height > 0 and (src_width != vid_w or src_height != vid_h):
            sx, sy = vid_w / src_width, vid_h / src_height
            bx1 *= sx; by1 *= sy; bx2 *= sx; by2 *= sy

        bbox_arr = np.array([bx1, by1, bx2, by2], dtype=np.float32)
        print(f"[{job_id}] Video: {vid_w}x{vid_h} @ {vid_fps:.1f}fps | bbox={bbox_arr.tolist()}")

        frames_dir = os.path.join(tmp_dir, "frames")
        os.makedirs(frames_dir)
        frame_paths, frame_indices, _ = extract_frames_sampled(video_path, frames_dir, sample_fps)
        n_frames = len(frame_paths)
        print(f"[{job_id}] Extracted {n_frames} frames (sample_fps={sample_fps})")

        if n_frames == 0:
            raise HTTPException(400, detail="No frames extracted")

        print(f"[{job_id}] Running SAM2 propagation...")
        with torch.inference_mode():
            state = predictor.init_state(video_path=frames_dir)
            predictor.reset_state(state)
            predictor.add_new_points_or_box(
                inference_state=state, frame_idx=0, obj_id=OBJ_ID, box=bbox_arr,
            )
            video_segments = {}
            for fidx, obj_ids, mask_logits in predictor.propagate_in_video(state):
                video_segments[fidx] = {
                    oid: (mask_logits[i][0] > 0.0).cpu().numpy()
                    for i, oid in enumerate(obj_ids)
                }

        print(f"[{job_id}] Propagation done -- {len(video_segments)} segments")

        track_out = os.path.join(TRACK_DIR, job_id)
        os.makedirs(os.path.join(track_out, "frames"), exist_ok=True)
        os.makedirs(os.path.join(track_out, "masks"), exist_ok=True)

        mask_color_bgr = (int(mask_b), int(mask_g), int(mask_r))
        do_draw_box = draw_box.lower() == "true"
        output_path = os.path.join(tmp_dir, "output.mp4")

        build_overlay_video(video_path, frame_paths, frame_indices, video_segments,
                            vid_fps, vid_w, vid_h, sample_fps, mask_color_bgr,
                            mask_alpha, do_draw_box, output_path)

        frame_manifest = save_frame_assets(frame_paths, frame_indices, video_segments,
                                           vid_w, vid_h, track_out)

        manifest = {
            "job_id": job_id,
            "n_frames": n_frames,
            "vid_fps": vid_fps,
            "vid_w": vid_w,
            "vid_h": vid_h,
            "bbox": [float(bx1), float(by1), float(bx2), float(by2)],
            "sample_fps": sample_fps,
            "frames": frame_manifest,
            "created_at": datetime.now().isoformat(),
        }
        with open(os.path.join(track_out, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=2)

        shutil.copy2(output_path, os.path.join(track_out, "overlay.mp4"))
        print(f"[{job_id}] Track output saved to {track_out}")

        return JSONResponse({
            "job_id": job_id,
            "n_frames": n_frames,
            "vid_fps": vid_fps,
            "vid_w": vid_w,
            "vid_h": vid_h,
            "overlay_url": f"/track_result/{job_id}/overlay.mp4",
        })

    except HTTPException:
        raise
    except Exception as e:
        print(f"[{job_id}] ERROR: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# SAM2 TRACKING — brush mask (NEW)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/track_brush")
async def track_brush(
    video: UploadFile = File(...),
    mask_png: UploadFile = File(...),
    src_width: int = Form(0),
    src_height: int = Form(0),
    mask_alpha: float = Form(0.45),
    mask_r: int = Form(0),
    mask_g: int = Form(255),
    mask_b: int = Form(0),
    draw_box: str = Form("true"),
    sample_fps: float = Form(0),
):
    if predictor is None:
        raise HTTPException(503, detail="SAM2 model not loaded yet")

    job_id = uuid.uuid4().hex[:8]
    tmp_dir = tempfile.mkdtemp(prefix=f"sam2_job_{job_id}_")

    try:
        video_path = os.path.join(tmp_dir, "input.mp4")
        with open(video_path, "wb") as f:
            f.write(await video.read())

        cap = cv2.VideoCapture(video_path)
        vid_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()

        # Decode the brush mask PNG
        mask_bytes = await mask_png.read()
        mask_arr = np.frombuffer(mask_bytes, np.uint8)
        user_mask = cv2.imdecode(mask_arr, cv2.IMREAD_UNCHANGED)
        if user_mask is None:
            raise HTTPException(400, detail="Could not decode mask PNG")

        # Handle RGBA (use alpha channel), RGB, or grayscale
        if user_mask.ndim == 3 and user_mask.shape[2] == 4:
            user_mask = user_mask[:, :, 3]
        elif user_mask.ndim == 3:
            user_mask = cv2.cvtColor(user_mask, cv2.COLOR_BGR2GRAY)

        # Rescale mask to video dimensions if canvas was a different size
        if src_width > 0 and src_height > 0 and (src_width != vid_w or src_height != vid_h):
            user_mask = cv2.resize(user_mask, (vid_w, vid_h), interpolation=cv2.INTER_NEAREST)

        mask_bool = (user_mask > 127)
        if not np.any(mask_bool):
            raise HTTPException(400, detail="Brush mask is empty -- paint at least one pixel")

        print(f"[{job_id}] Video: {vid_w}x{vid_h} @ {vid_fps:.1f}fps | brush mask pixels: {mask_bool.sum()}")

        frames_dir = os.path.join(tmp_dir, "frames")
        os.makedirs(frames_dir)
        frame_paths, frame_indices, _ = extract_frames_sampled(video_path, frames_dir, sample_fps)
        n_frames = len(frame_paths)
        print(f"[{job_id}] Extracted {n_frames} frames (sample_fps={sample_fps})")

        if n_frames == 0:
            raise HTTPException(400, detail="No frames extracted")

        print(f"[{job_id}] Running SAM2 propagation (brush mask prompt)...")
        with torch.inference_mode():
            state = predictor.init_state(video_path=frames_dir)
            predictor.reset_state(state)
            # Use the painted mask directly as the prompt instead of a bounding box
            predictor.add_new_mask(
                inference_state=state,
                frame_idx=0,
                obj_id=OBJ_ID,
                mask=mask_bool,
            )
            video_segments = {}
            for fidx, obj_ids, mask_logits in predictor.propagate_in_video(state):
                video_segments[fidx] = {
                    oid: (mask_logits[i][0] > 0.0).cpu().numpy()
                    for i, oid in enumerate(obj_ids)
                }

        print(f"[{job_id}] Propagation done -- {len(video_segments)} segments")

        track_out = os.path.join(TRACK_DIR, job_id)
        os.makedirs(os.path.join(track_out, "frames"), exist_ok=True)
        os.makedirs(os.path.join(track_out, "masks"), exist_ok=True)

        mask_color_bgr = (int(mask_b), int(mask_g), int(mask_r))
        do_draw_box = draw_box.lower() == "true"
        output_path = os.path.join(tmp_dir, "output.mp4")

        build_overlay_video(video_path, frame_paths, frame_indices, video_segments,
                            vid_fps, vid_w, vid_h, sample_fps, mask_color_bgr,
                            mask_alpha, do_draw_box, output_path)

        frame_manifest = save_frame_assets(frame_paths, frame_indices, video_segments,
                                           vid_w, vid_h, track_out)

        manifest = {
            "job_id": job_id,
            "n_frames": n_frames,
            "vid_fps": vid_fps,
            "vid_w": vid_w,
            "vid_h": vid_h,
            "sample_fps": sample_fps,
            "frames": frame_manifest,
            "created_at": datetime.now().isoformat(),
        }
        with open(os.path.join(track_out, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=2)

        shutil.copy2(output_path, os.path.join(track_out, "overlay.mp4"))
        print(f"[{job_id}] Track output saved to {track_out}")

        return JSONResponse({
            "job_id": job_id,
            "n_frames": n_frames,
            "vid_fps": vid_fps,
            "vid_w": vid_w,
            "vid_h": vid_h,
            "overlay_url": f"/track_result/{job_id}/overlay.mp4",
        })

    except HTTPException:
        raise
    except Exception as e:
        print(f"[{job_id}] ERROR: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# TRACK RESULT ACCESS
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/track_result/{job_id}/overlay.mp4")
def get_overlay_video(job_id: str, request: Request):
    path = os.path.join(TRACK_DIR, job_id, "overlay.mp4")
    if not os.path.exists(path):
        raise HTTPException(404, detail="Overlay video not found")

    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")

    if range_header:
        range_str = range_header.strip().replace("bytes=", "")
        parts = range_str.split("-")
        start = int(parts[0]) if parts[0] else 0
        end   = int(parts[1]) if parts[1] else file_size - 1
        end   = min(end, file_size - 1)
        length = end - start + 1

        def iter_range():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range":  f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges":  "bytes",
                "Content-Length": str(length),
            },
        )

    return FileResponse(path, media_type="video/mp4")

@app.get("/track_result/{job_id}/manifest")
def get_manifest(job_id: str):
    path = os.path.join(TRACK_DIR, job_id, "manifest.json")
    if not os.path.exists(path):
        raise HTTPException(404, detail="Manifest not found")
    with open(path) as f:
        return json.load(f)


@app.get("/track_result/{job_id}/frame/{fname}")
def get_track_frame(job_id: str, fname: str):
    path = os.path.join(TRACK_DIR, job_id, "frames", fname)
    if not os.path.exists(path):
        raise HTTPException(404, detail="Frame not found")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/track_result/{job_id}/mask/{fname}")
def get_track_mask(job_id: str, fname: str):
    path = os.path.join(TRACK_DIR, job_id, "masks", fname)
    if not os.path.exists(path):
        raise HTTPException(404, detail="Mask not found")
    return FileResponse(path, media_type="image/png")


@app.get("/track_result/{job_id}/overlay_frame/{frame_fname}/{mask_fname}")
def get_overlay_frame(
    job_id: str,
    frame_fname: str,
    mask_fname: str,
    alpha: float = Query(default=0.45),
    color: str = Query(default="4facde"),
    draw_box: bool = Query(default=False),
):
    frame_path = os.path.join(TRACK_DIR, job_id, "frames", frame_fname)
    mask_path = os.path.join(TRACK_DIR, job_id, "masks", mask_fname)
    if not os.path.exists(frame_path):
        raise HTTPException(404, detail="Frame not found")
    if not os.path.exists(mask_path):
        raise HTTPException(404, detail="Mask not found")

    frame = cv2.imread(frame_path, cv2.IMREAD_COLOR)
    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)
    if frame is None or mask is None:
        raise HTTPException(500, detail="Could not read frame or mask")

    if mask.shape[:2] != frame.shape[:2]:
        mask = cv2.resize(mask, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_NEAREST)
    mask_bool = mask > 127

    hex_color = color.strip().lstrip('#')
    if len(hex_color) != 6:
        hex_color = '4facde'
    try:
        rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        rgb = (79, 172, 222)
    bgr = (rgb[2], rgb[1], rgb[0])
    a = max(0.0, min(1.0, float(alpha)))

    out = frame.copy()
    if np.any(mask_bool):
        overlay = frame.copy()
        overlay[mask_bool] = bgr
        out = cv2.addWeighted(overlay, a, frame, 1.0 - a, 0)
        if draw_box:
            ys, xs = np.where(mask_bool)
            if len(xs) > 0:
                x1, y1, x2, y2 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
                cv2.rectangle(out, (x1, y1), (x2, y2), bgr, 2)

    ok, buf = cv2.imencode('.png', out)
    if not ok:
        raise HTTPException(500, detail='Could not encode overlay image')
    return Response(content=buf.tobytes(), media_type='image/png')


# ─────────────────────────────────────────────────────────────────────────────
# PROJECTS (dataset curation)
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/projects")
def list_projects():
    projects = []
    if os.path.isdir(PROJECTS_DIR):
        for name in sorted(os.listdir(PROJECTS_DIR)):
            proj_path = os.path.join(PROJECTS_DIR, name)
            if os.path.isdir(proj_path):
                meta_path = os.path.join(proj_path, "project.json")
                meta = {}
                if os.path.exists(meta_path):
                    with open(meta_path) as f:
                        meta = json.load(f)
                images_dir = os.path.join(proj_path, "images")
                n_pairs = len([f for f in os.listdir(images_dir) if f.endswith(".jpg")]) if os.path.isdir(images_dir) else 0
                projects.append({
                    "name": name,
                    "n_pairs": n_pairs,
                    "created_at": meta.get("created_at", ""),
                    "description": meta.get("description", ""),
                })
    return {"projects": projects}


class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""
    output_dir: str = ""


@app.post("/projects")
def create_project(req: CreateProjectRequest):
    name = req.name.strip().replace(" ", "_").lower()
    if not name:
        raise HTTPException(400, detail="Project name required")

    if req.output_dir:
        proj_path = os.path.abspath(req.output_dir)
    else:
        proj_path = os.path.join(PROJECTS_DIR, name)

    os.makedirs(os.path.join(proj_path, "images"), exist_ok=True)
    os.makedirs(os.path.join(proj_path, "masks"), exist_ok=True)

    meta_path = os.path.join(proj_path, "project.json")
    if not os.path.exists(meta_path):
        meta = {
            "name": name,
            "description": req.description,
            "created_at": datetime.now().isoformat(),
            "output_dir": proj_path,
        }
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)

    return {"name": name, "path": proj_path, "message": "Project ready"}


class SavePairsRequest(BaseModel):
    job_id: str
    project_name: str
    frame_indices: list[int]
    prefix: str = ""


@app.post("/save_pairs")
def save_pairs(req: SavePairsRequest):
    track_path = os.path.join(TRACK_DIR, req.job_id)
    if not os.path.isdir(track_path):
        raise HTTPException(404, detail=f"Track job not found: {req.job_id}")

    manifest_path = os.path.join(track_path, "manifest.json")
    with open(manifest_path) as f:
        manifest = json.load(f)

    proj_path = os.path.join(PROJECTS_DIR, req.project_name)
    if not os.path.isdir(proj_path):
        raise HTTPException(404, detail=f"Project not found: {req.project_name}")

    images_dir = os.path.join(proj_path, "images")
    masks_dir = os.path.join(proj_path, "masks")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(masks_dir, exist_ok=True)

    saved = 0
    prefix = req.prefix or req.job_id
    for frame_info in manifest["frames"]:
        if frame_info["idx"] not in req.frame_indices:
            continue
        if not frame_info["has_mask"]:
            continue

        src_frame = os.path.join(track_path, "frames", frame_info["frame"])
        src_mask = os.path.join(track_path, "masks", frame_info["mask"])

        if not os.path.exists(src_frame) or not os.path.exists(src_mask):
            continue

        fname = f"{prefix}_{frame_info['idx']:06d}"
        shutil.copy2(src_frame, os.path.join(images_dir, f"{fname}.jpg"))
        shutil.copy2(src_mask, os.path.join(masks_dir, f"{fname}.png"))
        saved += 1

    meta_path = os.path.join(proj_path, "project.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)

    history = meta.get("save_history", [])
    history.append({
        "job_id": req.job_id,
        "n_saved": saved,
        "timestamp": datetime.now().isoformat(),
    })
    meta["save_history"] = history
    meta["last_updated"] = datetime.now().isoformat()
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    n_total = len([f for f in os.listdir(images_dir) if f.endswith(".jpg")])

    return {"saved": saved, "total_in_project": n_total}


@app.get("/project_contents/{project_name}")
def project_contents(project_name: str):
    proj_path = os.path.join(PROJECTS_DIR, project_name)
    if not os.path.isdir(proj_path):
        raise HTTPException(404, detail="Project not found")

    images_dir = os.path.join(proj_path, "images")
    masks_dir = os.path.join(proj_path, "masks")

    pairs = []
    if os.path.isdir(images_dir):
        for fname in sorted(os.listdir(images_dir)):
            if fname.endswith(".jpg"):
                base = fname[:-4]
                mask_exists = os.path.exists(os.path.join(masks_dir, f"{base}.png"))
                pairs.append({
                    "name": base,
                    "image": fname,
                    "mask": f"{base}.png" if mask_exists else None,
                })

    return {"project": project_name, "pairs": pairs, "count": len(pairs)}


# ─────────────────────────────────────────────────────────────────────────────
# RUN
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print(f"\n[server] Starting on http://localhost:{args.port}")
    print(f"[server] Tunnel: ssh -L {args.port}:127.0.0.1:{args.port} user@gpu_node\n")
    uvicorn.run(app, host=args.host, port=args.port)