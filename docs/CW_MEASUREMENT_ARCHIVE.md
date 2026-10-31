# Private Comfort Works measurement archive

The archive replaces product lookup and component measurement/image loading from
CW40. Public storefront product photos and pricing continue to use the storefront.
Sofapaint authentication is independent of the retiring CW40 login.

## Access

Every measurement, product-discovery, and archived-image request verifies the
Sofapaint bearer token with Supabase Auth. The user must have a confirmed email
address with the exact domain `comfort-works.com`. An absent/expired token receives
401; another domain or an unconfirmed email receives 403. Missing authentication
configuration fails closed. Responses use `Cache-Control: private, no-store`.
Public storefront photo/comparison and pricing requests contain no measurements
and remain available without signing in.

The browser sends its refreshed Sofapaint session, does not cache protected API
responses in session storage, and clears the library view on an identity change.
CW credentials alone cannot grant access to the archive.

CW40's saved model confirmation is retained separately from the presence of a
raw response. Unconfirmed models display **Measurements unconfirmed**, have
disabled configuration choices, and cannot return measurement values through
the API. The archived-image API also restricts file identifiers to images used by
confirmed records with matching styles; knowing another archived image hash does
not grant access to an unconfirmed diagram. The server-only asset list is generated
with `node scripts/cw-archive-asset-access.ts`; regenerate it when the snapshot changes.
Configured models require a matching `confirmed` entry under the current
option-group key. A stale saved group cannot grant confirmation. Base products
without a model-variant confirmation control can use their saved responses.

## Local archive

The shutdown backup is stored outside the repository and public web root:

`/Users/leigh/Documents/New project/cw-product-archive-2026-09-29`

Set the server environment variable `CW_ARCHIVE_DIR` to that directory to enable
archive lookup. The source archive contains raw products, configuration tables,
measurement responses, and downloaded image files. `runtime-index.json` is the
compact search/configuration index. `measurement-tuples.json` maps reference +
style + style code to individual measurement records. `asset-maps/` connects
original image identifiers to saved files and SHA-256 hashes.

Run the resumable retrieval stages from OpenPaint with its configured CW account:

```sh
node scripts/cw-product-backup.ts catalogue
node scripts/cw-product-backup.ts dictionaries
node scripts/cw-product-backup.ts editor-configs
node scripts/cw-product-backup.ts tuples
CW_BACKUP_CONCURRENCY=8 node scripts/cw-product-backup.ts measurements
node scripts/cw-product-backup.ts pid-dictionaries
node scripts/cw-product-backup.ts mt-products
node scripts/cw-product-backup.ts catalogue-assets
node scripts/cw-product-backup.ts public-measurements
node scripts/cw-product-backup.ts public-tuples
CW_BACKUP_TUPLES_FILE=public-source-tuples.json CW_BACKUP_CONCURRENCY=8 node scripts/cw-product-backup.ts measurements
node scripts/cw-product-backup.ts finalize-index
node scripts/cw-product-backup.ts reference-review
node scripts/cw-product-backup.ts verify
```

The existing `graphql-schema.json`, MT model indexes, and temporary authentication
file are produced by the initial retrieval. Credentials and authentication tokens
are excluded from the archive. Completed pages and measurement records are reused;
partial file writes have a `.part` suffix. The measurement service's explicit
"product does not exist" responses are retained rather than fabricated values.

Style discovery follows the PID selector and its unconditional exclusions.
Configuration references follow the CW40 editor: combine every `my-sofa-is`
group, skip `DF`, and separate groups with `__`. For example, Axis Grande uses
`CB-AS-105__SV_STD__3S-3B`; the shorter `CB-AS-105__SV_STD` omits its cushion
configuration. The archive also preserves unscoped products, saved historical
references, and catalogue-linked references from the MT model index. Raw
unconfirmed responses are retained for archival purposes and excluded from
measurement loading.

`REFERENCE_REVIEW.md` highlights remaining service misses after excluding models
marked unconfirmed. `REPORT.md` records retrieval coverage and integrity checks.
`STYLE_REVIEW.md` highlights responses whose style name or code differs from the
requested selection. Those measurements are withheld until the mapping is
verified. The raw public all-options endpoint is also preserved under
`public-measurements/`; its available reference/style names are evidence for
review, and do not automatically replace a configured model or confirmation flag.
Exact additional reference/style pairs from that source are saved in
`public-source-tuples.json` and retrieved through the detailed service. Their raw
records and images are backed up, including products without a matching current
CW40 configuration, but they remain separate from the live library index.
HTTP 404 assets remain explicitly listed as unavailable at the source. A complete
retrieval pass means every indexed request was handled, not that the original
service contained measurements for every product.

## Hosted storage

### Vercel with Cloudflare R2 (preferred)

Keep the 1.5 GB runtime archive outside the Vercel build, in the private R2 bucket
`cw-measurement-archive`. Public access must remain disabled. Use a temporary
object read/write credential scoped to this bucket for the upload, and a separate
object read-only credential scoped to this bucket for Vercel. Existing app sharing
credentials must not grant access to this bucket.

All hosted objects are additionally encrypted with AES-256-GCM, bound to their
exact object key, with compressed JSON inside the encrypted envelope. No raw
measurement records, diagrams, or source URLs are publicly readable. The API
verifies the company user's Sofapaint session before decrypting any object. A
missing key, altered object, or wrong key fails closed. Original files remain
unchanged in the local shutdown backup.

For setup without showing credentials to Codex, run
`node scripts/cw-hosting-setup.ts` yourself in an interactive Terminal. It requests
the upload key and separate read-only key with hidden input, uploads and verifies
the runtime archive, stores only the read-only key as sensitive Vercel Preview
environment variables, and deploys a preview. The Cloudflare keys remain in
process memory and are never printed or written to the repository. Create the
tokens yourself in Cloudflare; enter **Access Key ID** and **Secret Access Key**,
not Token Value. The helper stores the separate encryption recovery key in a
permission-0600 file beside the local archive. Keep that file secure.

Configure these **server-only** Vercel environment variables (never `VITE_`):

- `CW_ARCHIVE_R2_BUCKET=cw-measurement-archive`
- `CW_ARCHIVE_R2_PREFIX=private/cw-measurements/2026-09-29`
- `CW_ARCHIVE_R2_ACCESS_KEY_ID` and `CW_ARCHIVE_R2_SECRET_ACCESS_KEY` (read-only key)
- `CW_ARCHIVE_ENCRYPTION_KEY` (64 hex characters generated from 32 random bytes)
- `R2_ACCOUNT_ID`, plus the existing Supabase Auth configuration

Do not set `CW_ARCHIVE_DIR` on Vercel. Keep the encryption key in a separate,
secure recovery file outside the repository and archive; losing it makes the
hosted ciphertext unusable, but the original local backup remains recoverable.

`build:vercel` bundles the TypeScript measurement server slice into ignored
`server/vercel-routes/cw/generated/*.mjs` files. Vercel function configuration
includes these bundles explicitly; production uses them while local development
uses the canonical TypeScript files. This avoids legacy JavaScript imports
pointing at TypeScript filenames that Vercel transforms during function packaging.

Put the upload credential, encryption key, bucket, and prefix in a permission-0600
file outside the repository, then run:

```sh
CW_HOSTING_ENV_FILE=/secure/path/cw-upload.env node scripts/cw-archive-upload.ts --dry-run
CW_HOSTING_ENV_FILE=/secure/path/cw-upload.env node scripts/cw-archive-upload.ts
```

The uploader selects the runtime indexes, tuple records, image maps, and their
referenced assets. It verifies every local SHA-256, uses checked uploads, saves
resumable state, and authenticates read-back samples including both indexes.
Unavailable source assets remain unavailable. The server resizes only large
image responses to fit Vercel's response limit; the archived originals are intact.

### Supabase alternative

Before hosting the archive, apply migration
`20260929000000_private_cw_measurement_archive.sql`. It prevents anonymous and
authenticated browser clients from reading the archive through Supabase Storage,
including where another permissive storage policy exists. Only the server's
service role can read its objects, after the server verifies the company user.

Create a **private** bucket named `cw-measurement-archive`, upload the runtime index,
tuple index, `measurements/`, `asset-maps/`, and `assets/`, and configure
`CW_ARCHIVE_BUCKET=cw-measurement-archive` on the server. Do not put the raw archive
in `public/` or grant direct client Storage policies. Do not use public or signed
Storage URLs for the library. The server verifies bucket privacy and proxies
images through the authenticated API.

The local archive and source implementation do not by themselves change the
production deployment. Hosted activation requires the private storage migration,
data upload, server environment configuration, and deployment.

### Comparison differences

With two models, the Difference column subtracts the left model from the right
model (for example, 199.0 − 154.0 = +45.0 cm). With three or four models it shows
the range from smallest to largest. Green rows are the same at the displayed
one-decimal precision; amber rows differ. The text says Same, Different, or
Range so colour is not the only signal. Missing or unconfirmed values leave the
difference blank. The comparison PDF includes the same calculation.

### Quick drawing in the search library

Click any confirmed component diagram to open the focused Fabric drawing editor.
Choose measurements in the side library, then drag a straight line; arrows appear
at both ends. Curved draws a quadratic line in three clicks (start, bend, end),
with arrows following the curve's direction at both ends. The next selected,
undrawn measurement is armed automatically. Point tag places one anchor and a
numeric label, with a leader when dragged. Editable text and selection are the
other tools. Select lets the user drag each numeric label independently of its
measurement line; a point tag's leader follows the label while its anchor stays
put. Drawing values use one decimal place: inches appear as `5.5"`, while
centimetres have a smaller `cm` suffix. Tables, copied values, and PDFs also
use one decimal place. All annotation text is white with a black outline. Line colours
repeat through a fixed six-colour palette (red, yellow, green, cyan, blue,
magenta) and use a fine black edge for contrast against the diagram. The toolbar
keeps label sizing, delete, undo/redo, and fit; scrolling zooms and Space pans.

Annotations are stored as editable vectors in memory, separately for each model
and diagram. They remain visible on thumbnails after closing and can be edited
again while that page stays open. Reloading, leaving the page, or signing out
clears them. Copy image and Save PNG export the diagram at its original pixel
size; the model's PDF includes annotated diagrams in the units selected when
export began. Neither annotations nor exports are uploaded to another service.
The editor is loaded only when a diagram is opened and does not modify the
full drawing workspace's canvas or stroke maps.
