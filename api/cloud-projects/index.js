import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { projectData, title = null, expiresAt = null } = req.body || {};
      if (!projectData || typeof projectData !== 'object') {
        return res.status(400).json({ success: false, message: 'Project data is required' });
      }

      const supabase = getSupabaseAdmin();
      if (!supabase) {
        return res.status(500).json({ success: false, message: 'Supabase not configured' });
      }

      const projectId = crypto.randomBytes(12).toString('hex');
      const editToken = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString();
      const expiry = expiresAt ? new Date(expiresAt).toISOString() : null;

      const record = {
        id: projectId,
        title,
        data: projectData,
        edit_token: editToken,
        created_at: now,
        updated_at: now,
        expires_at: expiry,
      };

      const { error } = await supabase.from('cloud_projects').insert(record);
      if (error) throw error;

      return res.status(200).json({
        success: true,
        projectId,
        editToken,
        shareUrl: `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/open/${projectId}`,
        createdAt: now,
        expiresAt: expiry,
      });
    } catch (error) {
      console.error('Error creating cloud project:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error creating project',
        detail: error?.message || String(error),
      });
    }
  }

  res.setHeader('Allow', 'POST');
  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
