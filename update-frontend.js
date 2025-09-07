const fs = require('fs');
const path = require('path');

// Read the current paint.js file
const paintJsPath = path.join(__dirname, 'js', 'paint.js');
let content = fs.readFileSync(paintJsPath, 'utf8');

// Replace the old remove background implementation with the new Cloudflare Images flow
const oldImplementation = `                    const fd = new FormData();
                    fd.append('image', blob, 'image.png');
                    const resp = await fetch('/api/remove-background', { method: 'POST', body: fd });
                    const data = await resp.json();
                    if (!data || !data.success) throw new Error(data && data.message || 'REMBG failed');
                    const processedUrl = data.processed || data.url;
                    if (!processedUrl) throw new Error('No processed URL returned');

                    if (typeof pasteImageFromUrl === 'function') {
                        await pasteImageFromUrl(processedUrl, label);
                    }
                    if (!window.originalImages) window.originalImages = {};
                    window.originalImages[label] = processedUrl;`;

const newImplementation = `                    // Step 1: Get direct upload URL from Cloudflare Worker
                    const uploadResp = await fetch('/api/images/direct-upload', { 
                        method: 'POST',
                        headers: { 'x-api-key': 'dev-secret' }
                    });
                    const uploadData = await uploadResp.json();
                    if (!uploadData.success || !uploadData.result?.uploadURL) {
                        throw new Error('Failed to get upload URL');
                    }

                    // Step 2: Upload image directly to Cloudflare Images
                    const formData = new FormData();
                    formData.append('file', blob, 'image.png');
                    const imageUploadResp = await fetch(uploadData.result.uploadURL, {
                        method: 'POST',
                        body: formData
                    });
                    const imageUploadData = await imageUploadResp.json();
                    if (!imageUploadData.success || !imageUploadData.result?.id) {
                        throw new Error('Failed to upload image');
                    }

                    // Step 3: Remove background using Cloudflare Images
                    const bgRemoveResp = await fetch('/api/remove-background', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': 'dev-secret'
                        },
                        body: JSON.stringify({
                            imageId: imageUploadData.result.id,
                            return: 'url'
                        })
                    });
                    const bgRemoveData = await bgRemoveResp.json();
                    if (!bgRemoveData.success || !bgRemoveData.cutoutUrl) {
                        throw new Error(bgRemoveData.message || 'Background removal failed');
                    }

                    // Step 4: Apply the processed image
                    if (typeof pasteImageFromUrl === 'function') {
                        await pasteImageFromUrl(bgRemoveData.cutoutUrl, label);
                    }
                    if (!window.originalImages) window.originalImages = {};
                    window.originalImages[label] = bgRemoveData.cutoutUrl;`;

// Replace the implementation
content = content.replace(oldImplementation, newImplementation);

// Write the updated file
fs.writeFileSync(paintJsPath, content);

console.log('✅ Updated paint.js with new Cloudflare Images flow');
console.log('📝 Next steps:');
console.log('1. Set REMBG_ORIGIN environment variable in Vercel to: https://sofapaint-api.sofapaint-api.workers.dev');
console.log('2. Deploy to Vercel');
console.log('3. Test the remove background feature');
