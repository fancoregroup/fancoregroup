-- Fancore ATS · esquema do banco (Neon Postgres, recurso fancore-ats)
-- Idempotente: pode rodar de novo sem perder dados. Aplicar com
-- node 05-dashboard/recrutamento/migrar.mjs <arquivo .env com ATS_DATABASE_URL>

create extension if not exists pgcrypto;

create table if not exists ats_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin','recrutador','socio','gestor')),
  title text,
  password_hash text not null,
  must_change_password boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists ats_sessions (
  token_hash text primary key,
  user_id uuid not null references ats_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists ats_sessions_user on ats_sessions(user_id);

create table if not exists ats_jobs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  company text not null default 'Fancore',
  area text,
  contract text not null default 'CLT' check (contract in ('CLT','PJ','Estágio','Temporário','Freelancer')),
  workplace text not null default 'Presencial' check (workplace in ('Presencial','Híbrido','Remoto')),
  location text not null default 'Londrina/PR',
  headcount int not null default 1 check (headcount between 1 and 50),
  salary_range text,
  summary text,
  description text,
  requirements text,
  benefits text,
  questions jsonb not null default '[]'::jsonb,
  criteria jsonb not null default '[]'::jsonb,
  status text not null default 'rascunho' check (status in ('rascunho','aguardando_aprovacao','aberta','pausada','fechada','cancelada')),
  public boolean not null default true,
  owner_id uuid references ats_users(id),
  approved_by uuid references ats_users(id),
  approved_at timestamptz,
  target_date date,
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid references ats_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ats_job_members (
  job_id uuid not null references ats_jobs(id) on delete cascade,
  user_id uuid not null references ats_users(id) on delete cascade,
  primary key (job_id, user_id)
);

create table if not exists ats_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  city text,
  linkedin text,
  portfolio text,
  instagram text,
  tags text[] not null default '{}',
  cv_path text,
  cv_name text,
  consent_at timestamptz,
  consent_version text,
  retention_until date,
  anonymized_at timestamptz,
  created_by uuid references ats_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ats_candidates_email on ats_candidates(lower(email)) where email is not null;

create table if not exists ats_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references ats_jobs(id) on delete cascade,
  candidate_id uuid not null references ats_candidates(id) on delete cascade,
  stage text not null default 'triagem' check (stage in ('triagem','entrevista_rh','teste','entrevista_gestor','aprovacao','proposta','contratado')),
  status text not null default 'ativo' check (status in ('ativo','reprovado','desistiu','contratado')),
  source text not null default 'outro' check (source in ('carreiras','instagram','indicacao','linkedin','banco','outro')),
  referral text,
  answers jsonb not null default '[]'::jsonb,
  message text,
  rejection_reason text,
  stage_changed_at timestamptz not null default now(),
  hired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);
create index if not exists ats_applications_job on ats_applications(job_id);
create index if not exists ats_applications_candidate on ats_applications(candidate_id);

create table if not exists ats_evaluations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ats_applications(id) on delete cascade,
  user_id uuid not null references ats_users(id),
  stage text not null,
  scores jsonb not null default '{}'::jsonb,
  average numeric(3,2),
  recommendation text not null check (recommendation in ('forte_sim','sim','nao','forte_nao')),
  comment text,
  created_at timestamptz not null default now(),
  unique (application_id, user_id, stage)
);

create table if not exists ats_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references ats_applications(id) on delete cascade,
  kind text not null check (kind in ('rh','tecnica','gestor','socios','cultura')),
  scheduled_at timestamptz not null,
  duration_min int not null default 45,
  location text,
  interviewers uuid[] not null default '{}',
  status text not null default 'agendada' check (status in ('agendada','realizada','cancelada','nao_compareceu')),
  notes text,
  created_by uuid references ats_users(id),
  created_at timestamptz not null default now()
);
create index if not exists ats_interviews_when on ats_interviews(scheduled_at);

create table if not exists ats_events (
  id bigserial primary key,
  application_id uuid references ats_applications(id) on delete cascade,
  candidate_id uuid references ats_candidates(id) on delete cascade,
  job_id uuid references ats_jobs(id) on delete cascade,
  user_id uuid references ats_users(id),
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ats_events_application on ats_events(application_id, created_at);
create index if not exists ats_events_candidate on ats_events(candidate_id, created_at);

create table if not exists ats_attempts (
  id bigserial primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists ats_attempts_lookup on ats_attempts(kind, key, created_at);
