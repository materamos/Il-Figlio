-- Il Figlio initial menu backend.
--
-- This migration is canonical for a new Supabase project. It creates the
-- fixed editorial model, the narrow public runtime contract, the single-user
-- allowlist and the publication ledger, then loads the confirmed August 2026
-- menu. It intentionally does not create an Auth user or a remote deployment.

begin;

create schema if not exists menu_content;
create schema if not exists app_private;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles role
    where role.rolname = 'menu_build'
  ) then
    create role menu_build
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 3;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles role
    where role.rolname = 'menu_build'
      and (
        role.rolsuper
        or role.rolinherit
        or role.rolcreaterole
        or role.rolcreatedb
        or role.rolcanlogin
        or role.rolreplication
        or role.rolbypassrls
        or role.rolconnlimit <> 3
      )
  ) then
    raise exception 'menu_build has unexpected role capabilities';
  end if;
end;
$$;

revoke all privileges on database postgres from menu_build;
grant connect on database postgres to menu_build;

comment on schema menu_content is
  'Private build-time menu content. Browser roles have no direct access.';
comment on schema app_private is
  'Private authorization, revision and publication state.';

revoke all on schema menu_content from public, anon, authenticated, menu_build;
revoke all on schema app_private from public, anon, authenticated, menu_build;
revoke all on schema public from menu_build;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema public to menu_build;
revoke create on schema public from public, anon, authenticated;

alter default privileges in schema menu_content
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema menu_content
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema app_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app_private
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create type menu_content.menu_price_kind as enum (
  'whole',
  'slice',
  'unit',
  'portion'
);

create type public.business_order_status as enum (
  'accepting_orders',
  'paused',
  'sold_out',
  'closed'
);

create type app_private.menu_publish_status as enum (
  'queued',
  'succeeded',
  'failed'
);

create table menu_content.menu_categories (
  code text primary key,
  title text not null,
  order_index smallint not null unique,
  allowed_price_kinds menu_content.menu_price_kind[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menu_categories_code_fixed check (
    code in ('classic', 'filled', 'gourmet', 'empanadas', 'extras')
  ),
  constraint menu_categories_title_valid check (
    length(btrim(title)) between 1 and 60
  ),
  constraint menu_categories_order_positive check (order_index > 0),
  constraint menu_categories_pricing_model_fixed check (
    (code = 'classic' and allowed_price_kinds = array['whole', 'slice']::menu_content.menu_price_kind[])
    or (code = 'filled' and allowed_price_kinds = array['whole']::menu_content.menu_price_kind[])
    or (code = 'gourmet' and allowed_price_kinds = array['whole']::menu_content.menu_price_kind[])
    or (code = 'empanadas' and allowed_price_kinds = array['unit']::menu_content.menu_price_kind[])
    or (code = 'extras' and allowed_price_kinds = array['portion']::menu_content.menu_price_kind[])
  )
);

create table menu_content.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_code text not null references menu_content.menu_categories(code)
    on update restrict on delete restrict,
  name text not null,
  description text,
  order_index integer not null,
  version bigint not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint menu_items_name_valid check (
    length(btrim(name)) between 1 and 80 and name = btrim(name)
  ),
  constraint menu_items_description_valid check (
    description is null
    or (length(btrim(description)) between 1 and 320 and description = btrim(description))
  ),
  constraint menu_items_order_nonnegative check (order_index >= 0),
  constraint menu_items_version_positive check (version > 0),
  unique (category_code, order_index)
);

create unique index menu_items_category_name_unique
  on menu_content.menu_items (category_code, lower(name));
create index menu_items_active_order_idx
  on menu_content.menu_items (category_code, order_index, id)
  where archived_at is null;
create index menu_items_archived_at_idx
  on menu_content.menu_items (archived_at desc, id)
  where archived_at is not null;

create table menu_content.menu_item_prices (
  item_id uuid not null references menu_content.menu_items(id)
    on update cascade on delete cascade,
  price_kind menu_content.menu_price_kind not null,
  amount integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (item_id, price_kind),
  constraint menu_item_prices_amount_valid check (
    amount > 0 and amount <= 10000000
  )
);

create table public.menu_availability (
  item_id uuid primary key references menu_content.menu_items(id)
    on update cascade on delete cascade,
  available boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index menu_availability_updated_at_idx
  on public.menu_availability (updated_at desc, item_id);

create table public.business_runtime_state (
  singleton boolean primary key default true,
  status public.business_order_status not null default 'closed',
  message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint business_runtime_state_singleton check (singleton),
  constraint business_runtime_state_message_valid check (
    message is null
    or (length(btrim(message)) between 1 and 160 and message = btrim(message))
  )
);

create table app_private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index admin_users_single_active_idx
  on app_private.admin_users ((active))
  where active;

create table app_private.menu_content_state (
  singleton boolean primary key default true,
  current_revision bigint not null default 0,
  last_publish_requested_revision bigint not null default 0,
  last_publish_requested_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint menu_content_state_singleton check (singleton),
  constraint menu_content_state_revision_valid check (
    current_revision >= 0
    and last_publish_requested_revision >= 0
    and last_publish_requested_revision <= current_revision
  )
);

create table app_private.menu_publish_requests (
  id bigint generated by default as identity primary key,
  requested_by uuid references auth.users(id) on delete set null,
  content_revision bigint not null,
  status app_private.menu_publish_status not null default 'queued',
  message text not null,
  hook_status_code integer,
  hook_job_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint menu_publish_requests_revision_positive check (content_revision > 0),
  constraint menu_publish_requests_message_valid check (
    length(btrim(message)) between 1 and 120 and message = btrim(message)
  ),
  constraint menu_publish_requests_hook_status_code_valid check (
    hook_status_code is null
    or hook_status_code between 100 and 599
  ),
  constraint menu_publish_requests_hook_job_id_valid check (
    hook_job_id is null
    or (length(btrim(hook_job_id)) between 1 and 160 and hook_job_id = btrim(hook_job_id))
  ),
  constraint menu_publish_requests_completion_valid check (
    (status = 'queued' and completed_at is null)
    or (status in ('succeeded', 'failed') and completed_at is not null)
  )
);

create index menu_publish_requests_recent_idx
  on app_private.menu_publish_requests (created_at desc, id desc);
create index menu_publish_requests_revision_idx
  on app_private.menu_publish_requests (content_revision, created_at desc, id desc);
create unique index menu_publish_requests_one_queued_revision_idx
  on app_private.menu_publish_requests (content_revision)
  where status = 'queued';

insert into app_private.menu_content_state (singleton)
values (true);

insert into public.business_runtime_state (singleton, status, message)
values (true, 'closed', null);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.bump_menu_content_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if current_setting('il_figlio.content_revision_bumped', true) is distinct from 'on' then
    perform set_config('il_figlio.content_revision_bumped', 'on', true);

    update app_private.menu_content_state
    set
      current_revision = current_revision + 1,
      updated_at = now()
    where singleton;
  end if;

  return null;
end;
$$;

create or replace function app_private.validate_menu_item_price_kind()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  allowed_kinds menu_content.menu_price_kind[];
begin
  select category.allowed_price_kinds
  into allowed_kinds
  from menu_content.menu_items item
  join menu_content.menu_categories category
    on category.code = item.category_code
  where item.id = new.item_id;

  if allowed_kinds is null or not (new.price_kind = any(allowed_kinds)) then
    raise exception using
      errcode = '23514',
      message = 'price_kind_not_allowed_for_category';
  end if;

  return new;
end;
$$;

create trigger menu_categories_set_updated_at
before update on menu_content.menu_categories
for each row execute function app_private.set_updated_at();

create trigger menu_items_set_updated_at
before update on menu_content.menu_items
for each row execute function app_private.set_updated_at();

create trigger menu_item_prices_set_updated_at
before update on menu_content.menu_item_prices
for each row execute function app_private.set_updated_at();

create trigger admin_users_set_updated_at
before update on app_private.admin_users
for each row execute function app_private.set_updated_at();

create trigger menu_publish_requests_set_updated_at
before update on app_private.menu_publish_requests
for each row execute function app_private.set_updated_at();

create trigger menu_item_prices_validate_kind
before insert or update on menu_content.menu_item_prices
for each row execute function app_private.validate_menu_item_price_kind();

create trigger menu_categories_bump_revision
after insert or update or delete on menu_content.menu_categories
for each row execute function app_private.bump_menu_content_revision();

create trigger menu_items_bump_revision
after insert or update or delete on menu_content.menu_items
for each row execute function app_private.bump_menu_content_revision();

create trigger menu_item_prices_bump_revision
after insert or update or delete on menu_content.menu_item_prices
for each row execute function app_private.bump_menu_content_revision();

create or replace function app_private.is_admin_user(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select p_user_id is not null
    and exists (
      select 1
      from app_private.admin_users admin_user
      where admin_user.user_id = p_user_id
        and admin_user.active
    );
$$;

create or replace function app_private.current_menu_revision()
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select state.current_revision
  from app_private.menu_content_state state
  where state.singleton;
$$;

create or replace function app_private.valid_menu_prices(
  p_category_code text,
  p_prices jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  allowed_kinds menu_content.menu_price_kind[];
  price_entry record;
  price_text text;
  price_key_count integer;
begin
  select category.allowed_price_kinds
  into allowed_kinds
  from menu_content.menu_categories category
  where category.code = p_category_code;

  if allowed_kinds is null
    or p_prices is null
    or jsonb_typeof(p_prices) <> 'object'
  then
    return false;
  end if;

  select count(*)::integer
  into price_key_count
  from jsonb_object_keys(p_prices);

  if price_key_count <> cardinality(allowed_kinds) then
    return false;
  end if;

  for price_entry in
    select entry.key, entry.value
    from jsonb_each(p_prices) entry
  loop
    if price_entry.key <> all(allowed_kinds::text[])
      or jsonb_typeof(price_entry.value) <> 'number'
    then
      return false;
    end if;

    price_text := price_entry.value #>> '{}';

    if price_text !~ '^[0-9]+$'
      or price_text::numeric <= 0
      or price_text::numeric > 10000000
    then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from unnest(allowed_kinds) required_kind
    where not (p_prices ? required_kind::text)
  ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function app_private.valid_menu_prices(text, jsonb) is
  'Requires exactly the fixed category price keys with positive integer ARS amounts.';

create or replace function public.can_manage_menu()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select app_private.is_admin_user(auth.uid());
$$;

create or replace function public.can_publish_menu()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select app_private.is_admin_user(auth.uid());
$$;

create or replace function public.get_build_menu_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with category_payload as (
    select
      category.order_index,
      jsonb_build_object(
        'code', category.code,
        'title', category.title,
        'order_index', category.order_index,
        'price_kinds', to_jsonb(category.allowed_price_kinds),
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', item.id,
              'category_code', item.category_code,
              'name', item.name,
              'description', item.description,
              'order_index', item.order_index,
              'version', item.version,
              'prices', coalesce((
                select jsonb_object_agg(
                  price.price_kind::text,
                  price.amount
                  order by price.price_kind::text
                )
                from menu_content.menu_item_prices price
                where price.item_id = item.id
              ), '{}'::jsonb)
            )
            order by item.order_index, item.id
          )
          from menu_content.menu_items item
          where item.category_code = category.code
            and item.archived_at is null
        ), '[]'::jsonb)
      ) as payload
    from menu_content.menu_categories category
  )
  select jsonb_build_object(
    'schema_version', 1,
    'revision', state.current_revision,
    'categories', coalesce((
      select jsonb_agg(category_payload.payload order by category_payload.order_index)
      from category_payload
    ), '[]'::jsonb)
  )
  from app_private.menu_content_state state
  where state.singleton;
$$;

comment on function public.get_build_menu_snapshot() is
  'Service-only, single-statement consistent snapshot of active build-time menu content.';

create or replace function public.get_public_runtime_state()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'business', jsonb_build_object(
      'status', business.status,
      'message', business.message,
      'updated_at', business.updated_at
    ),
    'availability', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'item_id', availability.item_id,
          'available', availability.available,
          'updated_at', availability.updated_at
        )
        order by availability.item_id
      )
      from public.menu_availability availability
    ), '[]'::jsonb)
  )
  from public.business_runtime_state business
  where business.singleton;
$$;

comment on function public.get_public_runtime_state() is
  'Public runtime-only state. Includes archived items so an older static deploy sees them as unavailable.';

create or replace function public.get_admin_operational_state()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  with caller as (
    select
      admin_user.user_id,
      auth_user.email
    from app_private.admin_users admin_user
    join auth.users auth_user on auth_user.id = admin_user.user_id
    where admin_user.user_id = auth.uid()
      and admin_user.active
  ),
  category_payload as (
    select
      category.order_index,
      jsonb_build_object(
        'code', category.code,
        'title', category.title,
        'order_index', category.order_index,
        'price_kinds', to_jsonb(category.allowed_price_kinds),
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', item.id,
              'category_code', item.category_code,
              'name', item.name,
              'description', item.description,
              'order_index', item.order_index,
              'version', item.version,
              'archived_at', item.archived_at,
              'created_at', item.created_at,
              'updated_at', item.updated_at,
              'prices', coalesce((
                select jsonb_object_agg(
                  price.price_kind::text,
                  price.amount
                  order by price.price_kind::text
                )
                from menu_content.menu_item_prices price
                where price.item_id = item.id
              ), '{}'::jsonb),
              'availability', jsonb_build_object(
                'available', coalesce(availability.available, false),
                'updated_at', availability.updated_at
              )
            )
            order by (item.archived_at is not null), item.order_index, item.id
          )
          from menu_content.menu_items item
          left join public.menu_availability availability
            on availability.item_id = item.id
          where item.category_code = category.code
        ), '[]'::jsonb)
      ) as payload
    from menu_content.menu_categories category
  ),
  latest_request as (
    select jsonb_build_object(
      'id', request.id,
      'content_revision', request.content_revision,
      'status', request.status,
      'message', request.message,
      'hook_status_code', request.hook_status_code,
      'hook_job_id', request.hook_job_id,
      'created_at', request.created_at,
      'completed_at', request.completed_at
    ) as payload
    from app_private.menu_publish_requests request
    order by request.created_at desc, request.id desc
    limit 1
  )
  select case
    when not exists (select 1 from caller) then
      jsonb_build_object(
        'schema_version', 1,
        'authorized', false,
        'staff', null,
        'content', null,
        'business', null,
        'categories', '[]'::jsonb,
        'publish', jsonb_build_object('latest_request', null)
      )
    else jsonb_build_object(
      'schema_version', 1,
      'authorized', true,
      'staff', (
        select jsonb_build_object(
          'user_id', caller.user_id,
          'email', caller.email
        )
        from caller
      ),
      'content', (
        select jsonb_build_object(
          'current_revision', state.current_revision,
          'last_publish_requested_revision', state.last_publish_requested_revision,
          'last_publish_requested_at', state.last_publish_requested_at
        )
        from app_private.menu_content_state state
        where state.singleton
      ),
      'business', (
        select jsonb_build_object(
          'status', business.status,
          'message', business.message,
          'updated_at', business.updated_at
        )
        from public.business_runtime_state business
        where business.singleton
      ),
      'categories', coalesce((
        select jsonb_agg(category_payload.payload order by category_payload.order_index)
        from category_payload
      ), '[]'::jsonb),
      'publish', jsonb_build_object(
        'latest_request', (select latest_request.payload from latest_request)
      )
    )
  end;
$$;

comment on function public.get_admin_operational_state() is
  'Single-call private admin read model. Unauthorized sessions receive no menu content.';

create or replace function public.create_menu_item(
  p_category_code text,
  p_name text,
  p_description text,
  p_prices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  normalized_category text := nullif(btrim(p_category_code), '');
  normalized_name text := nullif(btrim(p_name), '');
  normalized_description text := nullif(btrim(p_description), '');
  next_order_index integer;
  new_item_id uuid;
  current_revision bigint;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false,
      'changed', false,
      'requires_redeploy', true,
      'operation', 'create_menu_item',
      'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if normalized_name is null or length(normalized_name) > 80 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'create_menu_item', 'message', 'invalid_name',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if normalized_description is not null and length(normalized_description) > 320 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'create_menu_item', 'message', 'invalid_description',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if not exists (
    select 1
    from menu_content.menu_categories category
    where category.code = normalized_category
  ) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'create_menu_item', 'message', 'invalid_category',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if not app_private.valid_menu_prices(normalized_category, p_prices) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'create_menu_item', 'message', 'invalid_prices',
      'revision', app_private.current_menu_revision()
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('il_figlio.menu_category.' || normalized_category, 0)
  );

  if exists (
    select 1
    from menu_content.menu_items item
    where item.category_code = normalized_category
      and lower(item.name) = lower(normalized_name)
  ) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'create_menu_item', 'message', 'menu_item_name_exists',
      'revision', app_private.current_menu_revision()
    );
  end if;

  select coalesce(max(item.order_index), 0) + 1
  into next_order_index
  from menu_content.menu_items item
  where item.category_code = normalized_category;

  insert into menu_content.menu_items (
    category_code,
    name,
    description,
    order_index,
    updated_by
  )
  values (
    normalized_category,
    normalized_name,
    normalized_description,
    next_order_index,
    auth.uid()
  )
  returning id into new_item_id;

  insert into menu_content.menu_item_prices (item_id, price_kind, amount)
  select
    new_item_id,
    entry.key::menu_content.menu_price_kind,
    (entry.value #>> '{}')::integer
  from jsonb_each(p_prices) entry;

  insert into public.menu_availability (item_id, available, updated_by)
  values (new_item_id, false, auth.uid());

  select app_private.current_menu_revision() into current_revision;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'requires_redeploy', true,
    'operation', 'create_menu_item',
    'message', 'menu_item_created',
    'revision', current_revision,
    'item_id', new_item_id,
    'version', 1
  );
end;
$$;

create or replace function public.update_menu_item(
  p_item_id uuid,
  p_expected_version bigint,
  p_name text,
  p_description text,
  p_prices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target_item menu_content.menu_items%rowtype;
  normalized_name text := nullif(btrim(p_name), '');
  normalized_description text := nullif(btrim(p_description), '');
  existing_prices jsonb;
  content_changed boolean;
  next_version bigint;
  current_revision bigint;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if p_item_id is null or p_expected_version is null or p_expected_version <= 0 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'invalid_item_version',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if normalized_name is null or length(normalized_name) > 80 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'invalid_name',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if normalized_description is not null and length(normalized_description) > 320 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'invalid_description',
      'revision', app_private.current_menu_revision()
    );
  end if;

  select item.*
  into target_item
  from menu_content.menu_items item
  where item.id = p_item_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'menu_item_not_found',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if target_item.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'stale_menu_item',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  if target_item.archived_at is not null then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'menu_item_archived',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  if not app_private.valid_menu_prices(target_item.category_code, p_prices) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'invalid_prices',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('il_figlio.menu_category.' || target_item.category_code, 0)
  );

  if exists (
    select 1
    from menu_content.menu_items item
    where item.category_code = target_item.category_code
      and lower(item.name) = lower(normalized_name)
      and item.id <> target_item.id
  ) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'update_menu_item', 'message', 'menu_item_name_exists',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  select coalesce(
    jsonb_object_agg(price.price_kind::text, price.amount order by price.price_kind::text),
    '{}'::jsonb
  )
  into existing_prices
  from menu_content.menu_item_prices price
  where price.item_id = target_item.id;

  content_changed := target_item.name is distinct from normalized_name
    or target_item.description is distinct from normalized_description
    or existing_prices is distinct from p_prices;

  if not content_changed then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'requires_redeploy', false,
      'operation', 'update_menu_item', 'message', 'menu_item_unchanged',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  next_version := target_item.version + 1;

  update menu_content.menu_items item
  set
    name = normalized_name,
    description = normalized_description,
    version = next_version,
    updated_by = auth.uid()
  where item.id = target_item.id;

  delete from menu_content.menu_item_prices price
  where price.item_id = target_item.id
    and not (p_prices ? price.price_kind::text);

  insert into menu_content.menu_item_prices (item_id, price_kind, amount)
  select
    target_item.id,
    entry.key::menu_content.menu_price_kind,
    (entry.value #>> '{}')::integer
  from jsonb_each(p_prices) entry
  on conflict (item_id, price_kind) do update
  set amount = excluded.amount
  where menu_content.menu_item_prices.amount is distinct from excluded.amount;

  select app_private.current_menu_revision() into current_revision;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'requires_redeploy', true,
    'operation', 'update_menu_item',
    'message', 'menu_item_updated',
    'revision', current_revision,
    'item_id', target_item.id,
    'version', next_version
  );
end;
$$;

create or replace function public.archive_menu_item(
  p_item_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target_item menu_content.menu_items%rowtype;
  next_version bigint;
  current_revision bigint;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'archive_menu_item', 'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if p_item_id is null or p_expected_version is null or p_expected_version <= 0 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'archive_menu_item', 'message', 'invalid_item_version',
      'revision', app_private.current_menu_revision()
    );
  end if;

  select item.*
  into target_item
  from menu_content.menu_items item
  where item.id = p_item_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'archive_menu_item', 'message', 'menu_item_not_found',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if target_item.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'archive_menu_item', 'message', 'stale_menu_item',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  if target_item.archived_at is not null then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'requires_redeploy', false,
      'operation', 'archive_menu_item', 'message', 'menu_item_already_archived',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  next_version := target_item.version + 1;

  update menu_content.menu_items item
  set
    archived_at = now(),
    version = next_version,
    updated_by = auth.uid()
  where item.id = target_item.id;

  insert into public.menu_availability (item_id, available, updated_at, updated_by)
  values (target_item.id, false, now(), auth.uid())
  on conflict (item_id) do update
  set
    available = false,
    updated_at = now(),
    updated_by = auth.uid();

  select app_private.current_menu_revision() into current_revision;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'requires_redeploy', true,
    'operation', 'archive_menu_item',
    'message', 'menu_item_archived',
    'revision', current_revision,
    'item_id', target_item.id,
    'version', next_version,
    'available', false
  );
end;
$$;

create or replace function public.restore_menu_item(
  p_item_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target_item menu_content.menu_items%rowtype;
  next_version bigint;
  current_revision bigint;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'restore_menu_item', 'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if p_item_id is null or p_expected_version is null or p_expected_version <= 0 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'restore_menu_item', 'message', 'invalid_item_version',
      'revision', app_private.current_menu_revision()
    );
  end if;

  select item.*
  into target_item
  from menu_content.menu_items item
  where item.id = p_item_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'restore_menu_item', 'message', 'menu_item_not_found',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if target_item.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', true,
      'operation', 'restore_menu_item', 'message', 'stale_menu_item',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  if target_item.archived_at is null then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'requires_redeploy', false,
      'operation', 'restore_menu_item', 'message', 'menu_item_already_active',
      'revision', app_private.current_menu_revision(),
      'item_id', target_item.id,
      'version', target_item.version
    );
  end if;

  next_version := target_item.version + 1;

  update menu_content.menu_items item
  set
    archived_at = null,
    version = next_version,
    updated_by = auth.uid()
  where item.id = target_item.id;

  insert into public.menu_availability (item_id, available, updated_at, updated_by)
  values (target_item.id, false, now(), auth.uid())
  on conflict (item_id) do update
  set
    available = false,
    updated_at = now(),
    updated_by = auth.uid();

  select app_private.current_menu_revision() into current_revision;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'requires_redeploy', true,
    'operation', 'restore_menu_item',
    'message', 'menu_item_restored_unavailable',
    'revision', current_revision,
    'item_id', target_item.id,
    'version', next_version,
    'available', false
  );
end;
$$;

create or replace function public.set_item_availability(
  p_item_id uuid,
  p_available boolean,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target_archived_at timestamptz;
  availability_row public.menu_availability%rowtype;
  resulting_updated_at timestamptz;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_item_availability', 'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if p_item_id is null or p_available is null then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_item_availability', 'message', 'invalid_availability',
      'revision', app_private.current_menu_revision()
    );
  end if;

  select item.archived_at
  into target_archived_at
  from menu_content.menu_items item
  where item.id = p_item_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_item_availability', 'message', 'menu_item_not_found',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if target_archived_at is not null and p_available then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_item_availability', 'message', 'archived_item_cannot_be_available',
      'revision', app_private.current_menu_revision(),
      'item_id', p_item_id
    );
  end if;

  select availability.*
  into availability_row
  from public.menu_availability availability
  where availability.item_id = p_item_id
  for update;

  if not found then
    insert into public.menu_availability (item_id, available, updated_at, updated_by)
    values (p_item_id, false, now(), auth.uid())
    returning * into availability_row;
  end if;

  if p_expected_updated_at is not null
    and availability_row.updated_at is distinct from p_expected_updated_at
  then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_item_availability', 'message', 'stale_availability',
      'revision', app_private.current_menu_revision(),
      'item_id', p_item_id,
      'available', availability_row.available,
      'updated_at', availability_row.updated_at
    );
  end if;

  if availability_row.available = p_available then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_item_availability', 'message', 'availability_unchanged',
      'revision', app_private.current_menu_revision(),
      'item_id', p_item_id,
      'available', availability_row.available,
      'updated_at', availability_row.updated_at
    );
  end if;

  update public.menu_availability availability
  set
    available = p_available,
    updated_at = now(),
    updated_by = auth.uid()
  where availability.item_id = p_item_id
  returning availability.updated_at into resulting_updated_at;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'requires_redeploy', false,
    'operation', 'set_item_availability',
    'message', 'availability_updated',
    'revision', app_private.current_menu_revision(),
    'item_id', p_item_id,
    'available', p_available,
    'updated_at', resulting_updated_at
  );
end;
$$;

create or replace function public.reset_all_availability()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  changed_count integer;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'reset_all_availability', 'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  with changed_rows as (
    update public.menu_availability availability
    set
      available = (item.archived_at is null),
      updated_at = now(),
      updated_by = auth.uid()
    from menu_content.menu_items item
    where item.id = availability.item_id
      and availability.available is distinct from (item.archived_at is null)
    returning availability.item_id
  )
  select count(*)::integer into changed_count
  from changed_rows;

  return jsonb_build_object(
    'ok', true,
    'changed', changed_count > 0,
    'changed_count', changed_count,
    'requires_redeploy', false,
    'operation', 'reset_all_availability',
    'message', case
      when changed_count > 0 then 'availability_reset'
      else 'availability_unchanged'
    end,
    'revision', app_private.current_menu_revision()
  );
end;
$$;

create or replace function public.set_business_status(
  p_status text,
  p_message text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  normalized_status text := nullif(btrim(p_status), '');
  normalized_message text := nullif(btrim(p_message), '');
  state_row public.business_runtime_state%rowtype;
  resulting_updated_at timestamptz;
begin
  if not app_private.is_admin_user(auth.uid()) then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_business_status', 'message', 'permission_denied',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if normalized_status is null
    or normalized_status not in ('accepting_orders', 'paused', 'sold_out', 'closed')
  then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_business_status', 'message', 'invalid_business_status',
      'revision', app_private.current_menu_revision()
    );
  end if;

  if normalized_message is not null and length(normalized_message) > 160 then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_business_status', 'message', 'invalid_business_message',
      'revision', app_private.current_menu_revision()
    );
  end if;

  select business.*
  into state_row
  from public.business_runtime_state business
  where business.singleton
  for update;

  if p_expected_updated_at is not null
    and state_row.updated_at is distinct from p_expected_updated_at
  then
    return jsonb_build_object(
      'ok', false, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_business_status', 'message', 'stale_business_status',
      'revision', app_private.current_menu_revision(),
      'status', state_row.status,
      'status_message', state_row.message,
      'updated_at', state_row.updated_at
    );
  end if;

  if state_row.status::text = normalized_status
    and state_row.message is not distinct from normalized_message
  then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'requires_redeploy', false,
      'operation', 'set_business_status', 'message', 'business_status_unchanged',
      'revision', app_private.current_menu_revision(),
      'status', state_row.status,
      'status_message', state_row.message,
      'updated_at', state_row.updated_at
    );
  end if;

  update public.business_runtime_state business
  set
    status = normalized_status::public.business_order_status,
    message = normalized_message,
    updated_at = now(),
    updated_by = auth.uid()
  where business.singleton
  returning business.updated_at into resulting_updated_at;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'requires_redeploy', false,
    'operation', 'set_business_status',
    'message', 'business_status_updated',
    'revision', app_private.current_menu_revision(),
    'status', normalized_status,
    'status_message', normalized_message,
    'updated_at', resulting_updated_at
  );
end;
$$;

create or replace function public.reserve_menu_publish_request(
  p_user_id uuid,
  p_cooldown_seconds integer default 60
)
returns table (
  request_id bigint,
  reserved boolean,
  message text,
  cooldown_remaining_seconds integer,
  content_revision bigint
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  effective_cooldown integer := least(greatest(coalesce(p_cooldown_seconds, 60), 0), 3600);
  stale_after_seconds integer;
  state_row app_private.menu_content_state%rowtype;
  existing_request app_private.menu_publish_requests%rowtype;
  inserted_request_id bigint;
  remaining_seconds integer;
begin
  if p_user_id is null or not app_private.is_admin_user(p_user_id) then
    return query select
      null::bigint,
      false,
      'permission_denied'::text,
      null::integer,
      null::bigint;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('il_figlio.publish_menu_changes', 0));

  stale_after_seconds := greatest(effective_cooldown, 120);

  update app_private.menu_publish_requests request
  set
    status = 'failed',
    message = 'publish_reservation_expired',
    completed_at = now()
  where request.status = 'queued'
    and request.created_at < clock_timestamp() - make_interval(secs => stale_after_seconds);

  select state.*
  into state_row
  from app_private.menu_content_state state
  where state.singleton
  for update;

  select request.*
  into existing_request
  from app_private.menu_publish_requests request
  where request.status = 'queued'
    and request.content_revision = state_row.current_revision
  order by request.created_at desc, request.id desc
  limit 1;

  if found then
    return query select
      existing_request.id,
      false,
      'publish_already_queued'::text,
      greatest(
        0,
        ceiling(extract(epoch from (
          existing_request.created_at
          + make_interval(secs => stale_after_seconds)
          - clock_timestamp()
        )))::integer
      ),
      state_row.current_revision;
    return;
  end if;

  select request.*
  into existing_request
  from app_private.menu_publish_requests request
  where request.status = 'succeeded'
    and request.completed_at >= clock_timestamp() - make_interval(secs => effective_cooldown)
  order by request.completed_at desc, request.id desc
  limit 1;

  if found then
    remaining_seconds := greatest(
      0,
      ceiling(extract(epoch from (
        existing_request.completed_at
        + make_interval(secs => effective_cooldown)
        - clock_timestamp()
      )))::integer
    );

    return query select
      existing_request.id,
      false,
      'publish_cooldown'::text,
      remaining_seconds,
      state_row.current_revision;
    return;
  end if;

  insert into app_private.menu_publish_requests (
    requested_by,
    content_revision,
    status,
    message
  )
  values (
    p_user_id,
    state_row.current_revision,
    'queued',
    'publish_reserved'
  )
  returning id into inserted_request_id;

  return query select
    inserted_request_id,
    true,
    'publish_reserved'::text,
    null::integer,
    state_row.current_revision;
end;
$$;

create or replace function public.complete_menu_publish_request(
  p_request_id bigint,
  p_publish_status text,
  p_publish_message text,
  p_hook_status_code integer default null,
  p_hook_job_id text default null
)
returns table (
  completed boolean,
  message text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  normalized_status text := nullif(btrim(p_publish_status), '');
  normalized_message text := nullif(btrim(p_publish_message), '');
  normalized_job_id text := nullif(btrim(p_hook_job_id), '');
  target_request app_private.menu_publish_requests%rowtype;
begin
  if p_request_id is null then
    return query select false, 'request_id_required'::text;
    return;
  end if;

  if normalized_status is null or normalized_status not in ('succeeded', 'failed') then
    return query select false, 'invalid_publish_status'::text;
    return;
  end if;

  if normalized_message is null or length(normalized_message) > 120 then
    return query select false, 'invalid_publish_message'::text;
    return;
  end if;

  if p_hook_status_code is not null
    and (p_hook_status_code < 100 or p_hook_status_code > 599)
  then
    return query select false, 'invalid_hook_status_code'::text;
    return;
  end if;

  if normalized_job_id is not null and length(normalized_job_id) > 160 then
    return query select false, 'invalid_hook_job_id'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('il_figlio.publish_menu_changes', 0));

  select request.*
  into target_request
  from app_private.menu_publish_requests request
  where request.id = p_request_id
  for update;

  if not found then
    return query select false, 'publish_request_not_found'::text;
    return;
  end if;

  if target_request.status <> 'queued' then
    if target_request.status::text = normalized_status then
      return query select true, 'publish_request_already_completed'::text;
    else
      return query select false, 'publish_request_completion_conflict'::text;
    end if;
    return;
  end if;

  update app_private.menu_publish_requests request
  set
    status = normalized_status::app_private.menu_publish_status,
    message = normalized_message,
    hook_status_code = p_hook_status_code,
    hook_job_id = normalized_job_id,
    completed_at = now()
  where request.id = target_request.id;

  if normalized_status = 'succeeded' then
    update app_private.menu_content_state state
    set
      last_publish_requested_revision = greatest(
        state.last_publish_requested_revision,
        target_request.content_revision
      ),
      last_publish_requested_at = now(),
      updated_at = now()
    where state.singleton;
  end if;

  return query select true, 'publish_request_completed'::text;
end;
$$;

-- Fixed categories. Their code, order and pricing model are intentionally not
-- editable through browser RPCs.
insert into menu_content.menu_categories (
  code,
  title,
  order_index,
  allowed_price_kinds
)
values
  ('classic', 'Pizzas clásicas', 10, array['whole', 'slice']::menu_content.menu_price_kind[]),
  ('filled', 'Pizzas rellenas', 20, array['whole']::menu_content.menu_price_kind[]),
  ('gourmet', 'Pizzas gourmet', 30, array['whole']::menu_content.menu_price_kind[]),
  ('empanadas', 'Empanadas', 40, array['unit']::menu_content.menu_price_kind[]),
  ('extras', 'Extras', 50, array['portion']::menu_content.menu_price_kind[]);

-- Initial menu transcribed from IMG-20260723-WA0115.jpg and
-- IMG-20260723-WA0116.jpg. Obvious abbreviations and capitalization were
-- normalized without changing product meaning or confirmed prices.
insert into menu_content.menu_items (
  id,
  category_code,
  name,
  description,
  order_index
)
values
  ('00000000-0000-4000-8000-000000000001', 'classic', 'Mozzarella', 'Salsa de tomate, mozzarella, orégano o albahaca y aceitunas.', 1),
  ('00000000-0000-4000-8000-000000000002', 'classic', 'Fugazza', 'Cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.', 2),
  ('00000000-0000-4000-8000-000000000003', 'classic', 'Fugazza con mozzarella', 'Mozzarella, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.', 3),
  ('00000000-0000-4000-8000-000000000004', 'classic', 'Jamón', 'Salsa de tomate, mozzarella, jamón cocido, orégano y aceitunas.', 4),
  ('00000000-0000-4000-8000-000000000005', 'classic', 'Jamón y morrones', 'Salsa de tomate, mozzarella, jamón cocido, morrones, orégano y aceitunas.', 5),
  ('00000000-0000-4000-8000-000000000006', 'classic', 'Napolitana', 'Salsa de tomate, mozzarella, rodajas de tomate, queso parmesano, provenzal y aceitunas.', 6),
  ('00000000-0000-4000-8000-000000000007', 'classic', 'Napolitana especial', 'Salsa de tomate, mozzarella, jamón cocido, rodajas de tomate, queso parmesano, provenzal y aceitunas.', 7),
  ('00000000-0000-4000-8000-000000000008', 'classic', 'Provolone', 'Salsa de tomate, mozzarella, queso provolone, orégano y aceitunas.', 8),
  ('00000000-0000-4000-8000-000000000009', 'classic', 'Provolone con jamón', 'Salsa de tomate, mozzarella, jamón cocido, queso provolone, orégano y aceitunas.', 9),
  ('00000000-0000-4000-8000-000000000010', 'classic', 'Roquefort', 'Salsa de tomate, mozzarella, queso roquefort y aceitunas.', 10),
  ('00000000-0000-4000-8000-000000000011', 'classic', 'Peperoni', 'Salsa de tomate, mozzarella, queso parmesano y peperoni.', 11),
  ('00000000-0000-4000-8000-000000000012', 'classic', 'Aglio e olio', 'Salsa de tomate, ajo picado, aceite de oliva, orégano y aceitunas.', 12),
  ('00000000-0000-4000-8000-000000000013', 'filled', 'Fugazzeta', 'Mozzarella, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.', 1),
  ('00000000-0000-4000-8000-000000000014', 'filled', 'Fugazzetta con jamón', 'Mozzarella, jamón cocido, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.', 2),
  ('00000000-0000-4000-8000-000000000015', 'filled', 'Fugazzetta provolone', 'Mozzarella, queso provolone, cebolla, orégano, aceite de oliva y aceitunas.', 3),
  ('00000000-0000-4000-8000-000000000016', 'filled', 'Fugazzetta completa', 'Mozzarella, jamón cocido, morrones, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.', 4),
  ('00000000-0000-4000-8000-000000000017', 'gourmet', 'Jamón crudo', 'Salsa de tomate, mozzarella, jamón crudo, orégano y aceitunas.', 1),
  ('00000000-0000-4000-8000-000000000018', 'gourmet', 'Cuatro quesos', 'Salsa de tomate, mozzarella, provolone, roquefort, parmesano, orégano y aceitunas.', 2),
  ('00000000-0000-4000-8000-000000000019', 'gourmet', 'Panceta y champignons', 'Salsa de tomate, mozzarella, champignons, bacon (panceta) y aceitunas.', 3),
  ('00000000-0000-4000-8000-000000000020', 'gourmet', 'C.B.O', 'Cheddar, bacon (panceta), base de cebolla o tomate y aceitunas.', 4),
  ('00000000-0000-4000-8000-000000000021', 'empanadas', 'Carne', null, 1),
  ('00000000-0000-4000-8000-000000000022', 'empanadas', 'Jamón y queso', null, 2),
  ('00000000-0000-4000-8000-000000000023', 'extras', 'Fainá', null, 1),
  ('00000000-0000-4000-8000-000000000024', 'extras', 'Fainá provolone', null, 2);

insert into menu_content.menu_item_prices (item_id, price_kind, amount)
values
  ('00000000-0000-4000-8000-000000000001', 'whole', 14000),
  ('00000000-0000-4000-8000-000000000001', 'slice', 2500),
  ('00000000-0000-4000-8000-000000000002', 'whole', 11000),
  ('00000000-0000-4000-8000-000000000002', 'slice', 1500),
  ('00000000-0000-4000-8000-000000000003', 'whole', 15000),
  ('00000000-0000-4000-8000-000000000003', 'slice', 3000),
  ('00000000-0000-4000-8000-000000000004', 'whole', 17000),
  ('00000000-0000-4000-8000-000000000004', 'slice', 3500),
  ('00000000-0000-4000-8000-000000000005', 'whole', 19000),
  ('00000000-0000-4000-8000-000000000005', 'slice', 4000),
  ('00000000-0000-4000-8000-000000000006', 'whole', 17000),
  ('00000000-0000-4000-8000-000000000006', 'slice', 3500),
  ('00000000-0000-4000-8000-000000000007', 'whole', 19000),
  ('00000000-0000-4000-8000-000000000007', 'slice', 4000),
  ('00000000-0000-4000-8000-000000000008', 'whole', 20000),
  ('00000000-0000-4000-8000-000000000008', 'slice', 4000),
  ('00000000-0000-4000-8000-000000000009', 'whole', 22000),
  ('00000000-0000-4000-8000-000000000009', 'slice', 4500),
  ('00000000-0000-4000-8000-000000000010', 'whole', 20000),
  ('00000000-0000-4000-8000-000000000010', 'slice', 3500),
  ('00000000-0000-4000-8000-000000000011', 'whole', 20000),
  ('00000000-0000-4000-8000-000000000011', 'slice', 4000),
  ('00000000-0000-4000-8000-000000000012', 'whole', 9000),
  ('00000000-0000-4000-8000-000000000012', 'slice', 1500),
  ('00000000-0000-4000-8000-000000000013', 'whole', 24000),
  ('00000000-0000-4000-8000-000000000014', 'whole', 27000),
  ('00000000-0000-4000-8000-000000000015', 'whole', 27000),
  ('00000000-0000-4000-8000-000000000016', 'whole', 30000),
  ('00000000-0000-4000-8000-000000000017', 'whole', 21000),
  ('00000000-0000-4000-8000-000000000018', 'whole', 24000),
  ('00000000-0000-4000-8000-000000000019', 'whole', 28000),
  ('00000000-0000-4000-8000-000000000020', 'whole', 28000),
  ('00000000-0000-4000-8000-000000000021', 'unit', 2800),
  ('00000000-0000-4000-8000-000000000022', 'unit', 2800),
  ('00000000-0000-4000-8000-000000000023', 'portion', 1200),
  ('00000000-0000-4000-8000-000000000024', 'portion', 2000);

insert into public.menu_availability (item_id, available)
select item.id, true
from menu_content.menu_items item;

-- The initial confirmed menu is revision 1 regardless of seed statement count.
update app_private.menu_content_state
set
  current_revision = 1,
  last_publish_requested_revision = 0,
  last_publish_requested_at = null,
  updated_at = now()
where singleton;

alter table menu_content.menu_categories enable row level security;
alter table menu_content.menu_items enable row level security;
alter table menu_content.menu_item_prices enable row level security;
alter table public.menu_availability enable row level security;
alter table public.business_runtime_state enable row level security;
alter table app_private.admin_users enable row level security;
alter table app_private.menu_content_state enable row level security;
alter table app_private.menu_publish_requests enable row level security;

revoke all on all tables in schema menu_content
  from public, anon, authenticated, service_role, menu_build;
revoke all on all tables in schema app_private
  from public, anon, authenticated, service_role, menu_build;
revoke all on table public.menu_availability, public.business_runtime_state
  from public, anon, authenticated, service_role, menu_build;
revoke all on all sequences in schema app_private
  from public, anon, authenticated, service_role;

revoke all on all functions in schema menu_content
  from public, anon, authenticated, service_role;
revoke all on all functions in schema app_private
  from public, anon, authenticated, service_role;
revoke all on all functions in schema public
  from public, anon, authenticated, service_role;
revoke all on all functions in schema public from menu_build;

grant execute on function public.get_public_runtime_state()
  to anon, authenticated;
grant execute on function public.get_build_menu_snapshot()
  to service_role;
grant execute on function public.get_build_menu_snapshot()
  to menu_build;
grant execute on function public.get_admin_operational_state()
  to authenticated;
grant execute on function public.can_manage_menu()
  to authenticated;
grant execute on function public.can_publish_menu()
  to authenticated;
grant execute on function public.create_menu_item(text, text, text, jsonb)
  to authenticated;
grant execute on function public.update_menu_item(uuid, bigint, text, text, jsonb)
  to authenticated;
grant execute on function public.archive_menu_item(uuid, bigint)
  to authenticated;
grant execute on function public.restore_menu_item(uuid, bigint)
  to authenticated;
grant execute on function public.set_item_availability(uuid, boolean, timestamptz)
  to authenticated;
grant execute on function public.reset_all_availability()
  to authenticated;
grant execute on function public.set_business_status(text, text, timestamptz)
  to authenticated;
grant execute on function public.reserve_menu_publish_request(uuid, integer)
  to service_role;
grant execute on function public.complete_menu_publish_request(bigint, text, text, integer, text)
  to service_role;

comment on table menu_content.menu_categories is
  'Five fixed categories and their exact price-key contract.';
comment on table menu_content.menu_items is
  'Build-time editable flavors. Archived rows remain recoverable.';
comment on table menu_content.menu_item_prices is
  'Typed integer ARS amounts. Category compatibility is enforced by trigger.';
comment on table public.menu_availability is
  'Runtime availability for each flavor, including archived flavors needed by older deploys.';
comment on table public.business_runtime_state is
  'Singleton manual order-taking state. It overrides per-item availability in the UI.';
comment on table app_private.admin_users is
  'Allowlist with at most one active user. Bootstrap only through privileged SQL.';
comment on table app_private.menu_content_state is
  'Monotonic editorial revision and latest successfully queued deploy-hook revision.';
comment on table app_private.menu_publish_requests is
  'Idempotent deploy-hook reservation and completion ledger.';

commit;
