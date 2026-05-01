#!/usr/bin/env python3
"""
Smoke test — verifies SAM2 loads and runs inference end-to-end.
Run from the repo root after activating the environment:

    source activate_env.sh
    python tests/sam_working_test.py
"""

import os
import numpy as np
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKPOINT = os.path.join(REPO_ROOT, "checkpoints/sam2.1_hiera_large.pt")
MODEL_CFG  = "configs/sam2.1/sam2.1_hiera_l.yaml"


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Device: {device}")

    print("Loading model...")
    model = build_sam2(MODEL_CFG, CHECKPOINT, device=device)
    predictor = SAM2ImagePredictor(model)
    print("Model loaded")

    H, W = 512, 512
    fake_image = np.random.randint(0, 256, size=(H, W, 3), dtype=np.uint8)
    predictor.set_image(fake_image)

    box = np.array([[128, 128, 384, 384]], dtype=np.float32)
    masks, scores, logits = predictor.predict(box=box, multimask_output=True)

    print(f"masks shape:  {masks.shape}")
    print(f"scores:       {scores}")
    print(f"logits shape: {logits.shape}")

    assert masks.ndim == 3, "Expected (N, H, W)"
    assert masks.shape[1:] == (H, W), "Mask resolution mismatch"

    print("All checks passed")


if __name__ == "__main__":
    main()
