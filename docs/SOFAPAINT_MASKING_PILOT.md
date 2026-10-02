# Reviewed masking pilot

The measurement assistant can call `segment_project_image` after uploading a
photo and before preparing its landmark plan. It receives a labeled overlay,
normalized contours, confidence, and the checkpoint hash. Exact bitmap RLE is
stored separately in the private draft cache. Holes and disconnected components
retain their instance identity. Measurement lines remain editable, and the
existing guide, visual review, and native PDF flow continue to apply.

## Model and semantics

Initial checkpoint: `C:/dataset_pipeline_seg/runs/yolo11s-seg_merged_back_base/weights/best.pt`.
SHA256: `d8b3be861b6abcf0d9656d77432aa23b22b2d3f8f4037061fa41d7ef95658dc1`.

Classes: physical left arm, physical right arm, seat cushions, back_and_base,
sofa_back. These are the actual saved model labels. The newer cushions_v2
schema must not be substituted by renaming class IDs. In particular, the merged
body class cannot distinguish front base from rear body, and seat-cushion
coverage does not establish detached/throw-cushion accuracy.

The model identifies visible part regions; GPT still interprets the selected
guide, internal seams, and view. Mask extrema are not automatic measurement
landmarks. Numeric dimensions come from customer measurements. Confidence
scores are detector scores, not proof of correct boundaries.

## PC service

The service runs in the existing WSL YOLO environment on the RTX 4070, independently
of Vercel and Cloudflare. It uses Python's HTTP server and the already installed
Ultralytics, Pillow and OpenCV libraries. No training is involved.

```bash
export SOFA_MASK_API_TOKEN='<private random secret, at least 32 characters>'
/home/leigh/.venvs/yolo-seg/bin/python services/sofa-mask/service.py \
  --model /mnt/c/dataset_pipeline_seg/runs/yolo11s-seg_merged_back_base/weights/best.pt \
  --device 0 --host 127.0.0.1 --port 8091
```

GET `/health` returns model identity. POST `/segment` accepts original image bytes
with `Authorization: Bearer <secret>`. Requests are limited to 20 MB/12 megapixels;
one inference runs at a time. Checkpoint hash and class schema are verified at
startup. POST `/normalize` applies EXIF orientation and brings photos above
12 megapixels within the review budget using Lanczos resizing. Rotated/resized
JPEGs are encoded at quality 95; other formats use PNG. Upright photos already
within the budget retain their original bytes. When masking
is configured, the Worker uses this before storing each original project photo,
so the editor, photo review, masks and measurement lines share one coordinate
system. Legacy drafts with unnormalized rotation need reimporting.

## Hosted Worker configuration

ChatGPT cannot reach localhost. For this PC pilot, expose the service through
a private authenticated HTTPS tunnel, and set the following Worker secrets:

- `SOFA_MASK_SERVICE_URL`: full HTTPS endpoint ending in `/segment`.
- `SOFA_MASK_API_TOKEN`: the same private token used by the PC.
- `SOFA_MASK_MODEL_SHA256`: approved checkpoint hash above.

Local Worker development may use `http://127.0.0.1:8091/segment` with
`LOCAL_DEVELOPMENT=true`. Never put the token in client JavaScript, URLs, Git,
or ChatGPT messages. The Worker relays private R2 image bytes directly to the
configured service, verifies input hashes, dimensions, labels and bitmap areas,
and caches evidence and previews per image/checkpoint until draft expiry.

Keep the PC service awake while this pilot is configured: imports use its photo
normalizer as well as its model. Existing cached drafts continue to be stored in
R2. Removing the three masking settings restores the original upload workflow.

On Windows, this repository's sparse checkout excludes the guide directory
because it includes trailing-space paths. The guide packager can read those
tracked SVGs directly from Git, preserving the production Linux catalogue IDs.

Deploy the updated MCP Worker to advertise the additional tool; the Vercel
editor already accepts the resulting measurement drawings. Refresh the ChatGPT
connection's tools after deployment. If the PC or service is offline, the tool
returns an explicit error and the existing original-photo workflow is available.

## Acceptance before relying on it

Compare the existing workflow and mask-assisted workflow on the same 8-12
withheld photos, including arms, rear views, sectionals and detached cushions.
Review endpoint placement, intended surface, guide selection and missing roles.
Export validity and segmentation scores alone do not establish drawing accuracy.
Use targeted SAM refinement later only if the reviewed YOLO boundaries show a
specific consistent deficiency. Preserve the original model and comparison.
