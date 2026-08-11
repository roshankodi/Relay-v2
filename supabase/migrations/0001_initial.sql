-- Relay initial schema.
-- Safe to run multiple times: every statement either uses IF NOT EXISTS,
-- CREATE OR REPLACE, or a DROP ... IF EXISTS immediately before CREATE.
-- Running this again after a partial/previous run will not error, and will
-- restore any policy or trigger that a partial run left missing.

create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  description text check (char_length(description) <= 500),
  drive_folder_id text not null,
  drive_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, drive_folder_id)
);

create table if not exists public.workspace_members (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (workspace_id, user_id)
);

create table if not exists public.media (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  drive_file_id text not null,
  path text not null,
  name text not null,
  mime_type text not null,
  media_kind text not null check (media_kind in ('video', 'audio', 'image')),
  modified_at timestamptz,
  thumbnail_url text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, drive_file_id)
);

create table if not exists public.comments (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  timestamp_ms bigint check (timestamp_ms >= 0),
  range_start_ms bigint check (range_start_ms >= 0),
  range_end_ms bigint check (range_end_ms >= range_start_ms),
  annotation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (timestamp_ms is not null)::int
    + (range_start_ms is not null)::int
    + (annotation is not null)::int <= 1
  )
);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.media enable row level security;
alter table public.comments enable row level security;

-- Explicit grants. Supabase normally sets these up automatically via
-- default privileges on the public schema, but stating them here makes
-- the migration self-contained and rerunning it will repair a project
-- where grants were ever changed by hand. RLS policies below still gate
-- every row -- these grants alone do not expose any data.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.profiles, public.workspaces, public.workspace_members,
  public.media, public.comments
  to authenticated;
grant select on public.profiles to anon;

create or replace function public.is_member(w uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists(select 1 from workspace_members where workspace_id = w and user_id = auth.uid()) $$;

create or replace function public.can_comment(w uuid) returns boolean
  language sql stable security definer set search_path = public as
  $$ select exists(select 1 from workspace_members where workspace_id = w and user_id = auth.uid() and role in ('owner', 'editor')) $$;

drop policy if exists "profiles visible" on public.profiles;
create policy "profiles visible" on public.profiles for select using (true);

drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles for update using (id = auth.uid());

drop policy if exists "members view" on public.workspace_members;
create policy "members view" on public.workspace_members for select using (is_member(workspace_id));

drop policy if exists "owner membership create" on public.workspace_members;
create policy "owner membership create" on public.workspace_members for insert with check (
  user_id = auth.uid()
  and role = 'owner'
  and exists (select 1 from public.workspaces where id = workspace_id and owner_id = auth.uid())
);

drop policy if exists "workspace view" on public.workspaces;
create policy "workspace view" on public.workspaces for select using (is_member(id));

-- An INSERT with RETURNING (which PostgREST does via `Prefer:
-- return=representation`) must also satisfy a SELECT policy on the row it
-- just wrote -- not just the INSERT policy's WITH CHECK. Without this, a
-- brand-new workspace has no workspace_members row yet (that's created in
-- the *next* request), so "workspace view" above denies it, and the
-- INSERT itself fails with "new row violates row-level security policy"
-- even though ownership is correct. This policy closes that gap.
drop policy if exists "workspace view own" on public.workspaces;
create policy "workspace view own" on public.workspaces for select using (owner_id = auth.uid());

drop policy if exists "workspace create" on public.workspaces;
create policy "workspace create" on public.workspaces for insert with check (owner_id = auth.uid());

drop policy if exists "workspace update owner" on public.workspaces;
create policy "workspace update owner" on public.workspaces for update using (owner_id = auth.uid());

drop policy if exists "media view" on public.media;
create policy "media view" on public.media for select using (is_member(workspace_id));

drop policy if exists "media manage owner" on public.media;
create policy "media manage owner" on public.media for all
  using (exists (select 1 from public.workspaces where id = workspace_id and owner_id = auth.uid()))
  with check (exists (select 1 from public.workspaces where id = workspace_id and owner_id = auth.uid()));

drop policy if exists "comments view" on public.comments;
create policy "comments view" on public.comments for select using (is_member(workspace_id));

drop policy if exists "comments create editor" on public.comments;
create policy "comments create editor" on public.comments for insert with check (
  author_id = auth.uid() and can_comment(workspace_id)
);

drop policy if exists "comments change own" on public.comments;
create policy "comments change own" on public.comments for update using (author_id = auth.uid());

drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete using (author_id = auth.uid());

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
  $$
  begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
      new.raw_user_meta_data->>'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
  end;
  $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.updated_at() returns trigger
  language plpgsql as
  $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists workspaces_updated on public.workspaces;
create trigger workspaces_updated before update on public.workspaces
  for each row execute procedure public.updated_at();

drop trigger if exists media_updated on public.media;
create trigger media_updated before update on public.media
  for each row execute procedure public.updated_at();

drop trigger if exists comments_updated on public.comments;
create trigger comments_updated before update on public.comments
  for each row execute procedure public.updated_at();

-- Realtime publication: adding a table twice throws, so guard it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;
