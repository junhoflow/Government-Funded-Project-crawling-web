create table if not exists public.applied_announcements (
  profile_key text not null,
  announcement_id text not null,
  announcement_title text not null default '',
  source text not null default '',
  detail_url text not null default '',
  applied boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_key, announcement_id)
);

alter table public.applied_announcements enable row level security;

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
