import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ success: false, message: 'Supabase not configured' });
  }

  const { projectId } = req.query;
  if (!projectId) {
    return res.status(400).json({ success: false, message: 'projectId is required' });
  }

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('cloud_projects')
        .select('*')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, message: 'Project not found' });

      if (data.expires_at && new Date() > new Date(data.expires_at)) {
        return res.status(410).json({ success: false, message: 'Project link has expired' });
      }

      return res.status(200).json({
        success: true,
        projectData: data.data,
        projectInfo: {
          id: data.id,
          createdAt: data.created_at,
          expiresAt: data.expires_at,
          title: data.title,
        },
      });
    } catch (error) {
      console.error('Error retrieving cloud project:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error retrieving project',
        detail: error?.message || String(error),
      });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { editToken, projectData, title = null, expiresAt = null } = req.body || {};
      if (!editToken) {
        return res.status(400).json({ success: false, message: 'editToken is required' });
      }

      const { data, error } = await supabase
        .from('cloud_projects')
        .select('*')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      if (!data) return res.status(404).json({ success: false, message: 'Project not found' });
      if (data.edit_token && data.edit_token !== editToken) {
        return res.status(403).json({ success: false, message: 'Invalid edit token' });
      }

      const updated = {
        title: title ?? data.title,
        data: projectData && typeof projectData === 'object' ? projectData : data.data,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : data.expires_at,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from('cloud_projects')
        .update(updated)
        .eq('id', projectId);
      if (updateError) throw updateError;

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error updating cloud project:', error);
      return res.status(500).json({
        success: false,
        message: 'Server error updating project',
        detail: error?.message || String(error),
      });
    }
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
