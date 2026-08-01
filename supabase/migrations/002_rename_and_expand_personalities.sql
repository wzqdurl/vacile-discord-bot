update user_memories
set personality = 'neutro'
where personality = 'vacile';

update user_memories
set personality = 'rude'
where personality = 'caotico';

alter table user_memories
  alter column personality set default 'neutro';
