#!/usr/bin/env bash
# Usage:
#   bash start_server.sh [--port 8892] [--video-dir /path] [--projects-dir /path]
#
# Activates the Python environment, builds the React frontend, then starts the server.
# Override defaults with environment variables or CLI flags.

set -euo pipefail

SAM2_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV=/sc/arion/projects/video_rarp/neel_projects/sam2_env

# ── Defaults (override with env vars or flags below) ──────────────────────────
PORT=${PORT:-8892}
VIDEO_DIR=${VIDEO_DIR:-/sc/arion/projects/video_rarp/neel_projects}
PROJECTS_DIR=${PROJECTS_DIR:-$SAM2_DIR/projects}

# ── Parse optional CLI flags ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --port)         PORT="$2";         shift 2 ;;
    --video-dir)    VIDEO_DIR="$2";    shift 2 ;;
    --projects-dir) PROJECTS_DIR="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Activate Python environment (modules + venv + smoke test)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Step 1 · Python environment             ║"
echo "╚══════════════════════════════════════════╝"
source "$SAM2_DIR/activate_env.sh" "$VENV"

# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Build React frontend
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Step 2 · Frontend build                 ║"
echo "╚══════════════════════════════════════════╝"

# nvm.sh internally uses unset variables — must disable strict mode while loading it
set +euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
  nvm use 20 2>/dev/null || nvm use --lts 2>/dev/null || true
fi
set -euo pipefail

if command -v node &>/dev/null && node -e "process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)" 2>/dev/null; then
  echo "Node $(node --version) found"
  cd "$SAM2_DIR/frontend"
  npm install --prefer-offline --silent
  npm run build
  cd "$SAM2_DIR"
  echo "=== Frontend built → frontend/dist/ ==="
else
  echo ""
  echo "WARNING: Node.js 18+ not found — skipping frontend build."
  echo "  The server will fall back to index_brush.html if frontend/dist/ is missing."
  echo "  To build: install nvm + Node 20, then run:"
  echo "    cd $SAM2_DIR/frontend && npm install && npm run build"
  echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Start SAM2 server
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Step 3 · Starting server                ║"
echo "╚══════════════════════════════════════════╝"
echo "  Port:         $PORT"
echo "  Video dir:    $VIDEO_DIR"
echo "  Projects dir: $PROJECTS_DIR"
echo ""
echo "  SSH tunnel (from local machine):"
echo "    ssh -J <user>@minerva.hpc.mssm.edu -L $PORT:127.0.0.1:$PORT <user>@<node>"
echo "  Then open: http://localhost:$PORT"
echo ""

mkdir -p "$SAM2_DIR/logs"

cd "$SAM2_DIR"
exec python sam2_brush_server.py \
    --port        "$PORT" \
    --host        "0.0.0.0" \
    --video-dir   "$VIDEO_DIR" \
    --projects-dir "$PROJECTS_DIR"
