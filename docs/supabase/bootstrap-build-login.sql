-- Run manually with psql against the remote database after reviewing the
-- resolved target. The password must arrive through psql variable
-- build_password; never replace the placeholder with a committed secret.

\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'il_figlio_build_login'
  ) then
    raise exception 'il_figlio_build_login already exists; rotate it explicitly instead';
  end if;
end;
$$;

create role il_figlio_build_login
  login
  inherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  password :'build_password';

grant menu_build to il_figlio_build_login;

alter role il_figlio_build_login set statement_timeout = '15s';
alter role il_figlio_build_login set lock_timeout = '5s';
alter role il_figlio_build_login set default_transaction_read_only = on;

commit;
