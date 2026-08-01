begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(56);

select has_schema('menu_content', 'menu_content schema exists');
select has_schema('app_private', 'app_private schema exists');
select has_table('menu_content', 'menu_categories', 'menu_categories exists');
select has_table('menu_content', 'menu_items', 'menu_items exists');
select has_table('menu_content', 'menu_item_prices', 'menu_item_prices exists');
select has_table('public', 'menu_availability', 'menu_availability exists');
select has_table('public', 'business_runtime_state', 'business_runtime_state exists');
select has_table('app_private', 'admin_users', 'admin_users exists');
select has_table('app_private', 'menu_content_state', 'menu_content_state exists');
select has_table('app_private', 'menu_publish_requests', 'menu_publish_requests exists');

select is(
  (select count(*) from menu_content.menu_categories),
  5::bigint,
  'five fixed categories are seeded'
);
select is(
  (select count(*) from menu_content.menu_items),
  24::bigint,
  'twenty-four confirmed flavors are seeded'
);
select is(
  (select count(*) from menu_content.menu_item_prices),
  36::bigint,
  'all typed prices are seeded'
);
select is(
  (select count(*) from public.menu_availability),
  24::bigint,
  'every seed flavor has runtime availability'
);
select is(
  (
    select price.amount
    from menu_content.menu_item_prices price
    where price.item_id = '00000000-0000-4000-8000-000000000007'
      and price.price_kind = 'whole'
  ),
  19000,
  'Napolitana especial whole price is the confirmed 19000'
);
select ok(
  (
    select count(*) = 2 and bool_and(price.amount = 2800)
    from menu_content.menu_item_prices price
    where price.item_id in (
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000022'
    )
  ),
  'both empanadas cost 2800'
);

select is(
  public.get_build_menu_snapshot() ->> 'schema_version',
  '1',
  'build snapshot schema version is stable'
);
select is(
  public.get_build_menu_snapshot() ->> 'revision',
  '1',
  'initial build snapshot is revision 1'
);
select is(
  jsonb_array_length(public.get_build_menu_snapshot() -> 'categories'),
  5,
  'build snapshot contains all fixed categories'
);
select is(
  (
    select sum(jsonb_array_length(category.payload -> 'items'))::integer
    from jsonb_array_elements(public.get_build_menu_snapshot() -> 'categories')
      category(payload)
  ),
  24,
  'build snapshot contains all active seed items'
);
select is(
  jsonb_array_length(public.get_public_runtime_state() -> 'availability'),
  24,
  'public runtime state contains every availability row'
);
select is(
  public.get_public_runtime_state() #>> '{business,status}',
  'closed',
  'business starts closed and is controlled manually'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where relation.relrowsecurity
      and (namespace.nspname, relation.relname) in (
        ('menu_content', 'menu_categories'),
        ('menu_content', 'menu_items'),
        ('menu_content', 'menu_item_prices'),
        ('public', 'menu_availability'),
        ('public', 'business_runtime_state'),
        ('app_private', 'admin_users'),
        ('app_private', 'menu_content_state'),
        ('app_private', 'menu_publish_requests')
      )
  ),
  8::bigint,
  'RLS is enabled on every application table'
);
select ok(
  has_function_privilege('anon', 'public.get_public_runtime_state()', 'EXECUTE'),
  'anon can execute only the public runtime read contract'
);
select ok(
  not has_function_privilege('anon', 'public.get_admin_operational_state()', 'EXECUTE'),
  'anon cannot execute the admin read contract'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_build_menu_snapshot()', 'EXECUTE'),
  'authenticated browser users cannot execute the build snapshot'
);
select ok(
  has_function_privilege('menu_build', 'public.get_build_menu_snapshot()', 'EXECUTE'),
  'menu_build can execute the build snapshot'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_menu_item(text,text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated role can reach the guarded create RPC'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'controlled+il-figlio-test@example.com',
  'not-a-real-password',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into app_private.admin_users (user_id)
values ('10000000-0000-4000-8000-000000000001');

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

set local role authenticated;

select ok(public.can_manage_menu(), 'allowlisted session can manage menu');
select is(
  (public.get_admin_operational_state() ->> 'authorized')::boolean,
  true,
  'allowlisted session receives the admin state'
);
select is(
  (
    public.create_menu_item(
      'classic',
      'Precio inválido',
      null,
      '{"whole":15000}'::jsonb
    ) ->> 'ok'
  )::boolean,
  false,
  'create rejects a category price contract with a missing key'
);
select is(
  (
    public.create_menu_item(
      'classic',
      'Test especial',
      'Item transaccional de prueba.',
      '{"whole":15000,"slice":3000}'::jsonb
    ) ->> 'ok'
  )::boolean,
  true,
  'authorized create is atomic and succeeds'
);

reset role;

select ok(
  exists (
    select 1
    from menu_content.menu_items item
    join public.menu_availability availability on availability.item_id = item.id
    where item.name = 'Test especial'
      and not availability.available
  ),
  'a new item starts unavailable'
);
select is(
  (select current_revision from app_private.menu_content_state where singleton),
  2::bigint,
  'the editorial transaction increments the revision once'
);

create temporary table test_item_context as
select item.id, item.version
from menu_content.menu_items item
where item.name = 'Test especial';
grant select on test_item_context to authenticated;

set local role authenticated;

select is(
  public.archive_menu_item(
    (select id from test_item_context),
    (select version from test_item_context)
  ) ->> 'message',
  'menu_item_archived',
  'archive succeeds through the guarded RPC'
);

reset role;

select ok(
  exists (
    select 1
    from menu_content.menu_items item
    join public.menu_availability availability on availability.item_id = item.id
    where item.name = 'Test especial'
      and item.archived_at is not null
      and not availability.available
  ),
  'archive marks the item unavailable in the same transaction'
);

update test_item_context context
set version = item.version
from menu_content.menu_items item
where item.id = context.id;

set local role authenticated;

select is(
  public.restore_menu_item(
    (select id from test_item_context),
    (select version from test_item_context)
  ) ->> 'message',
  'menu_item_restored_unavailable',
  'restore succeeds and advertises the safe state'
);

reset role;

select ok(
  exists (
    select 1
    from menu_content.menu_items item
    join public.menu_availability availability on availability.item_id = item.id
    where item.name = 'Test especial'
      and item.archived_at is null
      and not availability.available
  ),
  'restored item remains unavailable'
);

update test_item_context context
set version = item.version
from menu_content.menu_items item
where item.id = context.id;

set local role authenticated;

select is(
  public.set_item_availability(
    (select id from test_item_context),
    true
  ) ->> 'message',
  'availability_updated',
  'active item availability updates without deploy'
);

reset role;

select ok(
  (
    select availability.available
    from public.menu_availability availability
    join test_item_context context on context.id = availability.item_id
  ),
  'availability update is persisted'
);

set local role authenticated;

select is(
  public.set_business_status('accepting_orders', null) ->> 'message',
  'business_status_updated',
  'manual business status updates without deploy'
);
select is(
  public.get_public_runtime_state() #>> '{business,status}',
  'accepting_orders',
  'public runtime state reflects accepting_orders'
);
select is(
  public.set_item_availability(
    (select id from test_item_context),
    false
  ) ->> 'message',
  'availability_updated',
  'test item can be marked unavailable'
);
select ok(
  (public.reset_all_availability() ->> 'changed_count')::integer >= 1,
  'reset marks every active item available'
);

reset role;

select ok(
  (
    select availability.available
    from public.menu_availability availability
    join test_item_context context on context.id = availability.item_id
  ),
  'reset persisted active availability'
);

create temporary table publish_context as
select *
from public.reserve_menu_publish_request(
  '10000000-0000-4000-8000-000000000001',
  60
);

select ok(
  (select reserved from publish_context),
  'first publication reserves the current revision'
);
select is(
  (
    select reserve.message
    from public.reserve_menu_publish_request(
      '10000000-0000-4000-8000-000000000001',
      60
    ) reserve
  ),
  'publish_already_queued',
  'a duplicate concurrent publication is idempotent'
);
select ok(
  (
    select completion.completed
    from public.complete_menu_publish_request(
      (select request_id from publish_context),
      'succeeded',
      'publish_queued',
      201,
      'mock_job_1'
    ) completion
  ),
  'publication completion is recorded'
);
select is(
  (
    select state.last_publish_requested_revision
    from app_private.menu_content_state state
    where state.singleton
  ),
  (
    select state.current_revision
    from app_private.menu_content_state state
    where state.singleton
  ),
  'successful hook completion records the requested revision'
);
select is(
  (
    select reserve.message
    from public.reserve_menu_publish_request(
      '10000000-0000-4000-8000-000000000001',
      60
    ) reserve
  ),
  'publish_cooldown',
  'an accepted hook is retryable but protected by the configured cooldown'
);
select ok(
  (
    select reserve.reserved
    from public.reserve_menu_publish_request(
      '10000000-0000-4000-8000-000000000001',
      0
    ) reserve
  ),
  'the same revision can be reserved again after its cooldown expires'
);

select ok(
  not has_table_privilege('anon', 'menu_content.menu_items', 'SELECT'),
  'anon has no direct private content table grant'
);
select ok(
  not has_table_privilege('anon', 'public.menu_availability', 'SELECT'),
  'anon has no direct runtime table grant'
);

set local role anon;

select ok(
  jsonb_typeof(public.get_public_runtime_state()) = 'object',
  'anon reads runtime state only through the public RPC'
);

reset role;
set local role authenticated;

select is(
  public.archive_menu_item(
    (select id from test_item_context),
    (select version from test_item_context)
  ) ->> 'message',
  'menu_item_archived',
  'test item can be archived again'
);

reset role;

select ok(
  not jsonb_path_exists(
    public.get_build_menu_snapshot(),
    '$.categories[*].items[*] ? (@.name == "Test especial")'
  ),
  'build snapshot excludes archived items'
);

select * from finish();
rollback;
