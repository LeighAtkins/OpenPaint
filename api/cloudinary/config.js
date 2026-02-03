export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const uploadPreset = (process.env.CLOUDINARY_UPLOAD_PRESET || '').trim();
  const folder = (process.env.CLOUDINARY_UPLOAD_FOLDER || '').trim();

  return res.status(200).json({
    success: Boolean(cloudName && uploadPreset),
    cloudName: cloudName || null,
    uploadPreset: uploadPreset || null,
    folder: folder || null,
  });
}
