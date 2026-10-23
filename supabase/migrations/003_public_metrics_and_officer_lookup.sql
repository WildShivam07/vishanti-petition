-- Privacy-safe aggregate dashboard and student-safe assigned officer lookup.
-- Apply after 001_initial_schema.sql in Supabase SQL Editor.

create or replace function public.public_complaint_metrics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*),
    'resolved', count(*) filter (where status = 'RESOLVED'),
    'average_resolution_hours', avg(extract(epoch from (resolved_at - created_at))/3600) filter (where status = 'RESOLVED' and resolved_at is not null),
    'statuses', coalesce((select jsonb_object_agg(s.status::text, s.count) from (select status, count(*) as count from public.complaints group by status) s), '{}'::jsonb),
    'categories', coalesce((select jsonb_object_agg(c.category, c.count) from (select category, count(*) as count from public.complaints group by category) c), '{}'::jsonb)
  ) from public.complaints;
$$;
revoke all on function public.public_complaint_metrics() from public;
grant execute on function public.public_complaint_metrics() to anon, authenticated;

-- This exposes only the officer name/department for complaints owned by the caller.
-- It does not grant direct access to other students' profiles.
create or replace function public.get_my_complaint_officers()
returns table(complaint_id uuid, officer_name text, department text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, p.name, p.department
  from public.complaints c
  join public.profiles p on p.id = c.assigned_officer
  where c.submitted_by = auth.uid();
$$;
revoke all on function public.get_my_complaint_officers() from public, anon;
grant execute on function public.get_my_complaint_officers() to authenticated;
