# Instructions for the quick-links ticket exporter

SofaPaint now produces two artifacts that remove the need for GPT to guess from
lossy ticket exports. The exporter's job is to stop losing evidence — the six
missing measurement images on ticket 229616973 happened because the latest
public message was outbound and the newest-eight-inbound policy filtered the
attachments away.

## The two SofaPaint artifacts

**1. Drafting bundle** (`drafting-<project>-<date>.zip`) — input to GPT for
question extraction and drafting. Contains its own manifest, catalogue,
production notes, measurements (with customer notes), selection, images and a
reply skeleton. The exporter does not need to do anything for this one; it is
built entirely from the open SofaPaint project.

**2. Reply bundle** (`reply-<project>-<date>.zip`) — the finished customer
email plus real image bytes. Structure:

```
reply-<project>-<date>.zip
├── reply/manifest.json       # bundleType "sofapaint-reply": points[] with
│                             #   questionIds + images[] in order, case ids,
│                             #   completeness flag
├── reply/email.txt           # numbered plain-text email
├── reply/email.html          # numbered paragraphs, <img src="images/…"> inline
├── reply/internal-notes.txt  # production-only notes — NEVER send to customer
├── selection/request.json    # originating SofaPaint request (traceability)
└── images/*.png              # actual bytes, named q<questionId>-<view>-<frame>.png
```

If a ticket contains a SofaPaint reply bundle, the exporter should attach its
contents verbatim (email text/HTML + images, in manifest order) and skip its
own attachment inference entirely.

## Required exporter fixes

1. **Outbound evidence** — include inbound AND outbound messages and
   attachments relevant to the measurement review, regardless of the latest
   public message direction. Do not apply the newest-eight-inbound-files
   policy to measurement-review evidence sets.

2. **Complete image bytes** — never represent an attachment as a remote URL
   only. Fetch the bytes, record per-file download status, and treat a
   URL-only entry as a failed download. Preserve locally generated assets
   before sending rather than fetching them back from Gorgias.

3. **Explicit image order** — when a SofaPaint `reply/manifest.json` is
   present, use its `points[].images` ordering. Otherwise require manual
   confirmation of placement for plain-text replies instead of inferring it
   from filenames or blank lines.

4. **Completeness reporting** — report requested / bundled / missing /
   filtered counts separately. Never mark a bundle `complete` when a required
   image is absent; name the affected question (the manifest's `questionIds`
   provide the mapping).

5. **Asset integrity** — verify file signatures against the expected MIME
   type and confirm images decode before marking them downloaded. Do not
   accept a PDF response as a fetched HEIC, and do not deduplicate a PDF
   against an image merely because returned hashes match. Deduplicate
   identical valid bytes while retaining every source reference. Exclude
   signature/decorative assets by role and context, not by broad filename
   patterns that could catch measurement diagrams.

## Acceptance check

Re-exporting ticket 229616973 (Verellen, order CW-338005) whose latest message
is the outbound five-question reply referencing six measurement PNGs must
produce a bundle that: contains all six PNGs as decoded image bytes, preserves
the question→image order from `reply/manifest.json` (or asks for confirmation),
reports requested/bundled/missing counts, and is marked complete only when
nothing is missing.
