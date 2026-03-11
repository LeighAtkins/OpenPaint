# MOS SAM Local Dev Container

This service provides a local, deterministic geometry tracker for MOS overlay generation.

## What It Does

- Runs a Python API on `http://localhost:8090`
- Accepts image data URLs and requested role tokens
- Returns normalized role line coordinates (`0..1000` space)
- OpenPaint converts those lines into SVG and imports as MOS overlays

## Start the Service

```bash
docker compose -f docker-compose.dev.yml up --build mos-sam
```

If Docker Desktop WSL integration is unavailable, run it directly with Python:

```bash
npm run sam:setup:local
export MOS_MODEL_PATH=/mnt/d/dataset_pipeline/runs/pose_v2/pose_v2_gold_pseudo727_10h_v2/weights/best.pt
npm run dev:sam:local
```

`dev:sam:local` prefers `.venv-mos-sam/bin/python` when present and prints the active
`MOS_MODEL_PATH` so you can confirm NN mode is enabled.

Health check:

```bash
curl http://localhost:8090/health
```

## Configure OpenPaint

In your local env file:

```env
MOS_GENERATE_STRATEGY=sam
MOS_SAM_SERVICE_URL=http://localhost:8090
```

You can also use `MOS_GENERATE_STRATEGY=auto` to try SAM first and fallback to Gemini.

## OpenPaint Endpoint

`POST /api/measurements/generate`

When strategy is `sam` or `auto`, OpenPaint calls the local service endpoint:

`POST /v1/generate-overlay`

## Anchor-First Workflow (UI)

In the **Generate Measurement Overlay** dialog:

1. Choose an anchor role in **Anchor First**.
2. Click **Pick 2 Points**.
3. Click two points on the canvas image.
4. Generate overlay.

The selected role line uses these anchor hints directly and the solver builds the rest around them.

## Notes

- Current implementation is contour/landmark-based (deterministic), designed as a stable baseline.
- It is intentionally local-first for rapid iteration on GPU workstations.
- You can replace the internal contour stage with a true SAM/SAM2 model while keeping the same API contract.
