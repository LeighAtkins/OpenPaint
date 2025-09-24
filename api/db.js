/**
 * Minimal DB helper for Vercel Postgres with safe fallbacks
 */

let sql = null;
try {
	sql = require('@vercel/postgres').sql;
} catch (err) {
	// Running locally without dependency or outside Vercel
	sql = null;
}

function isDbConfigured() {
	return Boolean(
		sql && (
			process.env.POSTGRES_URL ||
			process.env.POSTGRES_PRISMA_URL ||
			process.env.POSTGRES_URL_NON_POOLING
		)
	);
}

async function ensureSchema() {
	if (!isDbConfigured()) return false;
	// Use slug as primary key to avoid extension requirements
	await sql`
		CREATE TABLE IF NOT EXISTS projects (
			slug TEXT PRIMARY KEY,
			title TEXT,
			data JSONB NOT NULL,
			edit_token TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		);
	`;
	return true;
}

async function createOrUpdateProject({ slug, title, data, editToken }) {
	if (!isDbConfigured()) throw new Error('Database not configured');
	await sql`
		INSERT INTO projects (slug, title, data, edit_token)
		VALUES (${slug}, ${title ?? null}, ${sql.json(data)}, ${editToken ?? null})
		ON CONFLICT (slug)
		DO UPDATE SET
			title = EXCLUDED.title,
			data = EXCLUDED.data,
			edit_token = EXCLUDED.edit_token,
			updated_at = NOW();
	`;
	return { slug };
}

async function getProjectBySlug(slug) {
	if (!isDbConfigured()) throw new Error('Database not configured');
	const { rows } = await sql`
		SELECT slug, title, data, edit_token, created_at, updated_at
		FROM projects
		WHERE slug = ${slug}
		LIMIT 1;
	`;
	return rows[0] || null;
}

module.exports = {
	isDbConfigured,
	ensureSchema,
	createOrUpdateProject,
	getProjectBySlug
};
