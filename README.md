# Il Figlio

Landing y carta QR para Il Figlio, con un administrador privado y acotado para mantener sabores, precios y disponibilidad. La portada pública vive en `/` y la carta en `/carta/`. El proyecto conserva el stack probado en El Faraón —Astro, Supabase y Vercel— pero reduce el dominio a una sola carta, un solo usuario y dos flujos claramente separados: edición/publicación y operación inmediata.

## Estado del proyecto

La implementación técnica tiene un entorno remoto activo:

- Sitio público: [https://il-figlio.vercel.app](https://il-figlio.vercel.app).
- Backend remoto de Supabase con migración, Auth, función de publicación y credencial privada de build activas.
- Administrador privado disponible para edición y publicación.

El dominio propio, el QR definitivo y la transferencia al cliente permanecen pendientes. La propiedad, el consentimiento, los respaldos y la operación privada se registran fuera de este repositorio; no se publican aquí identidades ni secretos.

Documentación principal:

- [Arquitectura](docs/architecture.md)
- [Activación, operación y transferencia remota](docs/activation.md)
- [Estado remoto y operación de Supabase](docs/supabase/README.md)
- [Sistema de diseño](design-system/il-figlio/MASTER.md)

## Requisitos

- Node.js `22.23.0` (se admite cualquier versión compatible con `22.x`)
- npm `10` o superior
- Deno `2.7.14` para validar la Edge Function
- Un runtime compatible con Docker (Docker Desktop o Colima) para ejecutar Supabase local

Las versiones recomendadas están declaradas en `package.json` mediante Volta.

## Inicio rápido

```bash
npm install
cp .env.example .env.local
npm run dev
```

La URL local predeterminada es `http://localhost:4321`. El fixture es solo una fuente de desarrollo: debe elegirse mediante `MENU_DATA_SOURCE=fixture` y `ALLOW_FIXTURE_BUILD=true`.

## Comandos

| Comando | Propósito |
| --- | --- |
| `npm run dev` | Inicia Astro en desarrollo. |
| `npm run build` | Valida el entorno, genera `dist/` y rechaza secretos en el artefacto. |
| `npm run preview` | Sirve localmente el último build. |
| `npm run check` | Valida Astro y TypeScript estricto. |
| `npm run check:js` | Comprueba sintaxis de JavaScript del repositorio. |
| `npm run lint` | Ejecuta ESLint. |
| `npm test` | Ejecuta las suites de menú, admin y tooling. |
| `npm run test:menu` | Ejecuta reglas y contratos del menú. |
| `npm run test:admin` | Ejecuta reglas y contratos del administrador. |
| `npm run test:tools` | Ejecuta las guardas del build y del artefacto. |
| `npm run verify:dist-secrets` | Rechaza secretos o marcadores privados dentro de `dist/`. |
| `npm run supabase:start` | Inicia Supabase local. |
| `npm run supabase:reset` | Reconstruye la base local desde migraciones y seed. |
| `npm run test:db` | Ejecuta las pruebas SQL de Supabase. |
| `npm run supabase:audit` | Audita la base y la exposición efectiva del Data API en modo read-only. |

El runner descubre archivos en `tests/<suite>/**/*.test.mjs` y, por compatibilidad con scripts existentes, `scripts/test-<suite>-*.mjs`. Una suite vacía falla de forma intencional: CI nunca informa éxito si faltan sus pruebas.

## Builds y fuentes de datos

### Fixture local o CI

```bash
MENU_DATA_SOURCE=fixture ALLOW_FIXTURE_BUILD=true npm run build
```

CI usa exactamente ese opt-in. Un build productivo detectado por `VERCEL_ENV`, `DEPLOY_ENV`, `APP_ENV` o `NODE_ENV` rechaza el fixture incluso si se intenta habilitarlo.

### Supabase

```bash
MENU_DATA_SOURCE=supabase \
PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co \
PUBLIC_SUPABASE_ANON_KEY=... \
SUPABASE_DB_URL=postgresql://... \
npm run build
```

`SUPABASE_DB_URL` es privada y se utiliza únicamente para obtener el snapshot editorial durante el build. Nunca debe llevar prefijo `PUBLIC_` ni llegar al navegador.

### Auditoría remota

```bash
SUPABASE_AUDIT_DB_URL=postgresql://... \
PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co \
PUBLIC_SUPABASE_ANON_KEY=... \
npm run supabase:audit
```

La auditoría ejecuta el contrato SQL dentro de una transacción read-only, comprueba el RPC público como control positivo y exige que `menu_content` y `app_private` permanezcan fuera del Data API. La credencial de auditoría es privada, privilegiada y distinta de la identidad mínima usada por el build.

## Criterios de seguridad

- El sitio público solo recibe la URL y la clave anónima de Supabase.
- El navegador no escribe directamente en tablas editoriales; el admin usa RPCs autorizadas.
- El Deploy Hook de Vercel existe únicamente como secreto de la Edge Function.
- `/admin/` se sirve con `noindex`, `nofollow`, `noarchive` y `no-store`.
- El build productivo falla sin credenciales o si intenta utilizar el fixture.
- CI inspecciona el artefacto generado en busca de valores y marcadores privados.

No guardes secretos reales en archivos `.env`; todos están ignorados salvo `.env.example`.
