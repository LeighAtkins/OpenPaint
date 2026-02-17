-- Fix projects table schema to match expected structure

-- Rename user_id to created_by
alter table public.projects rename column user_id to created_by;

-- Rename name to project_name
alter table public.projects rename column name to project_name;

-- Add customer_name column (optional)
alter table public.projects add column customer_name text;

-- Add sofa_model column (optional)
alter table public.projects add column sofa_model text;

-- Drop is_public column (not needed in new schema)
alter table public.projects drop column if exists is_public;

-- Drop version column (not needed in new schema)
alter table public.projects drop column if exists version;

-- Drop description column (not needed in new schema)
alter table public.projects drop column if exists description;

-- Drop thumbnail_url column (not needed in new schema)
alter table public.projects drop column if exists thumbnail_url;
