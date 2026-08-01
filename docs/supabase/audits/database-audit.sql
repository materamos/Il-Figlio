-- Il Figlio Supabase read-only audit.
-- Every query that exposes a `diagnostic` column must return zero rows.

begin transaction read only;

with expected(schema_name, table_name) as (
  values
    ('menu_content', 'menu_categories'),
    ('menu_content', 'menu_items'),
    ('menu_content', 'menu_item_prices'),
    ('public', 'menu_availability'),
    ('public', 'business_runtime_state'),
    ('app_private', 'admin_users'),
    ('app_private', 'menu_content_state'),
    ('app_private', 'menu_publish_requests')
),
actual as (
  select table_schema as schema_name, table_name
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and table_schema in ('menu_content', 'app_private')
  union all
  select table_schema, table_name
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and table_schema = 'public'
    and table_name in ('menu_availability', 'business_runtime_state')
)
select
  case when expected.table_name is null
    then 'unexpected_backend_table'
    else 'missing_backend_table'
  end as diagnostic,
  coalesce(expected.schema_name, actual.schema_name) as schema_name,
  coalesce(expected.table_name, actual.table_name) as table_name
from expected
full join actual using (schema_name, table_name)
where expected.table_name is null or actual.table_name is null;

with expected(code, title, order_index, allowed_price_kinds) as (
  values
    ('classic', 'Pizzas clásicas', 10, array['whole', 'slice']::text[]),
    ('filled', 'Pizzas rellenas', 20, array['whole']::text[]),
    ('gourmet', 'Pizzas gourmet', 30, array['whole']::text[]),
    ('empanadas', 'Empanadas', 40, array['unit']::text[]),
    ('extras', 'Extras', 50, array['portion']::text[])
)
select
  'fixed_category_mismatch' as diagnostic,
  coalesce(expected.code, category.code) as category_code,
  expected.title as expected_title,
  category.title as actual_title,
  expected.order_index as expected_order,
  category.order_index as actual_order,
  expected.allowed_price_kinds as expected_price_kinds,
  category.allowed_price_kinds::text[] as actual_price_kinds
from expected
full join menu_content.menu_categories category using (code)
where expected.code is null
  or category.code is null
  or category.title is distinct from expected.title
  or category.order_index is distinct from expected.order_index
  or category.allowed_price_kinds::text[] is distinct from expected.allowed_price_kinds;

select
  'menu_item_price_contract_mismatch' as diagnostic,
  item.id as item_id,
  item.category_code,
  category.allowed_price_kinds::text[] as required_price_kinds,
  coalesce(array_agg(price.price_kind::text order by price.price_kind::text)
    filter (where price.price_kind is not null), array[]::text[]) as actual_price_kinds
from menu_content.menu_items item
join menu_content.menu_categories category on category.code = item.category_code
left join menu_content.menu_item_prices price on price.item_id = item.id
group by item.id, item.category_code, category.allowed_price_kinds
having coalesce(array_agg(price.price_kind::text order by price.price_kind::text)
  filter (where price.price_kind is not null), array[]::text[])
  is distinct from (
    select array_agg(kind::text order by kind::text)
    from unnest(category.allowed_price_kinds) kind
  );

select
  'invalid_price_amount' as diagnostic,
  price.item_id,
  price.price_kind,
  price.amount
from menu_content.menu_item_prices price
where price.amount <= 0 or price.amount > 10000000;

select
  'availability_row_missing' as diagnostic,
  item.id as item_id,
  item.name
from menu_content.menu_items item
left join public.menu_availability availability on availability.item_id = item.id
where availability.item_id is null;

select
  'archived_item_available' as diagnostic,
  item.id as item_id,
  item.name,
  item.archived_at
from menu_content.menu_items item
join public.menu_availability availability on availability.item_id = item.id
where item.archived_at is not null
  and availability.available;

select
  'singleton_row_count_invalid' as diagnostic,
  object_name,
  row_count
from (
  select 'business_runtime_state'::text as object_name, count(*)::bigint as row_count
  from public.business_runtime_state
  union all
  select 'menu_content_state', count(*)::bigint
  from app_private.menu_content_state
) counts
where row_count <> 1;

select
  'multiple_active_admins' as diagnostic,
  count(*) as active_admin_count
from app_private.admin_users
where active
having count(*) > 1;

select
  'content_revision_invalid' as diagnostic,
  current_revision,
  last_publish_requested_revision
from app_private.menu_content_state
where current_revision < 1
  or last_publish_requested_revision < 0
  or last_publish_requested_revision > current_revision;

select
  'stale_queued_publish_request' as diagnostic,
  id,
  content_revision,
  created_at
from app_private.menu_publish_requests
where status = 'queued'
  and created_at < now() - interval '2 hours';

with protected_tables(schema_name, table_name) as (
  values
    ('menu_content', 'menu_categories'),
    ('menu_content', 'menu_items'),
    ('menu_content', 'menu_item_prices'),
    ('public', 'menu_availability'),
    ('public', 'business_runtime_state'),
    ('app_private', 'admin_users'),
    ('app_private', 'menu_content_state'),
    ('app_private', 'menu_publish_requests')
)
select
  'rls_disabled' as diagnostic,
  protected.schema_name,
  protected.table_name
from protected_tables protected
join pg_catalog.pg_namespace namespace on namespace.nspname = protected.schema_name
join pg_catalog.pg_class relation
  on relation.relnamespace = namespace.oid
 and relation.relname = protected.table_name
where not relation.relrowsecurity;

select
  'unexpected_browser_table_grant' as diagnostic,
  grant_info.grantee,
  grant_info.table_schema,
  grant_info.table_name,
  grant_info.privilege_type
from information_schema.role_table_grants grant_info
where grant_info.grantee in ('anon', 'authenticated')
  and (
    grant_info.table_schema in ('menu_content', 'app_private')
    or (
      grant_info.table_schema = 'public'
      and grant_info.table_name in ('menu_availability', 'business_runtime_state')
    )
  );

select
  'unexpected_direct_rls_policy' as diagnostic,
  policy.schemaname,
  policy.tablename,
  policy.policyname,
  policy.roles,
  policy.cmd
from pg_catalog.pg_policies policy
where policy.schemaname in ('menu_content', 'app_private')
  or (
    policy.schemaname = 'public'
    and policy.tablename in ('menu_availability', 'business_runtime_state')
  );

with expected(function_name, identity_arguments) as (
  values
    ('can_manage_menu', ''),
    ('can_publish_menu', ''),
    ('get_build_menu_snapshot', ''),
    ('get_admin_operational_state', ''),
    ('get_public_runtime_state', ''),
    ('create_menu_item', 'p_category_code text, p_name text, p_description text, p_prices jsonb'),
    ('update_menu_item', 'p_item_id uuid, p_expected_version bigint, p_name text, p_description text, p_prices jsonb'),
    ('archive_menu_item', 'p_item_id uuid, p_expected_version bigint'),
    ('restore_menu_item', 'p_item_id uuid, p_expected_version bigint'),
    ('set_item_availability', 'p_item_id uuid, p_available boolean, p_expected_updated_at timestamp with time zone'),
    ('reset_all_availability', ''),
    ('set_business_status', 'p_status text, p_message text, p_expected_updated_at timestamp with time zone'),
    ('reserve_menu_publish_request', 'p_user_id uuid, p_cooldown_seconds integer'),
    ('complete_menu_publish_request', 'p_request_id bigint, p_publish_status text, p_publish_message text, p_hook_status_code integer, p_hook_job_id text')
),
actual as (
  select
    procedure.proname as function_name,
    pg_get_function_identity_arguments(procedure.oid) as identity_arguments
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (select expected.function_name from expected)
)
select
  'public_rpc_missing_or_mismatched' as diagnostic,
  expected.function_name,
  expected.identity_arguments
from expected
left join actual using (function_name, identity_arguments)
where actual.function_name is null;

select
  'public_rpc_not_security_definer' as diagnostic,
  procedure.proname as function_name,
  pg_get_function_identity_arguments(procedure.oid) as identity_arguments
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'can_manage_menu',
    'can_publish_menu',
    'get_build_menu_snapshot',
    'get_admin_operational_state',
    'get_public_runtime_state',
    'create_menu_item',
    'update_menu_item',
    'archive_menu_item',
    'restore_menu_item',
    'set_item_availability',
    'reset_all_availability',
    'set_business_status',
    'reserve_menu_publish_request',
    'complete_menu_publish_request'
  )
  and not procedure.prosecdef;

select
  'public_rpc_search_path_unlocked' as diagnostic,
  procedure.proname as function_name,
  procedure.proconfig
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname in (
    'can_manage_menu',
    'can_publish_menu',
    'get_build_menu_snapshot',
    'get_admin_operational_state',
    'get_public_runtime_state',
    'create_menu_item',
    'update_menu_item',
    'archive_menu_item',
    'restore_menu_item',
    'set_item_availability',
    'reset_all_availability',
    'set_business_status',
    'reserve_menu_publish_request',
    'complete_menu_publish_request'
  )
  and not coalesce(procedure.proconfig, array[]::text[]) @> array['search_path=pg_catalog, pg_temp'];

select
  'unsafe_function_execute_grant' as diagnostic,
  role_name,
  function_signature
from (
  values
    ('anon', 'public.get_admin_operational_state()'),
    ('anon', 'public.get_build_menu_snapshot()'),
    ('anon', 'public.create_menu_item(text,text,text,jsonb)'),
    ('anon', 'public.set_item_availability(uuid,boolean,timestamp with time zone)'),
    ('authenticated', 'public.get_build_menu_snapshot()'),
    ('authenticated', 'public.reserve_menu_publish_request(uuid,integer)'),
    ('authenticated', 'public.complete_menu_publish_request(bigint,text,text,integer,text)'),
    ('menu_build', 'public.get_admin_operational_state()'),
    ('menu_build', 'public.get_public_runtime_state()'),
    ('menu_build', 'public.create_menu_item(text,text,text,jsonb)')
) denied(role_name, function_signature)
where has_function_privilege(role_name, function_signature, 'EXECUTE');

select
  'required_function_execute_grant_missing' as diagnostic,
  role_name,
  function_signature
from (
  values
    ('anon', 'public.get_public_runtime_state()'),
    ('authenticated', 'public.get_public_runtime_state()'),
    ('authenticated', 'public.get_admin_operational_state()'),
    ('authenticated', 'public.create_menu_item(text,text,text,jsonb)'),
    ('authenticated', 'public.update_menu_item(uuid,bigint,text,text,jsonb)'),
    ('authenticated', 'public.archive_menu_item(uuid,bigint)'),
    ('authenticated', 'public.restore_menu_item(uuid,bigint)'),
    ('authenticated', 'public.set_item_availability(uuid,boolean,timestamp with time zone)'),
    ('authenticated', 'public.reset_all_availability()'),
    ('authenticated', 'public.set_business_status(text,text,timestamp with time zone)'),
    ('menu_build', 'public.get_build_menu_snapshot()'),
    ('service_role', 'public.reserve_menu_publish_request(uuid,integer)'),
    ('service_role', 'public.complete_menu_publish_request(bigint,text,text,integer,text)')
) required(role_name, function_signature)
where not has_function_privilege(role_name, function_signature, 'EXECUTE');

select
  'menu_build_role_capability_risk' as diagnostic,
  role.rolname,
  role.rolsuper,
  role.rolinherit,
  role.rolcreaterole,
  role.rolcreatedb,
  role.rolcanlogin,
  role.rolreplication,
  role.rolbypassrls,
  role.rolconnlimit
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
  );

rollback;
