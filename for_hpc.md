# SAM2 Brush Tracking Server — HPC Deployment Guide

Minimal setup guide for the HPC team to stand up a dedicated SAM 2 endpoint on Minerva.

---

## Overview

The server loads SAM 2.1 (Meta AI) on a GPU and exposes a FastAPI HTTP API + browser UI.
Users paint a brush stroke on the first frame of a video clip and the model propagates
the segmentation mask through every subsequent frame.

- One GPU required (A100 recommended; V100 32 GB works)
- Model stays resident in GPU memory for the life of the process
- No database, no persistent state between requests

---

## Step 1 — Clone the repository

```bash
cd /sc/arion/projects/video_rarp/neel_projects
git clone https://github.com/facebookresearch/sam2.git sam2
cd sam2
```

## Step 2 — Download model checkpoints

```bash
cd /sc/arion/projects/video_rarp/neel_projects/sam2/checkpoints
bash download_ckpts.sh
cd ..
```

Downloads four SAM 2.1 weights (~1.5 GB total). The server uses
`sam2.1_hiera_large.pt` (857 MB) by default.

## Step 3 — Copy the server files

`sam2_brush_server.py` and the `frontend/` directory are not part of the upstream SAM 2 repo.
They live in the development repo and should already be present if you cloned from the project
fork, or can be copied manually:

```bash
SRC=/sc/arion/projects/video_rarp/neel_projects/autosam-instruments-GraSP-trained/sam2

cp $SRC/sam2_brush_server.py  /sc/arion/projects/video_rarp/neel_projects/sam2/
cp -r $SRC/frontend           /sc/arion/projects/video_rarp/neel_projects/sam2/
```

## Step 4 — Build the React frontend

The browser UI is a React/Vite app in `frontend/`. It needs to be built once (output goes to
`frontend/dist/`) and is then served as static files by the FastAPI server.

**Node.js 18+ is required.** The system modules are too old; use `nvm`:

```bash
# Install nvm (one-time, into $HOME)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc   # or source ~/.bash_profile

# Install Node 20 LTS and build
nvm install 20
nvm use 20

cd /sc/arion/projects/video_rarp/neel_projects/sam2/frontend
npm install
npm run build
```

This produces `frontend/dist/`. You do not need Node.js at runtime — only for rebuilding
the UI after code changes. Commit `frontend/dist/` to version control so the HPC server
never needs Node installed.

**During development** (to iterate on the UI without a full rebuild):

```bash
# In one terminal: run the Python API server
source activate_env.sh
python sam2_brush_server.py --port 8892 ...

# In another terminal: run the Vite dev server (proxies API calls to 8892)
cd frontend && npm run dev   # opens http://localhost:5173
```

## Step 5 — Build the Python environment

The environment mirrors the Dockerfile base:
`pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime`

```bash
module load cuda/12.1.1
module load python/3.10.17

python -m venv /sc/arion/projects/video_rarp/neel_projects/sam2_env
source /sc/arion/projects/video_rarp/neel_projects/sam2_env/bin/activate

# PyTorch matching CUDA 12.1
pip install torch==2.1.0 torchvision==0.16.0 \
    --index-url https://download.pytorch.org/whl/cu121

# SAM 2 package (installs from the cloned repo)
cd /sc/arion/projects/video_rarp/neel_projects/sam2
SAM2_BUILD_CUDA=0 pip install -e ".[notebooks]"

# Server dependencies
pip install fastapi uvicorn opencv-python-headless
```

`SAM2_BUILD_CUDA=0` skips the optional CUDA post-processing extension — tracking
works fine without it and avoids potential compiler issues at install time.

Verify:

```bash
python -c "from sam2.build_sam import build_sam2_video_predictor; print('OK')"
ffmpeg -version | head -1
```

## Step 6 — Start the server

```bash
module load cuda/12.1.1
source /sc/arion/projects/video_rarp/neel_projects/sam2_env/bin/activate
cd /sc/arion/projects/video_rarp/neel_projects/sam2

python sam2_brush_server.py \
    --port 8892 \
    --host 0.0.0.0 \
    --video-dir /sc/arion/projects/video_rarp/neel_projects \
    --projects-dir /sc/arion/projects/video_rarp/neel_projects/sam2/projects
```

The server prints `[startup] SAM2 loaded` when ready (~15–30 s).

### As an LSF job

```bash
bsub -P video_rarp \
     -J sam2_server \
     -q gpu \
     -n 4 \
     -R "rusage[mem=32000,ngpus_excl_p=1]" \
     -W 72:00 \
     -oo /sc/arion/projects/video_rarp/neel_projects/sam2/logs/server_%J.log \
     "module load cuda/12.1.1; \
      source /sc/arion/projects/video_rarp/neel_projects/sam2_env/bin/activate; \
      cd /sc/arion/projects/video_rarp/neel_projects/sam2; \
      python sam2_brush_server.py --port 8892 \
        --video-dir /sc/arion/projects/video_rarp/neel_projects"
```

## Step 7 — Health check

```bash
curl http://<node-hostname>:8892/health
```

Expected:
```json
{"status": "ok", "sam2_loaded": true, "device": "cuda", "ffmpeg": true}
```

## Step 8 — Access from a local machine (SSH tunnel)

Until a dedicated hostname/reverse proxy is set up:

```bash
ssh -J gahaln01@minerva.hpc.mssm.edu \
    -L 8892:127.0.0.1:8892 \
    gahaln01@<compute-node>

# then open http://localhost:8892
```

---

## GPU memory by checkpoint

| Checkpoint | VRAM | Flag values |
|---|---|---|
| `sam2.1_hiera_large.pt` | ~8 GB | `--sam2-checkpoint checkpoints/sam2.1_hiera_large.pt --sam2-config configs/sam2.1/sam2.1_hiera_l.yaml` |
| `sam2.1_hiera_base_plus.pt` | ~5 GB | `... sam2.1_hiera_base_plus.pt ... sam2.1_hiera_b+.yaml` |
| `sam2.1_hiera_small.pt` | ~3 GB | `... sam2.1_hiera_small.pt ... sam2.1_hiera_s.yaml` |

---

## Notes

- **Temp files:** On startup the server creates two temp dirs (`sam2_clips_*`,
  `sam2_tracks_*`) under `/tmp`. For a persistent service point `TMPDIR` to a
  scratch partition with ~50 GB headroom.
- **Concurrency:** One GPU job at a time; parallel requests queue.
- **Logs directory** (`logs/`) must exist before submitting the LSF job:
  `mkdir -p /sc/arion/projects/video_rarp/neel_projects/sam2/logs`

---

## Upstream reference

- https://github.com/facebookresearch/sam2
- License: Apache 2.0
