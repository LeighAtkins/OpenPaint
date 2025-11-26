-- Enable necessary extensions
create extension if not exists "uuid-ossp";

-- User Profiles Table
create table public.user_profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  display_name text,
  avatar_url text,
  preferences jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Projects Table
create table public.projects (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  description text,
  is_public boolean default false,
  version integer default 1,
  data jsonb default '{}'::jsonb not null,
  tags text[] default array[]::text[],
  thumbnail_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Project Images Table
create table public.project_images (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects on delete cascade not null,
  label text not null,
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  width integer not null,
  height integer not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(project_id, label)
);

-- Enable Row Level Security
alter table public.user_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_images enable row level security;

-- RLS Policies: User Profiles
create policy "Public profiles are viewable by everyone."
  on public.user_profiles for select
  using ( true );

create policy "Users can insert their own profile."
  on public.user_profiles for insert
  with check ( auth.uid() = id );

create policy "Users can update own profile."
  on public.user_profiles for update
  using ( auth.uid() = id );

-- RLS Policies: Projects
create policy "Projects are viewable by everyone if public."
  on public.projects for select
  using ( is_public = true );

create policy "Users can view their own projects."
  on public.projects for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own projects."
  on public.projects for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own projects."
  on public.projects for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own projects."
  on public.projects for delete
  using ( auth.uid() = user_id );

-- RLS Policies: Project Images
create policy "Project images are viewable if project is viewable."
  on public.project_images for select
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_images.project_id
      and (projects.is_public = true or projects.user_id = auth.uid())
    )
  );

create policy "Users can insert images to their own projects."
  on public.project_images for insert
  with check (
    exists (
      select 1 from public.projects
      where projects.id = project_images.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can update images in their own projects."
  on public.project_images for update
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_images.project_id
      and projects.user_id = auth.uid()
    )
  );

create policy "Users can delete images from their own projects."
  on public.project_images for delete
  using (
    exists (
      select 1 from public.projects
      where projects.id = project_images.project_id
      and projects.user_id = auth.uid()
    )
  );

-- Functions
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

-- Triggers
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
