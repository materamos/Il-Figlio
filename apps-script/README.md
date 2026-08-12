# Publicador de Google Sheets de Il Figlio

Este directorio contiene el Google Apps Script vinculado a la planilla privada
`Il Figlio — Carta`. La planilla es el editor de borradores; el web app público
sirve únicamente el último snapshot JSON validado.

Esta guía mantiene la instalación existente. El runbook canónico para validar,
subir código y operar Vercel es [Activación y operación](../docs/activation.md).
El contrato completo del snapshot está en
[Arquitectura de Il Figlio](../docs/architecture.md).

## Instalación existente

El repositorio ya versiona `apps-script/.clasp.json` con el `scriptId`, el
`parentId` y `rootDir` de la instalación vinculada. Esos valores son
identificadores, no credenciales, pero no deben reemplazarse durante una
actualización normal.

- No crees otra planilla ni ejecutes `clasp create-script` para mantener esta
  instalación.
- No copies `.clasp.json.example` sobre `.clasp.json`. El archivo de ejemplo
  muestra solamente la forma mínima de una configuración para una recuperación
  autorizada desde cero.
- Nunca agregues `.clasprc.json`, tokens, Deploy Hooks ni credenciales al
  repositorio.

Antes de cualquier operación remota, verifica la identidad del perfil local:

```powershell
npx clasp --user ilfiglio show-authorized-user
```

La salida debe corresponder a `ilfigliodev@gmail.com`. Desde la raíz del
repositorio, usa los comandos `npm run apps-script:*`, que apuntan de forma
explícita a `apps-script/.clasp.json`:

```powershell
npm run apps-script:status
npm run apps-script:open
npm run apps-script:deployments
```

`apps-script:status` muestra los archivos locales que clasp enviaría; no es una
comparación completa contra posibles ediciones hechas en el editor remoto. El
repositorio es la fuente de verdad del código. No hagas cambios de código en el
editor remoto.

## Editor y contrato editorial

`setupProject` y `upgradeSheetExperience` preparan las pestañas `Publicar`,
`Local`, `Clásicas`, `Rellenas`, `Gourmet`, `Empanadas` y `Extras`; instalan los
triggers de edición, cambios estructurales y verificación cada cinco minutos; y
guardan el ID de la planilla en Script Properties.

En una planilla completamente vacía, el bootstrap carga los 24 productos
iniciales y deja `Local!B2` en `Abierto`. Antes de la primera publicación es
obligatorio revisar ese estado, el mensaje público y todos los precios. No
publiques el valor inicial si no representa la situación real del negocio.

### Columnas por categoría

Todas las tablas terminan con `Mostrar`, `Descripción` y una columna interna
`_id`. `_id` permanece oculta y el script la crea o repara automáticamente.

| Pestaña | Columnas visibles | Price kinds del snapshot | Etiquetas públicas |
| --- | --- | --- | --- |
| `Clásicas` | `Producto`, `Entera`, `Porción`, `Mostrar`, `Descripción` | `whole`, `slice` | `Grande`, `Porción` |
| `Rellenas` | `Producto`, `Entera`, `Mostrar`, `Descripción` | `whole` | `Grande` |
| `Gourmet` | `Producto`, `Entera`, `Mostrar`, `Descripción` | `whole` | `Grande` |
| `Empanadas` | `Producto`, `Unidad`, `Mostrar`, `Descripción` | `unit` | `Unidad` |
| `Extras` | `Producto`, `Porción`, `Mostrar`, `Descripción` | `portion` | `Porción` |

`Entera` en la planilla y `Grande` en el sitio representan el mismo price kind
interno: `whole`.

### Reglas de validación

- La posición de la fila define el orden dentro de la categoría.
- `Mostrar` debe ser una casilla. Una fila nueva con la casilla vacía o
  desmarcada queda como borrador y no entra en el snapshot.
- Un producto visible requiere nombre y todos los precios permitidos para su
  categoría.
- El nombre admite hasta 80 caracteres y la descripción hasta 240.
- Los precios son importes enteros positivos en pesos argentinos: sin centavos
  y sin escribir separadores de miles.
- Dos productos visibles de la misma categoría no pueden tener el mismo nombre
  después de normalizar mayúsculas y minúsculas.
- Al editar o publicar, el script recorta extremos, colapsa espacios, pasa el
  nombre a minúsculas salvo la primera letra y conserva abreviaturas con puntos
  en mayúsculas. Por ejemplo, `fugazza CON MOZZARELLA` pasa a
  `Fugazza con mozzarella` y `c.b.o` pasa a `C.B.O`.
- `Local!B2` admite únicamente `Abierto`, `Cerrado` o `Agotado`.
- `Local!B3` es opcional y admite hasta 160 caracteres.

El menú `Il Figlio` de la planilla expone solamente `Publicar cambios` y
`Restaurar formato`. `Restaurar formato` vuelve a aplicar encabezados,
validaciones, formatos y columnas ocultas; también normaliza nombres y repara
IDs. No restaura productos, precios, pestañas eliminadas, triggers, backups ni
deployments.

## Publicación

1. Edita las categorías y `Local`.
2. En `Publicar`, marca `Publicar cambios` (`B2`) una sola vez.
3. Apps Script normaliza los nombres, repara IDs y valida todo el borrador.
4. Si es válido, crea la siguiente revisión, actualiza el snapshot y solicita
   un build mediante el Deploy Hook.
5. El verificador consulta `/publication.json` hasta encontrar exactamente la
   revisión y el hash esperados.

Una respuesta 2xx del Deploy Hook solo confirma que Vercel aceptó la solicitud.
La publicación termina cuando `/publication.json` confirma revisión y hash y la
planilla muestra `Menú actualizado`.

Mientras hay una revisión pendiente, una nueva publicación vuelve a solicitar
esa misma revisión. Los cambios posteriores permanecen como borrador y no
reemplazan el snapshot pendiente.

## Configuración privada y permisos

`configureProject` solicita dos valores y los guarda en Script Properties:

| Propiedad | Uso y exposición |
| --- | --- |
| `VERCEL_DEPLOY_HOOK_URL` | Solicita el build productivo. No se escribe en celdas ni se devuelve desde `doGet`. |
| `PUBLIC_SITE_URL` | Permite verificar `/publication.json`. Su valor público sí se muestra como enlace en `Publicar`. |

El manifest declara estos scopes porque el script los usa de forma directa:

| Scope | Motivo |
| --- | --- |
| `drive` | Crear y actualizar el snapshot privado y el backup de una migración legacy. |
| `script.external_request` | Llamar al Deploy Hook y consultar el recibo de publicación. |
| `script.scriptapp` | Crear y reemplazar los triggers instalables del proyecto. |
| `spreadsheets` | Leer y escribir la planilla vinculada, incluso desde el trigger periódico. |

El web app está configurado como `ANYONE_ANONYMOUS` y se ejecuta como
`USER_DEPLOYING`. La superficie HTTP implementada es solo `doGet`: devuelve
datos destinados al menú público y nunca el Deploy Hook. Los permisos anteriores
los concede y ejerce la cuenta propietaria; no convierten las demás funciones en
endpoints públicos.

## Deployment web existente

El deployment productivo debe conservar su URL `/exec`. Para una actualización
normal no ejecutes `create-deployment`: crearías otro deployment y otra URL.

Sigue completa la sección **Actualizar Apps Script** del
[runbook canónico](../docs/activation.md#10-actualizar-apps-script). Allí están el
orden de tests, inspección de archivos, push, creación de versión, actualización
del deployment existente y verificación anónima. No uses una secuencia abreviada
copiada de este README.

Después de actualizar, la URL existente debe responder sin cookies ni sesión:

```powershell
curl.exe --location --fail-with-body --silent --show-error "https://script.google.com/macros/s/DEPLOYMENT_ID/exec?check=UNIX_MS"
```

La respuesta debe ser JSON no vacío, no una pantalla de login. El ID del ejemplo
es un marcador; obtén el deployment real mediante el procedimiento autorizado y
no lo inventes.

## Backups y límites de recuperación

Según el camino de instalación, puede haber hasta dos archivos Drive con
finalidades distintas:

- Al migrar el editor legacy, `setupProject` crea una exportación JSON única con
  nombre `il-figlio-sheet-v1-backup-<timestamp>.json` y guarda su ID en
  `SHEET_V1_BACKUP_FILE_ID`. Después verifica que el editor nuevo produzca la
  misma carta canónica.
- En la primera publicación válida se crea `published-menu.json`; las
  publicaciones siguientes actualizan ese mismo archivo. Es una copia de la
  última revisión preparada por Apps Script, no un historial de revisiones ni
  una prueba de que Vercel ya la sirve.

Las pestañas legacy quedan ocultas con protección de **solo advertencia**. Esa
protección no impide que una persona con acceso las edite o elimine. No las
modifiques y no borres los archivos Drive ni sus Script Properties.

La copia servida se guarda en dos slots fragmentados de Script Properties. El
script escribe y verifica el slot inactivo antes de mover el puntero activo, de
modo que una escritura parcial no sustituye el snapshot servido. Estos límites
siguen vigentes:

- `doGet` no recupera automáticamente desde Drive ni prueba el slot anterior si
  el slot activo se corrompe después de activarse;
- un `SNAPSHOT_FILE_ID` que apunte a un archivo eliminado bloquea una nueva
  publicación hasta una reparación administrativa;
- el backup legacy no tiene importador ni botón de restauración;
- `Restaurar formato` no es una restauración de datos;
- recuperar datos, cambiar `.clasp.json`, reemplazar variables de Vercel o
  promover otro deployment requiere autorización y verificación explícitas.

## Ensayo de restauración

Ensaya la recuperación fuera de producción y sin cambiar el vínculo versionado:

1. Si existe `SHEET_V1_BACKUP_FILE_ID`, confirma que el archivo indicado puede
   abrirse con la cuenta propietaria y contiene `Carta`, `Estado` y `Publicacion`.
   Si la propiedad no existe porque nunca hubo una migración legacy, detén este
   ensayo: primero prepara una exportación o copia autorizada de la planilla
   actual. Si ya hubo una publicación, confirma también que
   `published-menu.json` existe y contiene JSON no vacío.
2. Crea una planilla descartable y un Apps Script separado, sin Deploy Hook ni
   variables productivas. No reemplaces `apps-script/.clasp.json` en el checkout
   habitual.
3. Reconstruye en la planilla descartable las tres pestañas legacy usando las
   matrices del backup JSON, preservando valores, tipos y orden de filas.
4. Carga en el proyecto aislado la misma revisión de código del repositorio y
   ejecuta `setupProject`. La migración debe finalizar y su comprobación de
   igualdad canónica no debe informar diferencias.
5. Ejecuta `validateDraft` desde el editor de Apps Script. Verifica que no haya
   errores y compara categorías, productos visibles, precios, estado y mensaje
   con el origen respaldado.
6. No ejecutes `configureProject` con el hook productivo y no publiques la copia.
   Conserva la evidencia del resultado y fecha del ensayo fuera del repositorio.

Este ensayo demuestra que el backup puede reconstruir el contrato editorial;
no autoriza por sí solo a reemplazar la planilla, el script o el deployment de
producción.

## Recuperación excepcional desde cero

Esta ruta no forma parte del mantenimiento normal. Úsala solo si la planilla o
el Apps Script existentes fueron declarados irrecuperables y existe autorización
para crear nuevos recursos y cambiar los vínculos de producción.

1. Preserva primero todo recurso sobreviviente: planilla, código remoto,
   versiones, deployments, snapshots, backups y configuración de Vercel.
2. Trabaja en una copia aislada del repositorio. No borres ni sobrescribas el
   `.clasp.json` productivo para obtener un nuevo ID.
3. Habilita la Apps Script API para la cuenta propietaria si fuera necesario y
   verifica nuevamente el perfil nombrado antes de crear recursos. Crea la nueva
   planilla y un Apps Script vinculado. `.clasp.json.example` sirve únicamente
   para comprobar la forma mínima del archivo; completa la configuración
   aislada con los identificadores reales generados por Google.
4. Sube el código usando el runbook canónico, ejecuta `setupProject`, revisa el
   valor inicial `Abierto` y valida el contenido antes de configurar publicación.
5. Ejecuta `configureProject` solo con el hook y el origen aprobados para el
   entorno recuperado.
6. Crea un único web-app deployment que se ejecute como la cuenta propietaria y
   permita acceso anónimo. Guarda su URL `/exec` como `MENU_SNAPSHOT_URL` en el
   entorno correspondiente y compruébala sin sesión.
7. Realiza la
   [aceptación reversible](../docs/activation.md#8-aceptación-reversible) antes de
   cambiar tráfico o retirar la instalación anterior.

No reutilices IDs, URLs ni secretos de ejemplos. La sustitución de recursos de
producción es una operación separada y debe conservar un camino de vuelta hasta
que la nueva publicación esté verificada de extremo a extremo.

## Contrato del snapshot

El web app implementa solamente `GET`. La copia servida se almacena en chunks
base64 con tamaño limitado en Script Properties; el endpoint expone únicamente
datos destinados al sitio público.

El esquema de red es `schema_version: 1`. `source_hash` es el SHA-256 del UTF-8
producido por `JSON.stringify` para el objeto canónico con las claves
`schema_version`, `revision`, `currency`, `business` y `categories`, en ese
orden. `published_at` y `source_hash` no forman parte de la entrada del hash.
