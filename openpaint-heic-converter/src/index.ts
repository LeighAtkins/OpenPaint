/**
 * OpenPaint HEIC Converter Worker
 * 
 * Converts HEIC/HEIF images to JPEG using Cloudinary
 * 
 * Setup:
 * 1. Create a Cloudinary account (free tier works)
 * 2. Get your Cloud Name from the dashboard
 * 3. Create an Upload Preset (unsigned, allows format conversion)
 * 4. Set secrets: wrangler secret put CLOUDINARY_CLOUD_NAME
 * 5. Set secrets: wrangler secret put CLOUDINARY_UPLOAD_PRESET
 * 6. Deploy: npm run deploy
 */

interface Env {
	CLOUDINARY_CLOUD_NAME?: string;
	CLOUDINARY_UPLOAD_PRESET?: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Max-Age': '86400',
				},
			});
		}

		// Only accept POST requests
		if (request.method !== 'POST') {
			return jsonResponse(
				{ error: 'Method not allowed. Use POST to upload files.' },
				405
			);
		}

		try {
			// Get the uploaded file from FormData
			const formData = await request.formData();
			const file = formData.get('file');

			if (!file || !(file instanceof File)) {
				return jsonResponse(
					{ error: 'No file provided. Please upload a file.' },
					400
				);
			}

			// Check if it's a HEIC/HEIF file
			const fileName = file.name.toLowerCase();
			const fileType = (file.type || '').toLowerCase();
			const isHeic =
				fileType === 'image/heic' ||
				fileType === 'image/heif' ||
				fileName.endsWith('.heic') ||
				fileName.endsWith('.heif');

			if (!isHeic) {
				return jsonResponse(
					{ error: 'File is not a HEIC/HEIF image. Please upload a .heic or .heif file.' },
					400
				);
			}

			// Convert HEIC to JPEG
			const convertedBlob = await convertHeicToJpeg(file, env);

			// Return the converted image
			const outputFileName = fileName.replace(/\.heic?$/i, '.jpg');

			return new Response(convertedBlob, {
				headers: {
					'Content-Type': 'image/jpeg',
					'Access-Control-Allow-Origin': '*',
					'Content-Disposition': `inline; filename="${outputFileName}"`,
					'Cache-Control': 'public, max-age=3600',
				},
			});
		} catch (error) {
			console.error('[Worker] Conversion error:', error);

			return jsonResponse(
				{
					error: 'Conversion failed',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			);
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * Convert HEIC file to JPEG using Cloudinary
 * 
 * @param file - The HEIC file to convert
 * @param env - Worker environment variables (must contain CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET)
 * @returns The converted JPEG image as a Blob
 */
async function convertHeicToJpeg(file: File, env: Env): Promise<Blob> {
	// Check if Cloudinary is configured
	if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_UPLOAD_PRESET) {
		throw new Error(
			'HEIC conversion not configured. ' +
			'Please set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET secrets. ' +
			'Run: wrangler secret put CLOUDINARY_CLOUD_NAME'
		);
	}

	const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;

	const formData = new FormData();
	formData.append('file', file);
	formData.append('upload_preset', env.CLOUDINARY_UPLOAD_PRESET);
	// Note: format and quality must be set in the Upload Preset for unsigned uploads

	const response = await fetch(cloudinaryUrl, {
		method: 'POST',
		body: formData,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Cloudinary upload failed: ${response.status} ${errorText}`);
	}

	const data = (await response.json()) as { secure_url: string; format: string };

	// If the image wasn't converted by the preset, use Cloudinary transformation URL
	let imageUrl = data.secure_url;
	if (data.format !== 'jpg' && data.format !== 'jpeg') {
		// Transform the URL to convert to JPEG
		// Replace /upload/ with /upload/f_jpg,q_auto:good/
		imageUrl = imageUrl.replace(/\/upload\//, '/upload/f_jpg,q_auto:good/');
	}

	// Fetch the converted image
	const imageResponse = await fetch(imageUrl);
	if (!imageResponse.ok) {
		throw new Error(`Failed to fetch converted image: ${imageResponse.status}`);
	}

	return await imageResponse.blob();
}

/**
 * Helper to return JSON responses with CORS headers
 */
function jsonResponse(data: object, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
		},
	});
}
