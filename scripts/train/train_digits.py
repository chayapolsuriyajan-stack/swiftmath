"""Train the tiny digit CNN used by src/recognizer/cnn.ts and export int8 weights.

Usage:  python scripts/train/train_digits.py [--epochs 14]

Outputs:
  public/model/digits.bin   int8 weights (per-output-channel scales) + float32 biases
  public/model/digits.json  tensor manifest (name, shape, dtype, byte offset)
  tests/fixtures/cnn.json   sample inputs + expected logits (dequantized model) for parity test
"""
import argparse
import json
import math
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import datasets

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data"


class DigitNet(nn.Module):
    # Must match src/recognizer/cnn.ts exactly (valid padding, NCHW flatten order).
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 16, 3)   # 28 -> 26 -> pool 13
        self.conv2 = nn.Conv2d(16, 32, 3)  # 13 -> 11 -> pool 5
        self.fc1 = nn.Linear(32 * 5 * 5, 64)
        self.fc2 = nn.Linear(64, 10)
        self.drop = nn.Dropout(0.25)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.conv1(x)), 2)
        x = F.max_pool2d(F.relu(self.conv2(x)), 2)
        x = F.relu(self.fc1(x.flatten(1)))
        return self.fc2(self.drop(x))


def augment(x: torch.Tensor) -> torch.Tensor:
    """Random affine (rotation, shear, scale, shift) + stroke thickness jitter, on GPU."""
    n = x.shape[0]
    dev = x.device
    ang = (torch.rand(n, device=dev) * 2 - 1) * math.radians(15)
    shear = (torch.rand(n, device=dev) * 2 - 1) * 0.3
    scale = 0.85 + torch.rand(n, device=dev) * 0.3
    sx = scale * (0.9 + torch.rand(n, device=dev) * 0.2)  # mild aspect jitter
    tx = (torch.rand(n, device=dev) * 2 - 1) * 0.12
    ty = (torch.rand(n, device=dev) * 2 - 1) * 0.12
    cos, sin = torch.cos(ang), torch.sin(ang)
    theta = torch.zeros(n, 2, 3, device=dev)
    theta[:, 0, 0] = cos / sx
    theta[:, 0, 1] = (-sin + shear) / sx
    theta[:, 1, 0] = sin / scale
    theta[:, 1, 1] = cos / scale
    theta[:, 0, 2] = tx
    theta[:, 1, 2] = ty
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    x = F.grid_sample(x, grid, align_corners=False, padding_mode="zeros")

    # thickness jitter: dilate a third, erode a sixth
    r = torch.rand(n, device=dev)
    dil = F.max_pool2d(x, 3, 1, 1)
    ero = -F.max_pool2d(-x, 2, 1, 0)
    ero = F.pad(ero, (0, 1, 0, 1))
    x = torch.where((r < 0.33).view(n, 1, 1, 1), dil, x)
    x = torch.where((r > 0.83).view(n, 1, 1, 1), torch.maximum(ero, x * 0.6), x)
    return x.clamp(0, 1)


def load(train: bool, dev):
    ds = datasets.MNIST(DATA, train=train, download=True)
    x = ds.data.float().div(255).unsqueeze(1).to(dev)
    y = ds.targets.to(dev)
    return x, y


def evaluate(model, x, y):
    model.eval()
    preds = []
    with torch.no_grad():
        for i in range(0, len(x), 4096):
            preds.append(model(x[i:i + 4096]).argmax(1))
    p = torch.cat(preds)
    acc = (p == y).float().mean().item()
    conf = torch.zeros(10, 10, dtype=torch.long)
    for t, q in zip(y.cpu().tolist(), p.cpu().tolist()):
        conf[t, q] += 1
    return acc, conf


def quantize(w: torch.Tensor):
    """Per-output-channel symmetric int8."""
    flat = w.reshape(w.shape[0], -1)
    scale = flat.abs().max(1).values.clamp(min=1e-8) / 127.0
    q = torch.round(flat / scale[:, None]).clamp(-127, 127).to(torch.int8)
    return q.reshape(w.shape), scale


def export(model: DigitNet, x_test, y_test):
    out_dir = ROOT / "public" / "model"
    out_dir.mkdir(parents=True, exist_ok=True)
    blob = bytearray()
    manifest = []

    def push(name, arr: np.ndarray, dtype: str):
        while len(blob) % 4:
            blob.append(0)
        manifest.append({"name": name, "shape": list(arr.shape), "dtype": dtype, "offset": len(blob)})
        blob.extend(arr.tobytes())

    deq = DigitNet().eval()
    sd = {}
    for layer in ["conv1", "conv2", "fc1", "fc2"]:
        mod = getattr(model, layer)
        q, s = quantize(mod.weight.detach().cpu())
        push(f"{layer}.w", q.numpy(), "int8")
        push(f"{layer}.s", s.numpy().astype(np.float32), "float32")
        push(f"{layer}.b", mod.bias.detach().cpu().numpy().astype(np.float32), "float32")
        sd[f"{layer}.weight"] = (q.float().reshape(q.shape[0], -1) * s[:, None]).reshape(q.shape)
        sd[f"{layer}.bias"] = mod.bias.detach().cpu()
    deq.load_state_dict(sd)

    (out_dir / "digits.bin").write_bytes(bytes(blob))
    (out_dir / "digits.json").write_text(json.dumps({"version": 1, "tensors": manifest}, indent=1))
    print(f"exported {len(blob)} bytes")

    acc, conf = evaluate(deq, x_test.cpu(), y_test.cpu())
    print(f"quantized test acc {acc:.4%}")
    print("confusion (rows=true):\n", conf.numpy())

    # parity fixtures
    fx_dir = ROOT / "tests" / "fixtures"
    fx_dir.mkdir(parents=True, exist_ok=True)
    idx = list(range(0, 2000, 100))
    xs = x_test[idx].cpu()
    with torch.no_grad():
        logits = deq(xs)
    fixtures = [
        {"label": int(y_test[i]), "input": [round(v, 5) for v in xs[k, 0].flatten().tolist()],
         "logits": [round(v, 5) for v in logits[k].tolist()]}
        for k, i in enumerate(idx)
    ]
    (fx_dir / "cnn.json").write_text(json.dumps(fixtures))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=14)
    args = ap.parse_args()
    torch.manual_seed(7)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    x, y = load(True, dev)
    xt, yt = load(False, dev)
    model = DigitNet().to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = args.epochs * math.ceil(len(x) / 256)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=steps)
    # slight extra weight on classes users (and the original app) confuse most: 0/1/6/7
    cw = torch.ones(10, device=dev)
    cw[[0, 1, 6, 7]] = 1.2
    for ep in range(args.epochs):
        model.train()
        perm = torch.randperm(len(x), device=dev)
        total = 0.0
        for i in range(0, len(x), 256):
            b = perm[i:i + 256]
            xb = augment(x[b])
            loss = F.cross_entropy(model(xb), y[b], weight=cw, label_smoothing=0.05)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item() * len(b)
        acc, _ = evaluate(model, xt, yt)
        print(f"epoch {ep + 1}: loss {total / len(x):.4f}  test acc {acc:.4%}")
    export(model.cpu().eval(), xt, yt)


if __name__ == "__main__":
    main()
