# Activación, operación y recuperación

Este runbook describe el entorno activo Google Sheets, Apps Script y Vercel de
Il Figlio. Nunca pegues tokens, URLs de Deploy Hooks, credenciales ni copias de
`.env.local` en archivos versionados, issues, PRs o registros de operación.

La propiedad de cuentas, la aceptación y el handoff se mantienen en el runbook
privado `00 Administracion/Operacion/runbook-operativo.md`. En una máquina
configurada, `docs/project-context.local.md` permite ubicar la biblioteca
documental sin versionar una ruta absoluta. El runbook anterior de Supabase es
solo histórico y vive bajo `90 Archivo/Operacion/`.

## Parte I: activación

### 1. Preparar y validar el checkout

Comprueba primero que no haya trabajo ajeno. Instala exactamente el lockfile:

```powershell
git status --short
npm ci
```

Si `.env.local` ya existe, conserva una copia privada fuera del repositorio
antes de editarlo o sustituirlo. Si no existe, parte de `.env.example`:

```powershell
$envBackupRoot = Join-Path $env:LOCALAPPDATA "IlFiglio\env-backups"
if (Test-Path -LiteralPath ".env.local") {
  New-Item -ItemType Directory -Force -Path $envBackupRoot | Out-Null
  $envBackupPath = Join-Path $envBackupRoot ("env-local-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".backup")
  Copy-Item -LiteralPath ".env.local" -Destination $envBackupPath
  Write-Output "Copia privada guardada en: $envBackupPath"
} else {
  Copy-Item -LiteralPath ".env.example" -Destination ".env.local"
}
```

La copia puede contener información privada. No la compartas ni la uses como
archivo de configuración permanente; elimínala cuando la recuperación ya no
sea necesaria.

Ejecuta las validaciones locales. Las variables de la sesión fuerzan un build
con fixture y prevalecen sobre `.env.local`, sin editarlo:

```powershell
npm run check
npm run check:js
npm run lint
npm test
$env:MENU_DATA_SOURCE = "fixture"
$env:ALLOW_FIXTURE_BUILD = "true"
$env:PUBLIC_SITE_URL = "https://il-figlio.example.test"
npm run build
git status --short
```

No continúes si falla un comando o aparecen cambios versionados inesperados.

### 2. Autenticar `clasp`

Habilita Apps Script API en la cuenta propietaria y autentica una identidad
local con nombre explícito:

```powershell
npx clasp --user ilfiglio login
npx clasp --user ilfiglio show-authorized-user
```

La segunda salida debe indicar la cuenta operativa autorizada. En la
configuración vigente es `ilfigliodev@gmail.com`; antes de una transferencia,
contrástala con el runbook privado. Las credenciales se guardan en el perfil
local, no en este repositorio.

### 3. Confirmar el proyecto y capturar el remoto

El vínculo está en `apps-script/.clasp.json` y el código versionado vive en
`apps-script/src/`. Verifica que el vínculo corresponda al recurso autorizado,
sin copiar su identificador a documentación ni registros públicos.

`npm run apps-script:status` solo muestra qué archivos locales incluiría
`clasp`; no consulta el contenido remoto y no demuestra que ambos lados sean
iguales.

Antes del primer push de una sesión, trae el remoto a una carpeta aislada. Así
la comparación no puede sobrescribir `apps-script/src/`:

```powershell
$claspBackupRoot = Join-Path $env:LOCALAPPDATA "IlFiglio\apps-script-backups"
$claspBackupPath = Join-Path $claspBackupRoot (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $claspBackupPath | Out-Null
Copy-Item -LiteralPath "apps-script/.clasp.json" -Destination (Join-Path $claspBackupPath ".clasp.json")
Copy-Item -LiteralPath "apps-script/.claspignore" -Destination (Join-Path $claspBackupPath ".claspignore")
npx clasp --user ilfiglio --project (Join-Path $claspBackupPath ".clasp.json") --ignore (Join-Path $claspBackupPath ".claspignore") pull
git diff --no-index -- "apps-script/src" (Join-Path $claspBackupPath "src")
```

`git diff --no-index` devuelve código de salida `1` cuando encuentra diferencias;
eso no es un fallo de lectura. Revisa cada diferencia. Si el remoto contiene
cambios que no están en Git, detén el push, identifica su procedencia y
reconcílialos de forma explícita. Conserva la captura como respaldo privado
durante la actualización; no la agregues al repositorio.

### 4. Preparar Apps Script y la planilla

Solo después de validar y autorizar la versión local:

```powershell
npm run apps-script:status
npm run apps-script:push
npm run apps-script:open
```

Después del primer push, ejecuta `setupProject` una vez desde el editor de Apps
Script. En una instalación existente, `upgradeSheetExperience` realiza la misma
preparación. Estas funciones:

- crean el editor móvil `Publicar`, `Local`, `Clásicas`, `Rellenas`, `Gourmet`,
  `Empanadas` y `Extras`;
- migran el esquema anterior solo después de guardar un respaldo privado y
  comprobar que la carta resultante sea idéntica;
- conservan las pestañas anteriores protegidas y ocultas para recuperación;
- instalan los triggers de edición, cambios estructurales y verificación
  periódica;
- solicitan los permisos declarados en el manifiesto.

El menú diario `Il Figlio` muestra `Publicar cambios` y `Restaurar formato`.
Esta última acción restaura formato y controles, no productos, precios ni
contenido borrado. La validación del borrador se ejecuta automáticamente al
publicar.

El archivo privado del snapshot se crea en Drive durante la primera publicación
válida. La copia servida por el web app se guarda fragmentada en Script
Properties para evitar lecturas parciales.

### 5. Configurar propiedades privadas

Ejecuta `configureProject` desde el editor para definir estas Script Properties:

| Propiedad | Valor |
| --- | --- |
| `VERCEL_DEPLOY_HOOK_URL` | Hook asociado a la rama productiva. |
| `PUBLIC_SITE_URL` | Origen del sitio, por ejemplo `https://il-figlio.vercel.app`, sin ruta. |

`SNAPSHOT_FILE_ID` es interna y se crea automáticamente durante la primera
publicación válida. No la definas manualmente. El hook nunca se escribe en una
celda ni se devuelve desde `doGet`; la URL pública sí se muestra como enlace de
operación en `Publicar`.

### 6. Crear la web app JSON

Despliega el proyecto como web app:

- ejecutar como la cuenta propietaria;
- acceso público de solo lectura;
- entrada única `doGet`;
- sin `doPost`.

Guarda la URL `/exec` como `MENU_SNAPSHOT_URL` en Vercel. Las actualizaciones
posteriores deben reutilizar el mismo deployment para conservar su URL:

```powershell
npx clasp --user ilfiglio --project apps-script/.clasp.json create-version "Descripción"
npx clasp --user ilfiglio --project apps-script/.clasp.json update-deployment DEPLOYMENT_ID --versionNumber VERSION
curl.exe --location --fail-with-body --silent --show-error "https://script.google.com/macros/s/DEPLOYMENT_ID/exec?check=UNIX_MS"
```

La última llamada se realiza sin cookies ni sesión y debe devolver JSON no
vacío, sin pedir login. `clasp` no prueba por sí solo el acceso anónimo. Si la
respuesta es login o `403`, corrige el deployment en la interfaz: ejecutar como
propietario y acceso `Cualquiera`.

### 7. Configurar Vercel

Conserva `npm run build` como comando de build y configura en Production:

```text
MENU_DATA_SOURCE=google_snapshot
MENU_SNAPSHOT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
PUBLIC_SITE_URL=https://il-figlio.vercel.app
```

No configures `ALLOW_FIXTURE_BUILD` en producción. Crea un único Deploy Hook
para la rama productiva y guárdalo exclusivamente como
`VERCEL_DEPLOY_HOOK_URL` dentro de Apps Script.

### 8. Aceptación reversible

La prueba de aceptación modifica contenido real. Hazla solo con autorización,
en una ventana acordada y con valores capturados para restaurarlos.

1. Registra en evidencia privada la revisión y el hash actuales de
   `/publication.json`, y los valores exactos de cada celda que se probará.
2. Crea una copia privada de la Google Sheet en Drive y confirma que puede
   abrirse. No compartas su ID ni su contenido en Git.
3. Para probar validación negativa, modifica temporalmente un único campo
   capturado de forma que sea inválido y activa `Publicar cambios`. Confirma
   `No se pudo publicar` y que `/publication.json` no cambió. Restaura la celda
   de inmediato.
4. Realiza un solo cambio editorial reversible y previamente aprobado. Publica
   una vez y espera a que `Publicar` muestre `Menú actualizado`.
5. Comprueba que `/publication.json` avanzó y que `/` y `/carta/` muestran el
   valor esperado en escritorio y móvil.
6. Restaura exactamente los valores capturados y publica otra vez. Confirma una
   nueva revisión, `Menú actualizado` y el contenido original en ambas rutas.
7. Revisa que no queden cambios de prueba ni casillas activas y registra el
   resultado sin secretos.

La revisión y `sourceHash` de la restauración no serán iguales a los iniciales,
porque la revisión forma parte del payload canónico. La confirmación final debe
comparar el contenido restaurado y la nueva revisión servida, no exigir el hash
anterior. No pruebes `Cerrado` o `Agotado` en producción salvo que ese estado
real haya sido autorizado por el negocio.

## Parte II: operación

### 9. Publicar contenido editorial

1. Edita la pestaña de categoría correspondiente; el orden de filas define el
   orden público y `Mostrar` controla la visibilidad.
2. Ajusta `Estado` o el mensaje desde `Local` solo cuando corresponda al estado
   real del negocio.
3. En `Publicar`, marca una vez `Publicar cambios`.
4. Si hay errores, corrige los campos señalados y vuelve a publicar.
5. Si la solicitud es válida, espera la confirmación automática. No hace falta
   monitorizar Vercel ni volver a marcar la casilla mientras figure
   `Publicando…`.
6. Considera finalizada la operación únicamente cuando la planilla muestre
   `Menú actualizado`; entonces verifica una muestra de `/` y `/carta/`.

Si aparece `No se pudo confirmar`, conserva la revisión pendiente, diagnostica
Vercel o el endpoint y usa la misma casilla para reintentar. Un Deploy Hook
aceptado no demuestra por sí solo que el contenido ya esté servido.

### 10. Actualizar Apps Script

1. Confirma autorización, identidad `clasp` y estado limpio del checkout.
2. Ejecuta los checks de la sección 1.
3. Captura el remoto en una carpeta aislada y compara como indica la sección 3.
4. Revisa `git diff -- apps-script/src` y `npm run apps-script:status`. Recuerda
   que el segundo comando no compara contra el remoto.
5. Ejecuta `npm run apps-script:push` solo cuando la diferencia completa esté
   explicada y autorizada. No uses `--force` para resolver divergencias.
6. Crea una versión inmutable y actualiza el deployment existente.
7. Verifica anónimamente la misma URL `/exec`.
8. Trae el remoto posterior a otra carpeta aislada y compáralo con
   `apps-script/src/`; la ausencia de diferencias confirma el HEAD editable
   remoto. No demuestra qué versión inmutable usa el deployment: esa relación
   se comprueba en la lista de deployments y la URL `/exec` se valida por
   separado.
9. Ejecuta una publicación editorial controlada solo si forma parte de la
   autorización y aplica la aceptación reversible de la sección 8.

Conserva la captura previa hasta completar la verificación. Después, aplica la
retención definida en el runbook privado; nunca la adjuntes a un issue o PR.

## Parte III: recuperación

### 11. Recuperación editorial y del snapshot

- Campo editorial incorrecto: restaura el valor capturado, publica una revisión
  correctiva y confirma contenido y revisión en `/publication.json`.
- Build fallido: el deployment productivo anterior continúa servido; corrige la
  causa antes de solicitar otro build.
- Solicitud pendiente: no edites otra vez para “destrabarla”. Espera la
  confirmación o usa el reintento de `Publicar` cuando el tablero lo indique.
- Snapshot rechazado: corrige la planilla; Apps Script no sustituye el snapshot
  servido con un borrador inválido.
- Formato dañado: usa `Restaurar formato`. No lo trates como restauración de
  datos.
- Migración de Sheet: el respaldo de esquema anterior y las pestañas legacy
  ocultas son ayudas de recuperación. No las elimines; una restauración de datos
  debe autorizarse y probarse sobre una copia antes de tocar la planilla activa.

### 12. Rollback de Apps Script

Si una versión nueva de Apps Script falla:

1. Detén nuevas publicaciones y conserva evidencia no sensible.
2. Lista las implementaciones con `npm run apps-script:deployments` e identifica
   una versión inmutable previamente verificada.
3. Con autorización, apunta el deployment existente a esa versión; no crees una
   URL nueva:

   ```powershell
   npm run apps-script:update-deployment -- DEPLOYMENT_ID --versionNumber PREVIOUS_VERSION
   ```

4. Verifica la URL `/exec` anónimamente y confirma que el snapshot esperado se
   sigue sirviendo.
5. Recupera el código fuente desde Git o desde la captura remota previa, compara
   cada archivo y somételo otra vez a checks y revisión antes de un nuevo push.
   No copies ciegamente el respaldo sobre el checkout ni uses `--force`.

El rollback no termina hasta que la URL pública, el endpoint `/exec` y una
publicación controlada autorizada hayan sido comprobados.

### 13. Credenciales, entorno y servicios

- `.env.local` perdido o dañado: restaura la copia privada fuera de Git,
  comprueba sus permisos y ejecuta la validación local antes de borrar el
  respaldo.
- Deploy Hook expuesto: revócalo, crea otro, actualiza
  `VERCEL_DEPLOY_HOOK_URL` en Script Properties y prueba el flujo completo. No
  registres ninguna de las URLs.
- Credenciales `clasp` comprometidas: revoca la autorización desde Google,
  autentica de nuevo la identidad aprobada y verifica el usuario antes de usar
  comandos remotos.
- Pérdida o transferencia de cuentas: sigue el inventario y la secuencia del
  runbook privado. No recrees recursos con IDs nuevos hasta confirmar propiedad,
  backups y URLs públicas que deben preservarse.

Registra fecha, responsable, alcance, revisión anterior y posterior, resultado y
evidencia no sensible. Las acciones remotas de recuperación requieren
autorización explícita.
