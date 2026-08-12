# Activación y operación

Este runbook describe el entorno Google Sheets, Apps Script y Vercel de Il Figlio. Nunca pegues tokens, URLs de Deploy Hooks ni credenciales en archivos versionados.

## 1. Validación local

```powershell
npm ci
npm run check
npm run check:js
npm run lint
npm test
$env:MENU_DATA_SOURCE = "fixture"
$env:ALLOW_FIXTURE_BUILD = "true"
$env:PUBLIC_SITE_URL = "https://il-figlio.example.test"
npm run build
```

No continúes si falla alguno de esos comandos.

## 2. Autenticar clasp

Habilita Apps Script API en la cuenta propietaria y autentica una identidad local con nombre explícito:

```powershell
npx clasp login --user ilfiglio
npx clasp --user ilfiglio show-authorized-user --json
```

La segunda salida debe indicar `ilfigliodev@gmail.com`. Las credenciales se guardan en el perfil local, no en este repositorio.

## 3. Apps Script y planilla

El proyecto vinculado se define en `apps-script/.clasp.json` y el código vive en `apps-script/src/`.

```powershell
npm run apps-script:status
npm run apps-script:push
npm run apps-script:open
```

Después del primer push, ejecuta `setupProject` una vez desde el editor de Apps Script. En una instalación existente, `upgradeSheetExperience` realiza la misma preparación. Estas funciones:

- crean el editor móvil `Publicar`, `Local`, `Clásicas`, `Rellenas`, `Gourmet`, `Empanadas` y `Extras`;
- migran el esquema anterior únicamente después de guardar un respaldo privado y comprobar que la carta resultante sea idéntica;
- conservan las pestañas anteriores protegidas y ocultas como recuperación;
- instalan el trigger de publicación por edición;
- instalan el trigger que detecta altas, bajas y movimientos de filas;
- instalan el verificador periódico;
- solicitan los permisos mínimos necesarios.

El archivo de snapshot se crea en Drive al preparar la primera publicación válida.
La copia servida por el web app se guarda fragmentada en Script Properties para
evitar lecturas vacías inmediatamente después de escribir en Drive.

## 4. Configuración privada

Ejecuta `configureProject` desde el editor de Apps Script para definir estas Script Properties privadas:

| Propiedad | Valor |
| --- | --- |
| `VERCEL_DEPLOY_HOOK_URL` | Hook asociado a la rama productiva. |
| `PUBLIC_SITE_URL` | Origen del sitio, por ejemplo `https://il-figlio.vercel.app`, sin ruta. |

`SNAPSHOT_FILE_ID` es una propiedad interna creada automáticamente durante la primera publicación válida. No la definas manualmente.

El hook nunca se escribe en una celda ni se devuelve desde `doGet`.

## 5. Web app JSON

Despliega el proyecto como web app:

- ejecutar como la cuenta propietaria;
- acceso público de solo lectura;
- entrada única `doGet`;
- sin `doPost`.

Guarda la URL `/exec` resultante como `MENU_SNAPSHOT_URL` en Vercel.
Las actualizaciones posteriores deben reutilizar ese mismo deployment: crea una
versión inmutable y actualiza su identificador; no crees otra implementación.

```powershell
npx clasp --user ilfiglio --project apps-script/.clasp.json create-version "Descripción"
npx clasp --user ilfiglio --project apps-script/.clasp.json update-deployment DEPLOYMENT_ID --versionNumber VERSION
curl.exe --location --fail-with-body --silent --show-error "https://script.google.com/macros/s/DEPLOYMENT_ID/exec?check=UNIX_MS"
```

La última llamada se ejecuta sin cookies ni sesión: debe devolver JSON no vacío,
sin pedir login. `clasp` no garantiza por sí solo el acceso anónimo del web app.
Si devuelve login o `403`, corrige una vez el deployment en la interfaz: ejecutar
como propietario y acceso `Cualquiera`.

## 6. Vercel

El proyecto debe conservar el comando `npm run build` y configurar en Production:

```text
MENU_DATA_SOURCE=google_snapshot
MENU_SNAPSHOT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
PUBLIC_SITE_URL=https://il-figlio.vercel.app
```

No configures `ALLOW_FIXTURE_BUILD` en producción.

Crea un único Deploy Hook para la rama productiva y guárdalo en `VERCEL_DEPLOY_HOOK_URL` dentro de Apps Script.

## 7. Prueba completa

1. Cambiar un precio en una pestaña de categoría.
2. Activar `Publicar cambios` en `Publicar!B2`.
3. Confirmar que la planilla muestra `Publicando…`.
4. Esperar un deployment Vercel `READY`.
5. Abrir `/publication.json` y comprobar revisión y hash.
6. Confirmar que la planilla cambia a `Menú actualizado`.
7. Verificar `/` y `/carta/` en escritorio y móvil.
8. Repetir con `Cerrado` y `Agotado`.
9. Probar una fila inválida y confirmar que no dispara un deploy.

## 8. Actualizar Apps Script

Antes de subir cambios:

```powershell
npm test
npm run apps-script:status
npm run apps-script:push
```

`clasp push` sustituye el contenido remoto completo. Revisa siempre `apps-script:status` y no uses `--force` salvo que el estado remoto haya sido inspeccionado.
Después del push, crea una versión, actualiza el deployment existente y repite la
prueba anónima de la sección 5 antes de solicitar un build de Vercel.

## 9. Recuperación simple

- Error editorial: corregir la planilla y publicar otra revisión.
- Build fallido: inspeccionar Vercel; el deployment anterior continúa servido.
- Hook expuesto: revocarlo, crear otro y actualizar Script Properties.
- Snapshot inválido: Apps Script conserva el último JSON publicado válido.
