#!/usr/bin/env bash
# Source this script, do not execute it:
#   source activate_env.sh [/optional/path/to/venv]
#
# The venv path argument is optional. If omitted, the venv is created in $HOME:
#   source activate_env.sh              → $HOME/sam2_env
#   source activate_env.sh /my/dir/env  → /my/dir/env
#
# First run (or after a failed install): creates/repairs the venv and installs
# all dependencies. Subsequent runs just load modules and activate.

set -euo pipefail

VENV="${1:-$HOME/sam2_env}"
SAM2_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Loading modules ==="
module load cuda/12.1.1
module load python/3.10.17

# Create venv if it doesn't exist yet
if [ ! -d "$VENV" ]; then
    echo "=== Creating venv at $VENV ==="
    python -m venv "$VENV"
fi

source "$VENV/bin/activate"

# Install dependencies if torch is missing (handles partial/failed installs)
if ! python -c "import torch" 2>/dev/null; then
    echo "=== torch not found — running install ==="
    pip install --upgrade pip

    echo "=== Installing PyTorch 2.1.0 (cu121) ==="
    pip install torch==2.1.0 torchvision==0.16.0 \
        --index-url https://download.pytorch.org/whl/cu121

    echo "=== Installing SAM2 package ==="
    cd "$SAM2_DIR"
    SAM2_BUILD_CUDA=0 pip install -e ".[notebooks]"

    echo "=== Installing server dependencies ==="
    pip install fastapi uvicorn opencv-python-headless

    echo "=== Install complete ==="
else
    echo "=== Activated existing env: $VENV ==="
fi

echo "Python: $(which python)"
echo "Torch:  $(python -c 'import torch; print(torch.__version__)')"
echo "CUDA available: $(python -c 'import torch; print(torch.cuda.is_available())')"

echo ""
echo "=== Running smoke test ==="
cd "$SAM2_DIR/tests"
python3 sam_working_test.py
cd - > /dev/null
