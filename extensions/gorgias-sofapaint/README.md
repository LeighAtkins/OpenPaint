# Gorgias to SofaPaint

This unpacked Chrome extension sends selected image attachments from the Gorgias ticket currently open in Chrome to SofaPaint. It uses the existing signed-in browser session and does not require a Gorgias API key or OAuth application.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extensions/gorgias-sofapaint` folder.
5. Pin **Gorgias to SofaPaint** from Chrome's Extensions menu.

## Use

1. Open a Gorgias ticket. The extension scans the full conversation automatically, including lazy-loaded attachment cards.
2. Click the extension.
3. Select the photos and click **Send selected to SofaPaint**.
4. SofaPaint opens (or reuses an open tab) and imports the files through its normal upload pipeline.

The extension also carries over the Gorgias customer, product title, SKU-derived guide code,
and source-ticket link. SofaPaint cloud-saves the completed import and records each image hash,
so importing the same ticket later adds new attachments without duplicating existing photos.

Unopened Gorgias attachment cards are resolved directly from their page metadata. They do not need to be opened one by one. If an attachment is hosted outside Gorgias, Chrome may ask once for access to that specific image host.

Links named **Front view**, **Side view**, **Back view**, or **Cushion view** are also treated as full-resolution ticket photos. Their labels are carried into SofaPaint, so the imported views and Image part labels are populated automatically even when the underlying file is named something generic such as `IMG_5392.jpeg`.

The scan is limited to the ticket conversation. Agent avatars, interface icons,
Shopify product thumbnails, and fabric swatches in the customer sidebar are not
offered as project images.

Selected photos download with a four-file concurrency limit. SofaPaint begins
adding the first completed photo immediately, keeps the original ticket order,
and shows live progress while the remaining photos are still transferring.

The SofaPaint address defaults to `http://127.0.0.1:5173/` and can be changed in the extension popup for a Vercel deployment.

## Permissions

- Reads the current Comfort Works Gorgias ticket DOM and downloads only selected inline images or image attachment cards.
- Sends those image bytes to the configured SofaPaint tab.
- Does not edit tickets, send messages, read passwords, or use Gorgias API credentials.
