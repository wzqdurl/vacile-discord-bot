create table if not exists server_memories (
  guild_id text primary key,
  summary text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists user_memories (
  guild_id text not null,
  user_id text not null,
  summary text not null default '',
  personality text not null default 'vacile',
  recent_messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create table if not exists provider_daily_usage (
  provider text not null,
  usage_date date not null,
  units numeric not null default 0,
  primary key (provider, usage_date)
);

-- Atomically reserves budget before a request so simultaneous Discord messages
-- cannot push the bot beyond its self-imposed daily provider budget.
create or replace function reserve_provider_budget(
  provider_name text,
  requested_units numeric,
  daily_limit numeric
)
returns boolean
language plpgsql
as $$
declare
  reserved boolean;
begin
  insert into provider_daily_usage (provider, usage_date, units)
  values (provider_name, current_date, requested_units)
  on conflict (provider, usage_date) do update
    set units = provider_daily_usage.units + excluded.units
    where provider_daily_usage.units + excluded.units <= daily_limit
  returning true into reserved;

  return coalesce(reserved, false);
end;
$$;
