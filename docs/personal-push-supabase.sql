-- ai-phone-personal-push-schema-v1
-- 由小手机一键部署到用户自己的 Supabase；__PROJECT_REF__ 会在部署时替换。

-- 硬保险：只允许空项目、旧版个人云项目或已由本应用标记的专用项目。
-- 不依赖作者站点的某张业务表，因此自部署站点也能得到同样保护。
do $$
declare
  has_marker boolean := to_regclass('public.ai_phone_cloud_meta') is not null;
  has_unknown_public_table boolean;
begin
  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname <> all (array[
        'ai_phone_cloud_meta',
        'push_server_config', 'push_subscriptions', 'push_jobs', 'push_outbox',
        'push_shortcut_commands', 'push_bridge_config', 'push_bridge_snapshots',
        'push_screen_sessions', 'push_screen_threads'
      ])
  ) into has_unknown_public_table;

  if not has_marker and has_unknown_public_table then
    raise exception 'AI_PHONE_GUARD: 目标项目已包含其他业务表，拒绝部署个人云服务，请使用新建的专用项目';
  end if;
end $$;

create table if not exists public.ai_phone_cloud_meta (
  id text primary key,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.ai_phone_cloud_meta (id, schema_version, updated_at)
values ('personal-cloud', 3, now())
on conflict (id) do update set schema_version = excluded.schema_version, updated_at = excluded.updated_at;

create table if not exists public.push_server_config (
  id text primary key,
  vapid_public_key text not null,
  vapid_private_key text not null,
  cron_secret text,
  payload_key text,
  site_origin text,
  created_at timestamptz not null default now()
);
alter table public.push_server_config add column if not exists cron_secret text;
alter table public.push_server_config add column if not exists payload_key text;
alter table public.push_server_config add column if not exists site_origin text;

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  fail_count integer not null default 0,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.push_jobs (
  id text primary key,
  user_id text not null,
  trigger_key text not null,
  kind text not null,
  execute_at timestamptz not null,
  status text not null default 'pending',
  payload jsonb not null,
  result_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_jobs_status_check check (status in ('pending', 'running', 'done', 'cancelled', 'failed'))
);
alter table public.push_jobs drop constraint if exists push_jobs_kind_check;
alter table public.push_jobs add constraint push_jobs_kind_check
  check (kind in ('followup', 'reply_bailout', 'timed_task', 'bridge_scan', 'shortcut_resume'));
create unique index if not exists push_jobs_trigger_idx on public.push_jobs (user_id, trigger_key);
create index if not exists push_jobs_due_idx on public.push_jobs (status, execute_at);

create table if not exists public.push_outbox (
  id text primary key,
  user_id text not null,
  job_id text,
  session_id text,
  trigger_key text,
  raw_text text not null,
  meta jsonb,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);
create index if not exists push_outbox_user_idx
  on public.push_outbox (user_id, consumed_at, created_at);

alter table public.push_server_config enable row level security;
alter table public.ai_phone_cloud_meta enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_jobs enable row level security;
alter table public.push_outbox enable row level security;


-- 2026 年起新项目不会自动把 public 新表暴露给 Data API。
-- 网关和生成器只以 service_role 访问，绝不授予 anon 或 authenticated。
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.push_server_config,
  public.ai_phone_cloud_meta,
  public.push_subscriptions,
  public.push_jobs,
  public.push_outbox
to service_role;


create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'ai-phone-personal-push-jobs-scan';

-- 每分钟扫描一次到期任务。任务到点后最晚 60 秒被派发，对离线兜底推送足够；
-- 相比 10 秒一扫，cron.job_run_details 日志量降到 1/6，数据库更省。
-- 仅调度正常 Chat 离线消息生成任务。
select cron.schedule('ai-phone-personal-push-jobs-scan', '* * * * *', $CRON$
  update public.push_jobs
     set status = 'pending', updated_at = now()
   where status = 'running' and updated_at < now() - interval '20 minutes';

  select net.http_post(
    url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/push-generate',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'jobId', j.id,
      'token', (select cron_secret from public.push_server_config where id = 'main')
    ),
    timeout_milliseconds := 5000
  )
  from (
    select id
      from public.push_jobs
     where status = 'pending' and execute_at <= now() and kind in ('followup', 'reply_bailout', 'timed_task')
     order by execute_at asc
     limit 10
  ) j;

$CRON$);

-- pg_cron 运行日志清理：只保留最近 3 天，防止 cron.job_run_details 无限增长。
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'ai-phone-personal-push-cron-cleanup';

select cron.schedule('ai-phone-personal-push-cron-cleanup', '0 3 * * *', $CRON$
  delete from cron.job_run_details where end_time < now() - interval '3 days';
$CRON$);
