-- Adds threaded replies to comments. One column, additive, idempotent —
-- no other schema change needed and no new RLS policies: a reply is just
-- a comments row with parent_id set, so it's already covered by every
-- existing INSERT/UPDATE/DELETE policy on the comments table (same
-- author-owns-it / workspace-owner-can-delete-any rules apply to replies
-- automatically). Only SELECT read paths in the app needed to change, to
-- group replies under their parent for display.

alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete cascade;
create index if not exists comments_parent_id_idx on public.comments (parent_id) where parent_id is not null;
