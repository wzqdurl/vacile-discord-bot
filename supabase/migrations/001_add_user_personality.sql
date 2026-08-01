alter table user_memories
  add column if not exists personality text not null default 'vacile';
