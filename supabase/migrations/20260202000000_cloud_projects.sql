-- Cloud-saved projects (anyone-with-link)
create table if not exists public.cloud_projects (
  id text primary key,
  title text,
  data jsonb not null,
  edit_token text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  expires_at timestamp with time zone
);

alter table public.cloud_projects enable row level security;
