-- Vishanti Petition schema for a new Supabase project.
-- Apply once in SQL Editor. Do not run on a database containing conflicting tables.
create extension if not exists pgcrypto;
create extension if not exists vector;

do $$ begin create type public.user_role as enum ('STUDENT','OFFICER','ADMIN'); exception when duplicate_object then null; end $$;
do $$ begin create type public.complaint_status as enum ('FILED','ASSIGNED','IN_REVIEW','RESOLVED','ESCALATED'); exception when duplicate_object then null; end $$;
do $$ begin create type public.complaint_priority as enum ('LOW','MEDIUM','HIGH','CRITICAL'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null default 'Student', email text not null,
 role public.user_role not null default 'STUDENT', department text,
 created_at timestamptz not null default now()
);
create table if not exists public.complaints (
 id uuid primary key default gen_random_uuid(),
 tracking_code text not null unique default ('VP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
 submitted_by uuid not null references public.profiles(id),
 title text not null check (length(trim(title)) between 5 and 160),
 description text not null check (length(trim(description)) between 15 and 8000),
 category text not null, priority public.complaint_priority not null default 'MEDIUM',
 status public.complaint_status not null default 'FILED', is_anonymous boolean not null default false,
 assigned_officer uuid references public.profiles(id), created_at timestamptz not null default now(),
 due_at timestamptz not null default (now()+interval '5 days'), resolved_at timestamptz
);
create table if not exists public.assignments (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id),
 officer_id uuid not null references public.profiles(id), assigned_by uuid not null references public.profiles(id),
 assigned_at timestamptz not null default now(), remarks text
);
create table if not exists public.attachments (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id),
 storage_path text not null, file_name text not null, content_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 10485760), uploaded_by uuid not null references public.profiles(id),
 uploaded_at timestamptz not null default now()
);
create table if not exists public.sla_policies (
 id uuid primary key default gen_random_uuid(), priority public.complaint_priority not null unique,
 resolution_hours integer not null check(resolution_hours>0), description text not null default ''
);
create table if not exists public.audit_events (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id),
 actor_id uuid references public.profiles(id), action text not null, event_data jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), previous_hash text, entry_hash text not null
);
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
 complaint_id uuid references public.complaints(id), message text not null, read_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public.escalations (
 id uuid primary key default gen_random_uuid(), complaint_id uuid not null references public.complaints(id),
 reason text not null, triggered_by uuid references public.profiles(id), created_at timestamptz not null default now(), resolved_at timestamptz
);
create table if not exists public.policy_chunks (
 id bigserial primary key, document_name text not null, source_page integer, chunk_text text not null,
 embedding vector(1536), created_at timestamptz not null default now()
);
create index if not exists complaints_submitter_idx on public.complaints(submitted_by,created_at desc);
create index if not exists complaints_status_due_idx on public.complaints(status,due_at);
create index if not exists complaints_assigned_idx on public.complaints(assigned_officer,status);
create index if not exists assignments_officer_idx on public.assignments(officer_id,assigned_at desc);
create index if not exists audit_events_complaint_idx on public.audit_events(complaint_id,created_at);
create index if not exists notifications_recipient_idx on public.notifications(recipient_id,created_at desc);
create index if not exists policy_chunks_embedding_idx on public.policy_chunks using ivfflat (embedding vector_cosine_ops) with (lists=50);
insert into public.sla_policies(priority,resolution_hours,description) values
 ('LOW',168,'Seven days'),('MEDIUM',120,'Five days'),('HIGH',48,'Two days'),('CRITICAL',24,'One day') on conflict(priority) do nothing;

-- Create a student profile for every new Auth user. Public signup cannot choose a privileged role.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,name,email,role)
 values(new.id,coalesce(nullif(new.raw_user_meta_data->>'full_name',''),'Student'),new.email,'STUDENT')
 on conflict(id) do update set email=excluded.email;
 return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- SECURITY DEFINER helpers avoid recursive profile RLS checks in policies.
create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid() limit 1;
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.current_user_role() in ('OFFICER','ADMIN'),false);
$$;
revoke all on function public.current_user_role() from public,anon;
revoke all on function public.is_staff() from public,anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_staff() to authenticated;

alter table public.profiles enable row level security;
alter table public.complaints enable row level security;
alter table public.assignments enable row level security;
alter table public.attachments enable row level security;
alter table public.sla_policies enable row level security;
alter table public.audit_events enable row level security;
alter table public.notifications enable row level security;
alter table public.escalations enable row level security;
alter table public.policy_chunks enable row level security;

-- Profiles: users can read/update only their own non-role fields; staff can read profiles for assignment.
drop policy if exists "profile self read" on public.profiles;
create policy "profile self read" on public.profiles for select to authenticated using (id=auth.uid() or public.is_staff());
drop policy if exists "profile self update" on public.profiles;
create policy "profile self update" on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role=public.current_user_role());
-- Complaints: students see their own; staff see the authorized work queue. Role checks are server-side RLS.
drop policy if exists "complaint read permitted" on public.complaints;
create policy "complaint read permitted" on public.complaints for select to authenticated using(submitted_by=auth.uid() or public.is_staff());
drop policy if exists "student create complaint" on public.complaints;
create policy "student create complaint" on public.complaints for insert to authenticated with check(submitted_by=auth.uid() and status='FILED' and assigned_officer is null);
-- Direct updates are intentionally disallowed. Status transitions use the trusted RPC below.
drop policy if exists "complaint update none direct" on public.complaints;
create policy "complaint update none direct" on public.complaints for update to authenticated using(false) with check(false);
-- Assignments visible to staff and submitter of related complaint; writes are done through trusted RPC in future extension.
drop policy if exists "assignment read permitted" on public.assignments;
create policy "assignment read permitted" on public.assignments for select to authenticated using(public.is_staff() or exists(select 1 from public.complaints c where c.id=complaint_id and c.submitted_by=auth.uid()));
drop policy if exists "attachments read permitted" on public.attachments;
create policy "attachments read permitted" on public.attachments for select to authenticated using(exists(select 1 from public.complaints c where c.id=complaint_id and (c.submitted_by=auth.uid() or public.is_staff())));
drop policy if exists "attachments insert own complaint" on public.attachments;
create policy "attachments insert own complaint" on public.attachments for insert to authenticated with check(uploaded_by=auth.uid() and exists(select 1 from public.complaints c where c.id=complaint_id and c.submitted_by=auth.uid()));
drop policy if exists "sla read authenticated" on public.sla_policies;
create policy "sla read authenticated" on public.sla_policies for select to authenticated using(true);
drop policy if exists "audit read permitted" on public.audit_events;
create policy "audit read permitted" on public.audit_events for select to authenticated using(exists(select 1 from public.complaints c where c.id=complaint_id and (c.submitted_by=auth.uid() or public.is_staff())));
drop policy if exists "notifications own read" on public.notifications;
create policy "notifications own read" on public.notifications for select to authenticated using(recipient_id=auth.uid());
drop policy if exists "notifications own update" on public.notifications;
create policy "notifications own update" on public.notifications for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
drop policy if exists "escalations staff read" on public.escalations;
create policy "escalations staff read" on public.escalations for select to authenticated using(public.is_staff() or exists(select 1 from public.complaints c where c.id=complaint_id and c.submitted_by=auth.uid()));
drop policy if exists "policy chunks no client access" on public.policy_chunks;
create policy "policy chunks no client access" on public.policy_chunks for select to authenticated using(false);

-- Canonical JSON SHA-256 audit event. This helper is only callable from trusted functions.
create or replace function public.sha256_hex(input text) returns text language sql immutable as $$ select encode(digest(convert_to(input,'UTF8'),'sha256'),'hex'); $$;
revoke all on function public.sha256_hex(text) from public, anon, authenticated;

-- Atomic status transition and audit append. Role and transition are validated inside PostgreSQL.
create or replace function public.transition_complaint(p_complaint_id uuid,p_new_status public.complaint_status,p_note text default '')
returns public.complaints language plpgsql security definer set search_path=public as $$
declare actor public.profiles; c public.complaints; prev text; ev jsonb; h text; allowed boolean:=false;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or actor.role not in ('OFFICER','ADMIN') then raise exception 'Only authorized staff can change status'; end if;
 select * into c from public.complaints where id=p_complaint_id for update;
 if c.id is null then raise exception 'Complaint not found'; end if;
 if c.status=p_new_status then return c; end if;
 if c.status='FILED' and p_new_status in ('ASSIGNED','ESCALATED') then allowed:=true; end if;
 if c.status='ASSIGNED' and p_new_status in ('IN_REVIEW','ESCALATED') then allowed:=true; end if;
 if c.status='IN_REVIEW' and p_new_status in ('RESOLVED','ESCALATED') then allowed:=true; end if;
 if c.status='ESCALATED' and p_new_status in ('ASSIGNED','IN_REVIEW','RESOLVED') then allowed:=true; end if;
 if not allowed then raise exception 'Invalid status transition: % to %',c.status,p_new_status; end if;
 select entry_hash into prev from public.audit_events where complaint_id=c.id order by created_at desc,id desc limit 1;
 ev:=jsonb_build_object('complaint_id',c.id,'actor_id',actor.id,'action','STATUS_CHANGED','from',c.status,'to',p_new_status,'note',left(coalesce(p_note,''),1000),'at',clock_timestamp());
 h:=public.sha256_hex(coalesce(prev,'GENESIS') || ev::text);
 update public.complaints set status=p_new_status,resolved_at=case when p_new_status='RESOLVED' then now() else null end where id=c.id returning * into c;
 insert into public.audit_events(complaint_id,actor_id,action,event_data,previous_hash,entry_hash) values(c.id,actor.id,'STATUS_CHANGED',ev,prev,h);
 insert into public.notifications(recipient_id,complaint_id,message) values(c.submitted_by,c.id,'Your petition '||c.tracking_code||' is now '||p_new_status::text);
 return c;
end; $$;
revoke all on function public.transition_complaint(uuid,public.complaint_status,text) from public, anon;
grant execute on function public.transition_complaint(uuid,public.complaint_status,text) to authenticated;

-- Assignment function: only staff can assign to a profile that is an officer/admin.
create or replace function public.assign_complaint(p_complaint_id uuid,p_officer_id uuid,p_remarks text default '') returns public.complaints language plpgsql security definer set search_path=public as $$
declare actor public.profiles; target public.profiles; c public.complaints; prev text; ev jsonb; h text;
begin
 select * into actor from public.profiles where id=auth.uid(); if actor.id is null or actor.role not in ('OFFICER','ADMIN') then raise exception 'Only authorized staff can assign'; end if;
 select * into target from public.profiles where id=p_officer_id and role in ('OFFICER','ADMIN'); if target.id is null then raise exception 'Target must be an authorized officer'; end if;
 select * into c from public.complaints where id=p_complaint_id for update; if c.id is null then raise exception 'Complaint not found'; end if;
 if c.status not in ('FILED','ESCALATED','ASSIGNED') then raise exception 'Complaint cannot be assigned in this status'; end if;
 update public.complaints set assigned_officer=p_officer_id,status='ASSIGNED' where id=c.id returning * into c;
 insert into public.assignments(complaint_id,officer_id,assigned_by,remarks) values(c.id,p_officer_id,actor.id,left(coalesce(p_remarks,''),1000));
 select entry_hash into prev from public.audit_events where complaint_id=c.id order by created_at desc,id desc limit 1;
 ev:=jsonb_build_object('complaint_id',c.id,'actor_id',actor.id,'action','ASSIGNED','officer_id',p_officer_id,'at',clock_timestamp()); h:=public.sha256_hex(coalesce(prev,'GENESIS')||ev::text);
 insert into public.audit_events(complaint_id,actor_id,action,event_data,previous_hash,entry_hash) values(c.id,actor.id,'ASSIGNED',ev,prev,h);
 insert into public.notifications(recipient_id,complaint_id,message) values(p_officer_id,c.id,'A petition has been assigned to you: '||c.tracking_code),(c.submitted_by,c.id,'Your petition has been assigned for follow-up.');
 return c;
end; $$;
revoke all on function public.assign_complaint(uuid,uuid,text) from public,anon;
grant execute on function public.assign_complaint(uuid,uuid,text) to authenticated;

-- Verification checks previous-hash links and event hashes. Uses stored event_data canonical text.
create or replace function public.verify_audit_chain(p_complaint_id uuid) returns table(event_id uuid,valid boolean,detail text) language plpgsql security definer set search_path=public as $$
declare r record; expected_prev text:=null; expected_hash text;
begin
 if not exists(select 1 from public.complaints c where c.id=p_complaint_id and (c.submitted_by=auth.uid() or public.is_staff())) then raise exception 'Not authorized'; end if;
 for r in select * from public.audit_events where complaint_id=p_complaint_id order by created_at,id loop
  expected_hash:=public.sha256_hex(coalesce(expected_prev,'GENESIS')||r.event_data::text);
  event_id:=r.id; valid:=(r.previous_hash is not distinct from expected_prev and r.entry_hash=expected_hash); detail:=case when valid then 'OK' else 'Hash or chain link mismatch' end; return next;
  expected_prev:=r.entry_hash;
 end loop;
end; $$;
revoke all on function public.verify_audit_chain(uuid) from public,anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated;
