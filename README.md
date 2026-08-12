# Il Figlio

Landing y carta QR estática para Il Figlio. El contenido se edita en una Google Sheet privada, un Apps Script valida y publica un snapshot JSON, y Vercel reconstruye el sitio Astro cuando recibe el Deploy Hook.

## Arquitectura

```text
Google Sheet privada
  -> Apps Script valida y genera el snapshot
  -> web app JSON pública de solo lectura
  -> Deploy Hook
  -> build estático de Astro en Vercel
```

La web no consulta Google durante la navegación. Landing, carta y estado del negocio quedan incorporados al HTML durante el build.

Rutas públicas:

- `/`: landing y contacto.
- `/carta/`: carta completa.
- `/publication.json`: revisión y hash del artefacto servido.

## Requisitos

- Node.js `22.23.0` o compatible con `22.x`.
- npm `10` o superior.
- Cuenta Google autorizada para operar `clasp` cuando se actualiza Apps Script.

## Desarrollo local

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

El fixture requiere un opt-in explícito:

```powershell
$env:MENU_DATA_SOURCE = "fixture"
$env:ALLOW_FIXTURE_BUILD = "true"
npm run build
```

## Comandos

| Comando | Propósito |
| --- | --- |
| `npm run dev` | Inicia Astro en desarrollo. |
| `npm run build` | Valida el entorno, genera `dist/` y comprueba el artefacto. |
| `npm run check` | Valida Astro y TypeScript. |
| `npm run check:js` | Comprueba la sintaxis JavaScript. |
| `npm run lint` | Ejecuta ESLint. |
| `npm test` | Ejecuta pruebas del menú, Apps Script y tooling. |
| `npm run apps-script:status` | Muestra qué archivos enviaría `clasp`. |
| `npm run apps-script:push` | Actualiza el Apps Script vinculado. |
| `npm run apps-script:open` | Abre el Apps Script vinculado. |
| `npm run apps-script:deploy` | Crea una versión desplegada del web app. |

## Fuentes de datos

### Fixture local y CI

```text
MENU_DATA_SOURCE=fixture
ALLOW_FIXTURE_BUILD=true
```

Un build productivo nunca puede usar el fixture.

### Snapshot publicado

```text
MENU_DATA_SOURCE=google_snapshot
MENU_SNAPSHOT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
PUBLIC_SITE_URL=https://il-figlio.vercel.app
```

`MENU_SNAPSHOT_URL` se consume solamente durante el build y no llega al navegador. El snapshot se vuelve a validar en Node antes de generar las páginas.

## Publicación editorial

1. Editar `Carta` o `Estado` en la planilla.
2. En `Publicacion`, activar la casilla `Publicar cambios` (`B2`).
3. Apps Script valida toda la planilla.
4. Si es válida, incrementa la revisión, actualiza el snapshot y llama al Deploy Hook.
5. Vercel construye el sitio con el snapshot nuevo.
6. El verificador compara la revisión con `/publication.json` y confirma el resultado en la planilla.

Una respuesta exitosa del Deploy Hook solo significa que Vercel aceptó la solicitud. La publicación se considera terminada cuando `/publication.json` contiene la revisión y el hash esperados.

## Seguridad

- La Google Sheet permanece privada.
- El web app expone solo el snapshot destinado a la carta pública.
- El Deploy Hook vive en Script Properties; nunca en celdas ni en el repositorio.
- Las credenciales de `clasp` viven en el perfil local del usuario.
- El navegador no recibe URLs de Google ni secretos de publicación.
- `verify-dist-secrets` rechaza secretos y marcadores administrativos en `dist/`.

Consulta [Arquitectura](docs/architecture.md) y [Activación](docs/activation.md) para el contrato y el runbook completos.
