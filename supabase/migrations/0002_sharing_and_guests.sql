-- Adds: public workspace sharing (secret share-token URLs) and guest
-- commenting (no account) on top of the existing schema. Additive and
-- idempotent — safe to run on top of 0001, and safe to rerun.
--
-- SECURITY MODEL — read this before enabling sharing on a real workspace:
--
-- Guests are never given a Supabase account or JWT. They use Postgres's
-- `anon` role via the public API key, same as any unauthenticated visitor.
-- Two secrets do the access control instead of auth.uid():
--
--   1. share_token (per workspace) — a guest's browser sends this as the
--      `x-relay-share-token` request header on every call. RLS below only
--      grants anon SELECT/INSERT on a workspace's rows when this header
--      matches that workspace's stored token AND share_enabled is true.
--      This is "anyone with the link" access, by design — treat the link
--      as a bearer credential. Disabling sharing (share_enabled = false)
--      or regenerating the token immediately revokes every outstanding
--      link.
--
--   2. guest_token (per comment) — generated client-side when a guest
--      first identifies themselves, stored on every comment they create,
--      and required (as the `x-relay-guest-token` header) to edit or
--      delete that comment. This is what lets a guest manage only their
--      own comments without an account. It is intentionally never
--      included in any SELECT response the app issues (see server.js) —
--      if it were, anyone who can read a comment could forge deletion
--      rights over it. Application code, not RLS, is the only thing
--      enforcing that it's never selected — review server.js's comment
--      column lists if you modify them.
--
-- Both headers are read via Supabase/PostgREST's `request.headers` GUC,
-- which the platform populates from the actual incoming request headers.

create or replace function public.request_header(name text) returns text
  language sql stable as
  $$ select nullif(current_setting('request.headers', true)::json->>name, '') $$;

alter table public.workspaces add column if not exists share_token text unique;
alter table public.workspaces add column if not exists share_enabled boolean not null default false;

-- A guest comment has no author_id; an account comment has no guest_*
-- fields. Exactly one identity, always.
alter table public.comments alter column author_id drop not null;
alter table public.comments add column if not exists guest_name text check (char_length(guest_name) between 1 and 100);
alter table public.comments add column if not exists guest_email text check (char_length(guest_email) between 3 and 320);
alter table public.comments add column if not exists guest_token text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comments_identity_check'
  ) then
    alter table public.comments add constraint comments_identity_check check (
      (author_id is not null and guest_name is null and guest_email is null and guest_token is null)
      or
      (author_id is null and guest_name is not null and guest_email is not null and guest_token is not null)
    );
  end if;
end $$;

create index if not exists comments_guest_token_idx on public.comments (guest_token) where guest_token is not null;
create index if not exists workspaces_share_token_idx on public.workspaces (share_token) where share_token is not null;

-- ---- Public (anon) access via a valid share token ----------------------

drop policy if exists "public share workspace view" on public.workspaces;
create policy "public share workspace view" on public.workspaces for select to anon using (
  share_enabled = true and share_token is not null and share_token = request_header('x-relay-share-token')
);

drop policy if exists "public share media view" on public.media;
create policy "public share media view" on public.media for select to anon using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.share_enabled and w.share_token = request_header('x-relay-share-token')
  )
);

drop policy if exists "public share comments view" on public.comments;
create policy "public share comments view" on public.comments for select to anon using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.share_enabled and w.share_token = request_header('x-relay-share-token')
  )
);

drop policy if exists "public share comments create" on public.comments;
create policy "public share comments create" on public.comments for insert to anon with check (
  author_id is null and guest_name is not null and guest_email is not null and guest_token is not null
  and exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.share_enabled and w.share_token = request_header('x-relay-share-token')
  )
);

drop policy if exists "public share comments update own" on public.comments;
create policy "public share comments update own" on public.comments for update to anon using (
  guest_token is not null and guest_token = request_header('x-relay-guest-token')
);

drop policy if exists "public share comments delete own" on public.comments;
create policy "public share comments delete own" on public.comments for delete to anon using (
  guest_token is not null and guest_token = request_header('x-relay-guest-token')
);

-- Guests never see profiles rows (there's nothing of theirs there), but
-- comment authors' display names need to render for guests too. Scope
-- this narrowly: a guest can only read a profile that authored a comment
-- inside a workspace they hold a valid share token for — NOT every
-- profile in the system. (The original "profiles visible" policy from
-- 0001 has no `to` clause, so it applies to every role by default —
-- tightening it to `authenticated` here is a deliberate hardening, not a
-- functional change for account holders.)
drop policy if exists "profiles visible" on public.profiles;
create policy "profiles visible" on public.profiles for select to authenticated using (true);

drop policy if exists "public share profiles view" on public.profiles;
create policy "public share profiles view" on public.profiles for select to anon using (
  exists (
    select 1 from public.comments c
    join public.workspaces w on w.id = c.workspace_id
    where c.author_id = profiles.id
      and w.share_enabled and w.share_token = request_header('x-relay-share-token')
  )
);

grant select on public.profiles to anon;
grant select, insert, update, delete on public.workspaces, public.media, public.comments to anon;

-- ---- Workspace owner can moderate: delete any comment in their workspace,
--      not just their own -----------------------------------------------

drop policy if exists "comments delete owner" on public.comments;
create policy "comments delete owner" on public.comments for delete using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

-- Deliberately NOT giving the workspace owner an UPDATE policy on other
-- people's comments: moderation should mean removal, not silently
-- rewriting someone else's words. Owners can delete; editing is always
-- self-only (see "comments update own" above).

-- ---- Workspace deletion (owner only). Deleting the row cascades to
--      workspace_members, media, and comments via existing FKs — nothing
--      else to clean up on the DB side. Never touches Google Drive itself,
--      since the app never stores Drive files, only references to them. --

drop policy if exists "workspace delete owner" on public.workspaces;
create policy "workspace delete owner" on public.workspaces for delete using (owner_id = auth.uid());
