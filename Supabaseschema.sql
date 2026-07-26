-- ============================================================
-- TREAK — Supabase schema (v3, clean rebuild)
-- Run this WHOLE file in the SQL Editor. It safely wipes any
-- previous version first, so it's safe to run even after the
-- earlier attempts.
-- ============================================================

drop table if exists messages cascade;
drop table if exists chats cascade;
drop table if exists applications cascade;
drop table if exists saved_jobs cascade;
drop table if exists jobs cascade;
drop table if exists profiles cascade;
drop function if exists public.handle_new_user cascade;
drop function if exists public.protect_profile_fields cascade;
drop function if exists public.protect_job_status cascade;
drop function if exists public.is_admin cascade;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('teen','company','admin')),
  name text not null,
  age int,
  city text,
  category text,
  short text,
  color text,
  distance numeric default 1.0,
  verified boolean default false,
  featured boolean default false,
  approved boolean default false,
  created_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references profiles(id) on delete cascade,
  title text not null,
  wage numeric not null,
  age_req int not null,
  type text not null,
  mode text not null check (mode in ('walk','bike','transit')),
  hours text,
  location text,
  description text,
  requirements text[],
  distance numeric,
  buzz int default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  teen_id uuid references profiles(id) on delete cascade,
  company_id uuid references profiles(id) on delete cascade,
  status text not null default 'applied' check (status in ('applied','accepted','rejected')),
  created_at timestamptz default now(),
  unique (job_id, teen_id)
);

create table chats (
  id uuid primary key default gen_random_uuid(),
  teen_id uuid references profiles(id) on delete cascade,
  company_id uuid references profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  created_at timestamptz default now(),
  unique (teen_id, company_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete cascade,
  sender_id uuid references profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz default now()
);

create table saved_jobs (
  teen_id uuid references profiles(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  primary key (teen_id, job_id)
);

-- Auto-create a profile row the moment someone signs up.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, name, age, city, category, short, color, distance, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role','teen'),
    coalesce(new.raw_user_meta_data->>'name','New User'),
    nullif(new.raw_user_meta_data->>'age','')::int,
    new.raw_user_meta_data->>'city',
    new.raw_user_meta_data->>'category',
    new.raw_user_meta_data->>'short',
    coalesce(new.raw_user_meta_data->>'color', 'linear-gradient(135deg,#4F46E5,#7C3AED)'),
    coalesce(nullif(new.raw_user_meta_data->>'distance','')::numeric, 1.0),
    coalesce(new.raw_user_meta_data->>'role','teen') = 'teen'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Prevents a non-admin from editing fields they shouldn't touch on their own row.
create or replace function public.protect_profile_fields()
returns trigger as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
    new.approved := old.approved;
    new.verified := old.verified;
    new.role := old.role;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger protect_profile_fields_trigger
  before update on profiles
  for each row execute procedure public.protect_profile_fields();

create or replace function public.protect_job_status()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    new.status := 'pending';
  elsif TG_OP = 'UPDATE' then
    if not exists (select 1 from profiles where id = auth.uid() and role = 'admin') then
      new.status := old.status;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger protect_job_status_trigger
  before insert or update on jobs
  for each row execute procedure public.protect_job_status();

-- ============================================================
-- is_admin() — a SECURITY DEFINER helper that checks admin status
-- WITHOUT triggering profiles' own RLS policies again. This is
-- what fixes the "infinite recursion" error: policies call this
-- function instead of querying profiles directly from within a
-- policy defined on profiles itself.
-- ============================================================
create or replace function public.is_admin()
returns boolean as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table chats enable row level security;
alter table messages enable row level security;
alter table saved_jobs enable row level security;

create policy "public can view approved companies" on profiles
  for select using (role = 'company' and approved = true);
create policy "users can view own profile" on profiles
  for select using (auth.uid() = id);
create policy "admins view all profiles" on profiles
  for select using (public.is_admin());
create policy "users can update own profile" on profiles
  for update using (auth.uid() = id);

create policy "public can view live jobs" on jobs
  for select using (status = 'approved' and company_id in (select id from profiles where approved = true));
create policy "companies view own jobs" on jobs
  for select using (auth.uid() = company_id);
create policy "admins view all jobs" on jobs
  for select using (public.is_admin());
create policy "companies insert own jobs" on jobs
  for insert with check (auth.uid() = company_id);
create policy "companies and admins update jobs" on jobs
  for update using (auth.uid() = company_id or public.is_admin());

create policy "teens view own applications" on applications
  for select using (auth.uid() = teen_id);
create policy "companies view applications to their jobs" on applications
  for select using (auth.uid() = company_id);
create policy "teens create applications" on applications
  for insert with check (auth.uid() = teen_id);
create policy "companies update application status" on applications
  for update using (auth.uid() = company_id);

create policy "participants view own chats" on chats
  for select using (auth.uid() = teen_id or auth.uid() = company_id);
create policy "participants create chats" on chats
  for insert with check (auth.uid() = teen_id or auth.uid() = company_id);

create policy "participants view own messages" on messages
  for select using (chat_id in (select id from chats where auth.uid() = teen_id or auth.uid() = company_id));
create policy "participants send messages" on messages
  for insert with check (
    auth.uid() = sender_id
    and chat_id in (select id from chats where auth.uid() = teen_id or auth.uid() = company_id)
  );

create policy "teens manage own saved jobs" on saved_jobs
  for all using (auth.uid() = teen_id) with check (auth.uid() = teen_id);

alter publication supabase_realtime add table messages;