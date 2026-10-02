# SofaPaint continuation — 2 October 2026

## Setup

Use Node.js 24 and Bun. Run `bun install`, then `bun run dev` for the editor. Run `bun run mcp:type-check` for the MCP TypeScript check. The Worker setup and required secret names are documented in `mcp/README.md`; local environment files and credentials are intentionally excluded from Git.

Production editor: https://sofapaint.vercel.app/

Public MCP endpoint: https://sofapaint-mcp.sofapaint-api.workers.dev/public/mcp

Latest tested Worker deployment: `ebbf4728-8f9d-408a-9df7-24ad37af8fb4`.

## Current work

The reliability workflow requires a construction decision and a prepared landmark plan before placing lines. Original-photo detail reviews, guide coverage, drawing-quality diagnostics, native PDF export and correction scoring are implemented. See `docs/SOFAPAINT_RELIABILITY_TESTING.md` for the testing workflow and scoring limitations.

The last fresh S2280 test completed at revision 7 with 17 measurements. Its native SofaPaint PDF had two pages and 17 measurement form fields. The PDF retained circular tags and connectors. B2, E1 and E2 appeared; G3 was omitted. The model selected sloped-arm short-back guides. This selection still needs human review: do not assume its classification is correct.

The side G1 path remains clearly wrong: it wraps around the back and returns across the arm instead of measuring one useful fabric boundary. Several guide roles were omitted, and those omission decisions need checking against the actual guide and photo. Preserve the untouched test result before editing. Do not treat schema validation or complete exports as evidence of accurate placement.

Test conversation: https://chatgpt.com/c/6abf7127-99bc-83ec-9d57-c7dd5bfe9c94?temporary-chat=true

Temporary chats and project links may expire. Private project access keys, signed image links, local test downloads and browser logs are excluded from Git. Human correction fixtures under `tests/fixtures/measurement-corrections/` are included.

## Verification already performed

Nine focused test files passed, totaling 44 tests. MCP type checking and scoped lint passed. A local HTTP Worker flow exercised plan preparation, photo review, drawing, confirmation, native fillable/printable PDF export and stale-export rejection. Live production advertised 13 tools including `prepare_measurement_plan`. These checks verify the workflow; the latest photo test exposes remaining placement errors.

Next: compare the user's corrected project with the untouched output, improve side-view role interpretation and guide selection, and test on withheld photos in fresh chats. H3 should mean visible leg height according to the user's convention; do not invent hidden leg measurements. Avoid forcing every line to share endpoints—only meaningful geometric junctions should connect.
