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

Después del primer push, ejecuta `setupProject` una vez desde el editor de Apps Script. Esta función:

- crea o normaliza `Carta`, `Estado` y `Publicacion`;
- instala el trigger de publicación por edición;
- instala el verificador periódico;
- solicita los permisos mínimos necesarios.

El archivo de snapshot se crea en Drive al preparar la primera publicación válida.

## 4. Configuración privada

En Apps Script, define estas Script Properties:

| Propiedad | Valor |
| --- | --- |
| `VERCEL_DEPLOY_HOOK_URL` | Hook asociado a la rama productiva. |
| `PUBLIC_SITE_URL` | Origen del sitio, por ejemplo `https://il-figlio.vercel.app`, sin ruta. |
| `SNAPSHOT_FILE_ID` | Creada automáticamente durante la primera publicación válida. |

El hook nunca se escribe en una celda ni se devuelve desde `doGet`.

## 5. Web app JSON

Despliega el proyecto como web app:

- ejecutar como la cuenta propietaria;
- acceso público de solo lectura;
- entrada única `doGet`;
- sin `doPost`.

Guarda la URL `/exec` resultante como `MENU_SNAPSHOT_URL` en Vercel.

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

1. Cambiar un precio en `Carta`.
2. Activar `Publicar cambios` en `Publicacion!B2`.
3. Confirmar que la planilla muestra una revisión pendiente.
4. Esperar un deployment Vercel `READY`.
5. Abrir `/publication.json` y comprobar revisión y hash.
6. Confirmar que la planilla cambia a `Publicado`.
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

## 9. Recuperación simple

- Error editorial: corregir la planilla y publicar otra revisión.
- Build fallido: inspeccionar Vercel; el deployment anterior continúa servido.
- Hook expuesto: revocarlo, crear otro y actualizar Script Properties.
- Snapshot inválido: Apps Script conserva el último JSON publicado válido.
