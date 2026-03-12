create table if not exists public.applied_announcements (
  profile_key text not null,
  announcement_id text not null,
  announcement_title text not null default '',
  source text not null default '',
  detail_url text not null default '',
  origin_url text not null default '',
  category text not null default '',
  region text not null default '',
  managing_org text not null default '',
  executing_org text not null default '',
  apply_period_text text not null default '',
  apply_target text not null default '',
  apply_start text not null default '',
  apply_end text not null default '',
  summary text not null default '',
  search_text text not null default '',
  posted_at text not null default '',
  is_ongoing boolean not null default false,
  workflow_status text not null default 'pending',
  updated_at timestamptz not null default now(),
  primary key (profile_key, announcement_id),
  constraint applied_announcements_workflow_status_check
    check (workflow_status in ('pending', 'completed'))
);

alter table public.applied_announcements add column if not exists origin_url text not null default '';
alter table public.applied_announcements add column if not exists category text not null default '';
alter table public.applied_announcements add column if not exists region text not null default '';
alter table public.applied_announcements add column if not exists managing_org text not null default '';
alter table public.applied_announcements add column if not exists executing_org text not null default '';
alter table public.applied_announcements add column if not exists apply_period_text text not null default '';
alter table public.applied_announcements add column if not exists apply_target text not null default '';
alter table public.applied_announcements add column if not exists apply_start text not null default '';
alter table public.applied_announcements add column if not exists apply_end text not null default '';
alter table public.applied_announcements add column if not exists summary text not null default '';
alter table public.applied_announcements add column if not exists search_text text not null default '';
alter table public.applied_announcements add column if not exists posted_at text not null default '';
alter table public.applied_announcements add column if not exists is_ongoing boolean not null default false;
alter table public.applied_announcements add column if not exists workflow_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'applied_announcements_workflow_status_check'
  ) then
    alter table public.applied_announcements
      add constraint applied_announcements_workflow_status_check
      check (workflow_status in ('pending', 'completed'));
  end if;
end $$;

update public.applied_announcements
set workflow_status = 'completed'
where workflow_status is null
   or workflow_status not in ('pending', 'completed');

alter table public.applied_announcements enable row level security;

drop policy if exists "public read applied announcements" on public.applied_announcements;
drop policy if exists "public write applied announcements" on public.applied_announcements;
drop policy if exists "public update applied announcements" on public.applied_announcements;
drop policy if exists "public delete applied announcements" on public.applied_announcements;

create policy "public read applied announcements"
on public.applied_announcements
for select
using (true);

create policy "public write applied announcements"
on public.applied_announcements
for insert
with check (true);

create policy "public update applied announcements"
on public.applied_announcements
for update
using (true)
with check (true);

create policy "public delete applied announcements"
on public.applied_announcements
for delete
using (true);

create table if not exists public.support_announcements (
  id text primary key,
  source_key text not null default '',
  source text not null default '',
  source_id text not null default '',
  title text not null default '',
  summary text not null default '',
  category text not null default '',
  region text not null default '',
  managing_org text not null default '',
  executing_org text not null default '',
  supervising_institution_type text not null default '',
  application_method text not null default '',
  application_site text not null default '',
  application_url text not null default '',
  detail_url text not null default '',
  origin_url text not null default '',
  contact text not null default '',
  apply_target text not null default '',
  apply_age text not null default '',
  experience text not null default '',
  preferred text not null default '',
  applicant_exclusion text not null default '',
  posted_at text not null default '',
  apply_start text not null default '',
  apply_end text not null default '',
  apply_period_text text not null default '',
  search_text text not null default '',
  first_seen_at text not null default '',
  last_seen_at text not null default '',
  tags jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  sync_token text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.support_state (
  state_key text primary key,
  state_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.support_announcements add column if not exists source_key text not null default '';
alter table public.support_announcements add column if not exists source text not null default '';
alter table public.support_announcements add column if not exists source_id text not null default '';
alter table public.support_announcements add column if not exists title text not null default '';
alter table public.support_announcements add column if not exists summary text not null default '';
alter table public.support_announcements add column if not exists category text not null default '';
alter table public.support_announcements add column if not exists region text not null default '';
alter table public.support_announcements add column if not exists managing_org text not null default '';
alter table public.support_announcements add column if not exists executing_org text not null default '';
alter table public.support_announcements add column if not exists supervising_institution_type text not null default '';
alter table public.support_announcements add column if not exists application_method text not null default '';
alter table public.support_announcements add column if not exists application_site text not null default '';
alter table public.support_announcements add column if not exists application_url text not null default '';
alter table public.support_announcements add column if not exists detail_url text not null default '';
alter table public.support_announcements add column if not exists origin_url text not null default '';
alter table public.support_announcements add column if not exists contact text not null default '';
alter table public.support_announcements add column if not exists apply_target text not null default '';
alter table public.support_announcements add column if not exists apply_age text not null default '';
alter table public.support_announcements add column if not exists experience text not null default '';
alter table public.support_announcements add column if not exists preferred text not null default '';
alter table public.support_announcements add column if not exists applicant_exclusion text not null default '';
alter table public.support_announcements add column if not exists posted_at text not null default '';
alter table public.support_announcements add column if not exists apply_start text not null default '';
alter table public.support_announcements add column if not exists apply_end text not null default '';
alter table public.support_announcements add column if not exists apply_period_text text not null default '';
alter table public.support_announcements add column if not exists search_text text not null default '';
alter table public.support_announcements add column if not exists first_seen_at text not null default '';
alter table public.support_announcements add column if not exists last_seen_at text not null default '';
alter table public.support_announcements add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.support_announcements add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.support_announcements add column if not exists sync_token text not null default '';
alter table public.support_announcements add column if not exists updated_at timestamptz not null default now();

alter table public.support_state add column if not exists state_value jsonb not null default '{}'::jsonb;
alter table public.support_state add column if not exists updated_at timestamptz not null default now();

create index if not exists support_announcements_sync_token_idx on public.support_announcements (sync_token);
create index if not exists support_announcements_updated_at_idx on public.support_announcements (updated_at desc);

alter table public.support_announcements enable row level security;
alter table public.support_state enable row level security;

drop policy if exists "public read support announcements" on public.support_announcements;
drop policy if exists "public write support announcements" on public.support_announcements;
drop policy if exists "public update support announcements" on public.support_announcements;
drop policy if exists "public delete support announcements" on public.support_announcements;
drop policy if exists "public read support state" on public.support_state;
drop policy if exists "public write support state" on public.support_state;
drop policy if exists "public update support state" on public.support_state;
drop policy if exists "public delete support state" on public.support_state;

create policy "public read support announcements"
on public.support_announcements
for select
using (true);

create policy "public write support announcements"
on public.support_announcements
for insert
with check (true);

create policy "public update support announcements"
on public.support_announcements
for update
using (true)
with check (true);

create policy "public delete support announcements"
on public.support_announcements
for delete
using (true);

create policy "public read support state"
on public.support_state
for select
using (true);

create policy "public write support state"
on public.support_state
for insert
with check (true);

create policy "public update support state"
on public.support_state
for update
using (true)
with check (true);

create policy "public delete support state"
on public.support_state
for delete
using (true);
