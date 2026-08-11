-- Run these one at a time in the Supabase SQL Editor if workspace creation
-- (or any insert) still 403s after reapplying 0001_initial.sql.

-- 1. Confirm the five expected policies exist on workspaces/workspace_members.
select tablename, policyname, cmd, with_check
from pg_policies
where tablename in ('workspaces', 'workspace_members')
order by tablename, cmd;

-- 2. Confirm the `authenticated` role actually has INSERT privilege on the
--    table itself. RLS policies only apply on top of an underlying grant —
--    if this returns false, the policy is irrelevant; grant is missing.
select has_table_privilege('authenticated', 'public.workspaces', 'INSERT');

-- 3. List every user in this project and their id. Compare the id here
--    against what GET /api/session returns in your browser while logged
--    in -- they must be the exact same project and the exact same user.
select id, email, created_at from auth.users order by created_at desc;

-- 4. Confirm profiles were created for each user (the signup trigger).
--    A missing row here doesn't block workspace creation directly, but
--    indicates the on_auth_user_created trigger isn't firing.
select id, display_name from public.profiles order by created_at desc;
