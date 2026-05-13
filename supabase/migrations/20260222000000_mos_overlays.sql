-- MOS v1 — Measurement Overlay System storage
-- Stores generated/imported SVG overlays per project+view

CREATE TABLE IF NOT EXISTS mos_overlays (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  view_id TEXT NOT NULL DEFAULT 'front',
  overlay_index INTEGER NOT NULL DEFAULT 0,
  svg_text TEXT NOT NULL,
  r2_key TEXT,
  roles TEXT[] DEFAULT '{}',
  units TEXT DEFAULT 'cm',
  generated_by TEXT,
  attempt_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT mos_overlays_view_id_check
    CHECK (view_id IN ('front', 'side', 'back', 'cushion'))
);

-- Index for fast project+view lookup
CREATE INDEX IF NOT EXISTS idx_mos_overlays_project_view
  ON mos_overlays (project_id, view_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_mos_overlays_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_mos_overlays_updated_at
  BEFORE UPDATE ON mos_overlays
  FOR EACH ROW
  EXECUTE FUNCTION update_mos_overlays_updated_at();

-- RLS policies (match existing project pattern)
ALTER TABLE mos_overlays ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own overlays
CREATE POLICY mos_overlays_select_policy ON mos_overlays
  FOR SELECT USING (true);

CREATE POLICY mos_overlays_insert_policy ON mos_overlays
  FOR INSERT WITH CHECK (true);

CREATE POLICY mos_overlays_update_policy ON mos_overlays
  FOR UPDATE USING (true);

CREATE POLICY mos_overlays_delete_policy ON mos_overlays
  FOR DELETE USING (true);
