# Supabase de Il Figlio

Este directorio documenta el backend local, el estado remoto y el procedimiento
para crear un entorno nuevo. La migración canónica es
`supabase/migrations/20260801000000_initial_menu_backend.sql`.

La migración es reproducible y no contiene secretos. La activación remota, las
identidades, las credenciales, la propiedad y las evidencias operativas se
mantienen fuera del repositorio.

## Estado remoto y operación

Al 2026-08-01, el entorno remoto de Il Figlio tiene estado `activo`:

- la migración canónica está aplicada;
- Supabase Auth está habilitado con el registro público desactivado;
- existe un único administrador para el negocio;
- la credencial privada de build de solo lectura está creada;
- la Edge Function `publish-menu-changes` está desplegada y configurada para
  publicar mediante el flujo validado.

El sitio técnico publicado es [https://il-figlio.vercel.app](https://il-figlio.vercel.app).
Los secretos, las identidades concretas y las evidencias de prueba no se
documentan aquí. No repitas el provisioning ni ejecutes mutaciones en el
proyecto activo sin autorización explícita.

## Arquitectura y límites

- `menu_content` contiene categorías, sabores y precios editoriales. La web
  pública los recibe en el build; nunca los consulta en runtime.
- `public.menu_availability` y `public.business_runtime_state` contienen el
  estado operativo que se consulta en runtime.
- `app_private` contiene la allowlist, la revisión editorial y el ledger de
  publicación.
- Los roles de navegador no tienen grants sobre tablas. Usan solamente las
  RPCs explícitas de `public`.
- Solo puede existir un registro activo en `app_private.admin_users`.
- Archivar un sabor lo marca no disponible en la misma transacción. Restaurar
  un sabor lo deja no disponible hasta que el administrador lo habilite.
- Un cambio editorial incrementa una revisión por transacción y requiere
  deploy. Disponibilidad y estado general no modifican la revisión.

El modelo completo está en [schema-diagram.md](./schema-diagram.md).

## Desarrollo local

Requisitos: Docker Desktop o Colima, Supabase CLI y Deno `2.7.14`.

```sh
supabase start
supabase db reset
supabase test db
```

La migración carga la carta confirmada: 12 pizzas clásicas, 4 rellenas, 4
gourmet, 2 empanadas y 2 fainás. No crea usuarios Auth ni secretos.

Para verificar la Edge Function, desde `supabase/functions`:

```sh
deno task check
deno task test
```

## Contrato de precios

Los precios son enteros positivos en pesos argentinos y cada categoría exige
exactamente estas claves:

| Categoría | Claves JSON |
| --- | --- |
| `classic` | `whole`, `slice` |
| `filled` | `whole` |
| `gourmet` | `whole` |
| `empanadas` | `unit` |
| `extras` | `portion` |

Ejemplo:

```json
{
  "whole": 14000,
  "slice": 2500
}
```

Las categorías son fijas. Ninguna RPC permite crearlas, editarlas, borrarlas
ni mover un sabor de una categoría a otra.

## RPCs de lectura

### `get_build_menu_snapshot()`

Solo `menu_build` y `service_role`. Se resuelve en una única sentencia SQL y,
por lo tanto, categorías, items, precios y revisión pertenecen al mismo
snapshot de PostgreSQL.

```json
{
  "schema_version": 1,
  "revision": 1,
  "categories": [
    {
      "code": "classic",
      "title": "Pizzas clásicas",
      "order_index": 10,
      "price_kinds": ["whole", "slice"],
      "items": [
        {
          "id": "00000000-0000-4000-8000-000000000001",
          "category_code": "classic",
          "name": "Mozzarella",
          "description": "Salsa de tomate, mozzarella, orégano o albahaca y aceitunas.",
          "order_index": 1,
          "version": 1,
          "prices": { "whole": 14000, "slice": 2500 }
        }
      ]
    }
  ]
}
```

Los items archivados quedan excluidos. Las categorías fijas permanecen aunque
temporalmente no tengan items.

### `get_public_runtime_state()`

Disponible para `anon` y `authenticated`:

```json
{
  "schema_version": 1,
  "business": {
    "status": "closed",
    "message": null,
    "updated_at": "2026-08-01T00:00:00+00:00"
  },
  "availability": [
    {
      "item_id": "00000000-0000-4000-8000-000000000001",
      "available": true,
      "updated_at": "2026-08-01T00:00:00+00:00"
    }
  ]
}
```

La lista incluye items archivados. Eso permite que una versión estática
anterior vea inmediatamente el item archivado como agotado mientras termina el
nuevo deploy.

### `get_admin_operational_state()`

Disponible para `authenticated`; devuelve datos solo si `auth.uid()` pertenece
a la allowlist activa.

Con autorización:

```json
{
  "schema_version": 1,
  "authorized": true,
  "staff": { "user_id": "uuid", "email": "admin@example.com" },
  "content": {
    "current_revision": 4,
    "last_publish_requested_revision": 3,
    "last_publish_requested_at": "2026-08-01T00:00:00+00:00"
  },
  "business": {
    "status": "accepting_orders",
    "message": null,
    "updated_at": "2026-08-01T00:00:00+00:00"
  },
  "categories": [],
  "publish": { "latest_request": null }
}
```

Cada item de `categories` agrega `archived_at`, `created_at`, `updated_at` y:

```json
{
  "availability": {
    "available": true,
    "updated_at": "2026-08-01T00:00:00+00:00"
  }
}
```

Sin autorización devuelve `authorized: false`, `categories: []` y valores
privados nulos.

## RPCs editoriales y operativas

Todas las mutaciones de navegador devuelven como mínimo:

```json
{
  "ok": true,
  "changed": true,
  "requires_redeploy": true,
  "operation": "update_menu_item",
  "message": "menu_item_updated",
  "revision": 2
}
```

RPCs:

- `create_menu_item(p_category_code, p_name, p_description, p_prices)`
- `update_menu_item(p_item_id, p_expected_version, p_name, p_description, p_prices)`
- `archive_menu_item(p_item_id, p_expected_version)`
- `restore_menu_item(p_item_id, p_expected_version)`
- `set_item_availability(p_item_id, p_available, p_expected_updated_at default null)`
- `reset_all_availability()`
- `set_business_status(p_status, p_message default null, p_expected_updated_at default null)`

Las mutaciones editoriales agregan `item_id` y `version` cuando corresponde.
Las dos marcas esperadas (`p_expected_version` y `p_expected_updated_at`)
protegen contra formularios abiertos con datos anteriores.

`reset_all_availability()` marca disponibles todos los items activos y mantiene
no disponibles los archivados. El estado global acepta:

- `accepting_orders`
- `paused`
- `sold_out`
- `closed`

El frontend debe hacer prevalecer el estado global sobre la disponibilidad por
sabor.

## Bootstrap del único administrador

Primero se crea el usuario desde Supabase Auth con registro público desactivado.
Después, usando una conexión privilegiada y el UUID real confirmado:

```sql
begin;

select id, email
from auth.users
where id = 'UUID_REAL'::uuid;

insert into app_private.admin_users (user_id)
values ('UUID_REAL'::uuid);

commit;
```

La restricción `admin_users_single_active_idx` impide dos usuarios activos. Para
reemplazarlo, desactivar el anterior y agregar el nuevo en una única transacción
privilegiada. Nunca se hace bootstrap desde el navegador ni con una dirección
inventada.

## Credencial de build de solo lectura

La migración crea `menu_build` como rol `NOLOGIN` y le concede únicamente uso
de `public` y ejecución de `get_build_menu_snapshot()`. No incluye contraseñas.

Durante la activación remota se crea una identidad de login separada mediante
`psql`; la contraseña se pasa como variable secreta, no se escribe en SQL ni se
guarda en el repositorio:

```sh
psql "$SUPABASE_ADMIN_DB_URL" \
  --set=build_password="$IL_FIGLIO_BUILD_PASSWORD" \
  --file=docs/supabase/bootstrap-build-login.sql
```

El resultado es la credencial privada `SUPABASE_DB_URL` usada solo durante el
build. No debe tener prefijo `PUBLIC_`, llegar al navegador ni aparecer en logs.

## Publicación

`publish-menu-changes` es la única Edge Function. Su flujo es:

1. Comprueba origen CORS y método `POST`.
2. Valida el bearer token con Supabase Auth.
3. Comprueba `can_publish_menu()` contra la allowlist.
4. Reserva la revisión mediante una RPC exclusiva de `service_role`.
5. Aplica idempotencia y cooldown.
6. Ejecuta el Deploy Hook con timeout.
7. Registra éxito o fallo mediante una RPC exclusiva de `service_role`.

Variables de Function:

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | Provista por Supabase |
| `SUPABASE_ANON_KEY` | Provista por Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Provista por Supabase; nunca cliente |
| `PUBLISH_ALLOWED_ORIGINS` | Lista exacta separada por comas |
| `VERCEL_DEPLOY_HOOK_URL` | Secreto del Deploy Hook |
| `DEPLOY_HOOK_MODE` | `vercel` en producción, `test` solo local |
| `DEPLOY_HOOK_TIMEOUT_MS` | `250..30000`, por defecto `10000` |
| `PUBLISH_COOLDOWN_SECONDS` | `0..3600`, por defecto `60` |

En modo `vercel`, la URL debe usar HTTPS, host `api.vercel.com` y la ruta de
integración de deploy. En modo `test`, solo se permiten loopback y
`host.docker.internal`.

Para simular el hook sin Vercel:

```sh
node scripts/supabase-mock-deploy-hook.mjs
```

Servir la Function con la configuración local sin secretos:

```sh
supabase functions serve publish-menu-changes \
  --no-verify-jwt \
  --env-file supabase/functions/local-env.example
```

El ejemplo configura:

```text
DEPLOY_HOOK_MODE=test
VERCEL_DEPLOY_HOOK_URL=http://host.docker.internal:8787/deploy
PUBLISH_ALLOWED_ORIGINS=http://localhost:4321
```

`publish_queued` significa que el hook aceptó la solicitud; no prueba que el
deploy posterior haya terminado correctamente. El frontend compara la revisión
embebida en `/admin/` con `current_revision` como única evidencia de despliegue.
Mientras la revisión embebida sea anterior, debe permitir reintentar incluso la
misma revisión después de `PUBLISH_COOLDOWN_SECONDS` (60 segundos por defecto).
Una reserva `queued` que no pudo completarse expira después del mayor valor
entre el cooldown configurado y 120 segundos; desde entonces puede reservarse
un nuevo intento.

## Auditoría de solo lectura

Ejecutar con una credencial privilegiada de auditoría, nunca con la credencial
de build:

```sh
psql "$SUPABASE_AUDIT_DB_URL" \
  -X --set=ON_ERROR_STOP=1 \
  --file=docs/supabase/audits/database-audit.sql
```

El archivo comienza con `BEGIN READ ONLY` y cada consulta debe devolver cero
filas. La suite pgTAP se ejecuta únicamente sobre una base local descartable.

## Provisioning de un entorno nuevo

Esta secuencia conserva los pasos necesarios para un entorno cuyo estado sea
`pendiente`; no es una orden para modificar el entorno remoto actual.

1. Crear y vincular el proyecto Supabase.
2. Revisar que `public` sea el único schema expuesto por Data API.
3. Aplicar la migración canónica.
4. Crear el usuario Auth real y agregar su UUID a la allowlist.
5. Crear la credencial de build de solo lectura.
6. Configurar los secretos de la Function y desplegarla.
7. Ejecutar pgTAP en una base local descartable y la auditoría read-only contra
   remoto.
8. Configurar Vercel y efectuar el primer build real.
9. Probar lectura anónima, acceso autorizado/no autorizado, archivo seguro,
   disponibilidad runtime y publicación.

No ejecutar un deploy, crear usuarios ni mutar el proyecto remoto como parte de
una validación local.
