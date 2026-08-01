# Activación, operación y transferencia remota

Este runbook es reutilizable para el entorno remoto actual y para crear un entorno nuevo. El entorno técnico actual tiene estado `activo` al 2026-08-01; el dominio propio, el QR definitivo y la transferencia al cliente tienen estado `pendiente`. No pegues secretos en commits, issues ni logs.

Las operaciones que crean, modifican o publican recursos remotos requieren autorización explícita y registro del resultado. Las comprobaciones locales y las lecturas de estado no sustituyen esa autorización.

## 1. Elegir la ruta

### Entorno remoto actual — estado `activo`

El sitio técnico publicado es [https://il-figlio.vercel.app](https://il-figlio.vercel.app). El proyecto remoto de Supabase cuenta con la migración, Auth, el administrador, la credencial privada de build y la Edge Function de publicación activas. No vuelvas a crear usuarios, secretos, proyectos ni Deploy Hooks en este entorno: utiliza las secciones de aceptación, publicación, rollback y operación para verificarlo o cambiarlo con autorización.

### Entorno nuevo — estado `pendiente`

Utiliza las secciones de provisioning de Supabase, Auth, Vercel y la Edge Function. Los valores reales de proyecto, identidades y secretos deben permanecer en sus gestores o consolas; este repositorio solo conserva nombres, contratos y ejemplos no utilizables.

### Impacto de las operaciones

| Operación | Efecto | Autorización |
| --- | --- | --- |
| `supabase link`, `supabase db push` o cambios de migración | Vincula el checkout o modifica el backend remoto. | Requerida |
| Crear/reemplazar el usuario Auth o la allowlist | Cambia el acceso administrativo. | Requerida |
| Crear variables, secretos, Deploy Hooks o desplegar la Function | Cambia credenciales o publicación remota. | Requerida |
| Crear/promover/retirar un deployment de Vercel | Cambia lo que sirve la URL pública. | Requerida |
| Conectar dominio, redirects o QR | Cambia rutas públicas y material impreso. | Requerida |
| Consultar estados, logs sin secretos o la URL publicada | No muta el servicio, pero debe quedar registrado como evidencia. | No muta; registrar |

## 2. Validación local previa

Desde un checkout limpio:

```bash
npm ci
npm run check
npm run check:js
npm run lint
npm test
(
  cd supabase/functions
  npx --yes deno@2.7.14 task check
  npx --yes deno@2.7.14 task test
)
MENU_DATA_SOURCE=fixture ALLOW_FIXTURE_BUILD=true npm run build
npm run verify:dist-secrets
```

Con Docker activo:

```bash
npm run supabase:start
npm run supabase:reset
npm run test:db
npm run supabase:status
npm run supabase:stop -- --no-backup
```

No continúes si una migración no reconstruye la base desde cero o si falla una política/RPC.

## 3. Crear y vincular Supabase

1. Crear un proyecto en la organización correcta y guardar su `project ref` en el gestor de secretos.
2. Elegir una región cercana a Argentina y una contraseña de base única.
3. Vincular el checkout sin guardar tokens en el repositorio:

   ```bash
   npx supabase login
   npx supabase link --project-ref PROJECT_REF
   ```

4. Comparar migraciones y aplicar únicamente las revisadas:

   ```bash
   npx supabase migration list
   npx supabase db push
   ```

5. Crear la identidad de build de mínimo privilegio con una contraseña generada y guardada en el gestor de secretos:

   ```bash
   psql "$SUPABASE_ADMIN_DB_URL" \
     --set=build_password="$IL_FIGLIO_BUILD_PASSWORD" \
     --file=docs/supabase/bootstrap-build-login.sql
   ```

6. Construir `SUPABASE_DB_URL` con el usuario `il_figlio_build_login` y comprobar que puede ejecutar `get_build_menu_snapshot()` pero no leer tablas ni escribir datos.
7. Verificar tablas, constraints, funciones, grants y políticas RLS en el proyecto remoto.

La conexión utilizada por Vercel debe ser esa credencial de lectura de build. No reutilices `postgres`, el service role ni un propietario de esquema para `SUPABASE_DB_URL`.

## 4. Configurar Auth y el único administrador

1. En Supabase Auth, deshabilitar el registro público.
2. Configurar Site URL y redirects exclusivamente para el dominio productivo y las previews autorizadas.
3. Crear manualmente el único usuario con su correo real y exigir cambio/recuperación segura de contraseña.
4. Copiar el UUID de Auth, verificar juntos UUID y correo, e incorporarlo a la allowlist mediante una conexión privilegiada:

   ```sql
   begin;
   select id, email from auth.users where id = 'UUID_REAL'::uuid;
   insert into app_private.admin_users (user_id) values ('UUID_REAL'::uuid);
   commit;
   ```

   La restricción de base impide que queden dos administradores activos.
5. Probar tres identidades: anónimo, autenticado no autorizado y administrador autorizado.
6. Confirmar que cerrar sesión invalida el acceso y que la recuperación vuelve al dominio correcto.

No se crea una interfaz de invitaciones ni gestión de usuarios.

## 5. Crear el proyecto Vercel

1. Importar el repositorio de GitHub sin desplegar todavía a producción.
2. Seleccionar Node.js `22.x`, framework Astro y directorio de salida `dist`.
3. Mantener el comando `npm run build`; su guarda impide un despliegue incompleto.
4. Configurar estas variables para producción:

   ```text
   MENU_DATA_SOURCE=supabase
   PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_DB_URL=postgresql://READ_ONLY_BUILD_USER:...
   PUBLIC_SITE_URL=https://DOMINIO_FINAL
   ```

5. No configurar `ALLOW_FIXTURE_BUILD` en Vercel.
6. No configurar `VERCEL_DEPLOY_HOOK_URL`, service role ni tokens de Supabase en variables accesibles al frontend.

Las previews remotas también deben leer Supabase o quedar deshabilitadas; el fixture no es una fuente publicable.

## 6. Conectar la publicación

1. Crear un Deploy Hook de Vercel limitado al branch productivo.
2. Guardarlo directamente como secreto de la Edge Function:

   ```bash
   npx supabase secrets set \
     VERCEL_DEPLOY_HOOK_URL='https://api.vercel.com/v1/integrations/deploy/...' \
     PUBLISH_ALLOWED_ORIGINS='https://DOMINIO_FINAL' \
     DEPLOY_HOOK_MODE='vercel' \
     DEPLOY_HOOK_TIMEOUT_MS='10000' \
     PUBLISH_COOLDOWN_SECONDS='60'
   ```

3. Desplegar la función con la validación JWT propia del handler:

   ```bash
   npx supabase functions deploy publish-menu-changes --no-verify-jwt
   ```

   La función valida internamente el JWT y la allowlist; conservar `verify_jwt = false` en su configuración para no duplicar esa validación con comportamientos distintos.
4. Confirmar que una sesión ausente, vencida o no autorizada no llega al hook.
5. Simular éxito, error HTTP y timeout antes de habilitar el botón productivo.

El hook es rotativo: si aparece en un log o lugar no confiable, revocarlo en Vercel y actualizar el secreto de Supabase.

## 7. Aceptación funcional y verificación de publicación

1. Ejecutar el build con el snapshot remoto y revisar la revisión editorial embebida:

   ```bash
   MENU_DATA_SOURCE=supabase \
   PUBLIC_SUPABASE_URL="$PUBLIC_SUPABASE_URL" \
   PUBLIC_SUPABASE_ANON_KEY="$PUBLIC_SUPABASE_ANON_KEY" \
   SUPABASE_DB_URL="$SUPABASE_DB_URL" \
   PUBLIC_SITE_URL="$PUBLIC_SITE_URL" \
   npm run build
   ```
2. Ejecutar `npm run verify:dist-secrets` contra el mismo artefacto.
3. Desplegar primero como preview protegida.
4. Verificar en móvil y escritorio:
   - landing y menú sin JavaScript;
   - precios, categorías y regla de mitad y mitad;
   - enlace `https://wa.me/5491144097322`;
   - login y recuperación;
   - alta, edición, archivo y restauración;
   - disponibilidad inmediata sin deploy;
   - estados pausado, agotado y cerrado;
   - revisión pendiente, publicación y revisión desplegada;
   - fallback seguro con Supabase inaccesible.
5. Inspeccionar headers, especialmente CSP, HSTS y `X-Robots-Tag` de `/admin/`.
6. Promover a producción solo después de completar el checklist.

La aceptación funcional exige registrar el resultado de cada punto, sin copiar
credenciales, correos ni valores privados. Una solicitud `publish_queued` solo
demuestra que el hook aceptó la petición: no demuestra que el deployment ya
esté servido. La publicación queda aceptada únicamente cuando la revisión
embebida en la aplicación publicada coincide con `current_revision` y la URL
pública responde con la carta esperada.

## 8. Dominio y QR

1. Vincular el dominio definitivo y esperar HTTPS válido.
2. Actualizar `PUBLIC_SITE_URL` y los redirects de Auth.
3. Realizar un nuevo build y comprobar canonicals/metadata.
4. Generar el QR contra la URL definitiva (`/` o `/#carta`), nunca contra una preview.
5. Probar el QR impreso con iOS y Android antes de producir cartelería.

## 9. Rollback y operación

- Un cambio editorial incorrecto se corrige en el admin y se vuelve a publicar; mientras tanto puede marcarse el sabor agotado.
- Un producto archivado se restaura, se publica y recién después se habilita.
- Un despliegue defectuoso se revierte desde Vercel a un artefacto conocido y luego se corrige la revisión editorial.
- Ante una caída de disponibilidad, la carta debe seguir visible y derivar la confirmación a WhatsApp.
- Rotar periódicamente contraseña del usuario, conexión privada de build y Deploy Hook.

Registrar fecha, responsable y resultado de cada activación o rotación sin copiar valores secretos.

## 10. Transferencia

La transferencia es una secuencia independiente de la activación técnica. El
runbook privado conserva la autoridad sobre propietarios, consentimiento,
backups, evidencias y aceptación administrativa.

1. Preparar las cuentas del cliente y confirmar que puede acceder a GitHub,
   Supabase, Vercel y al registrador del dominio.
2. Congelar cambios, generar y verificar el backup externo de Supabase y
   conservar una referencia de la última versión conocida.
3. Transferir los recursos y permisos acordados, sin mover secretos en texto
   plano ni dejar accesos personales innecesarios.
4. Validar primero el sitio en `https://il-figlio.vercel.app`, incluyendo menú,
   login administrativo, edición, operación inmediata y publicación.
5. Conectar el dominio propio, actualizar redirects y generar el QR definitivo
   solo cuando el dominio responda con HTTPS válido.
6. Rotar o revocar credenciales y accesos anteriores; conservar únicamente el
   acceso técnico expresamente acordado.
7. Confirmar que el cliente puede editar, publicar, comprobar un deployment y
   ejecutar la recuperación documentada sin asistencia.

Cada paso con efecto remoto requiere autorización y un registro operativo. Si
alguna comprobación queda en estado `no verificado`, la transferencia no se
considera aceptada.
