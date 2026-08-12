# Arquitectura de Il Figlio

## Objetivo

Il Figlio es una landing y carta QR estática para una sola sucursal. El alcance
editorial es deliberadamente pequeño: nombres, descripciones, precios,
visibilidad, orden y un estado global del negocio.

No es un ecommerce y no mantiene inventario ni disponibilidad por producto.
Los pedidos se coordinan por WhatsApp.

## Componentes y flujo

```text
Editor -> Google Sheet privada -> Apps Script -> snapshot JSON público
                                      |                  |
                                      +-> Deploy Hook    +-> Astro build
                                                             |
                                                             v
                                                     Vercel estático
```

| Componente | Responsabilidad |
| --- | --- |
| Google Sheet | Fuente editorial, borrador y superficie de publicación. |
| Apps Script | Validación, revisión, hash, snapshot, solicitud de deploy y confirmación. |
| Web app de Apps Script | Lectura pública del snapshot activo mediante `GET`; no implementa `POST`. |
| Astro | Segunda validación y generación estática de landing, carta y metadata. |
| Vercel | Build, artefactos inmutables y hosting. |

La navegación pública no depende de Google: Astro incorpora el snapshot al
artefacto durante el build. Google y el Deploy Hook participan únicamente en el
flujo editorial y de construcción.

## Límites de confianza

- La autorización editorial depende de los permisos de Google. Toda identidad
  con permiso de edición sobre la planilla puede modificar el borrador y activar
  `Publicar cambios`; no existe una capa adicional de roles de la aplicación.
- Apps Script tiene permisos de Drive, Sheets, llamadas externas y gestión de
  triggers. El web app es anónimo, pero se ejecuta como la cuenta que lo
  despliega; `doGet` debe seguir limitado a devolver el snapshot público.
- `VERCEL_DEPLOY_HOOK_URL` es un secreto de publicación. Vive en Script
  Properties y nunca se escribe en la planilla, en el endpoint público ni en el
  artefacto estático.
- `PUBLIC_SITE_URL` no es secreto. Vive en Script Properties y también se copia
  a la pestaña `Publicar` para ofrecer el enlace `Abrir menú`.
- `MENU_SNAPSHOT_URL` identifica una fuente pública, pero se consume solo en el
  build y se excluye del artefacto. Cambiar esta variable o `PUBLIC_SITE_URL` es
  una operación privilegiada de configuración. En producción el código exige
  HTTPS, pero no fija un hostname concreto.
- `source_hash` verifica que el contenido recibido y el contenido confirmado
  sean idénticos. Es un hash sin clave, no una firma ni una prueba de quién
  autorizó el contenido.

## Contrato publicado

Todos los campos del siguiente ejemplo son estructuralmente obligatorios. El
ejemplo es una instancia válida del esquema `1`; incluye una fila por categoría
para mostrar todos los modelos de precio permitidos.

```json
{
  "schema_version": 1,
  "revision": 1,
  "published_at": "2026-08-12T00:00:00.000Z",
  "source_hash": "0d87292da13a18c0ed6750f4c0d5bf70dc002f71130631e99539475c71b64502",
  "currency": "ARS",
  "business": {
    "status": "open",
    "message": ""
  },
  "categories": [
    {
      "code": "classic",
      "title": "Pizzas clásicas",
      "order_index": 10,
      "price_kinds": ["whole", "slice"],
      "items": [
        {
          "id": "clasica-mozzarella",
          "category_code": "classic",
          "name": "Mozzarella",
          "description": "Salsa de tomate, mozzarella, orégano o albahaca y aceitunas.",
          "order_index": 1,
          "prices": {
            "whole": 14000,
            "slice": 2500
          }
        }
      ]
    },
    {
      "code": "filled",
      "title": "Pizzas rellenas",
      "order_index": 20,
      "price_kinds": ["whole"],
      "items": [
        {
          "id": "rellena-fugazzeta",
          "category_code": "filled",
          "name": "Fugazzeta",
          "description": "Mozzarella, cebolla, queso parmesano, orégano, aceite de oliva y aceitunas.",
          "order_index": 1,
          "prices": {
            "whole": 24000
          }
        }
      ]
    },
    {
      "code": "gourmet",
      "title": "Pizzas gourmet",
      "order_index": 30,
      "price_kinds": ["whole"],
      "items": [
        {
          "id": "gourmet-jamon-crudo",
          "category_code": "gourmet",
          "name": "Jamón crudo",
          "description": "Salsa de tomate, mozzarella, jamón crudo, orégano y aceitunas.",
          "order_index": 1,
          "prices": {
            "whole": 21000
          }
        }
      ]
    },
    {
      "code": "empanadas",
      "title": "Empanadas",
      "order_index": 40,
      "price_kinds": ["unit"],
      "items": [
        {
          "id": "empanada-carne",
          "category_code": "empanadas",
          "name": "Carne",
          "description": null,
          "order_index": 1,
          "prices": {
            "unit": 2800
          }
        }
      ]
    },
    {
      "code": "extras",
      "title": "Extras",
      "order_index": 50,
      "price_kinds": ["portion"],
      "items": [
        {
          "id": "faina",
          "category_code": "extras",
          "name": "Fainá",
          "description": null,
          "order_index": 1,
          "prices": {
            "portion": 1200
          }
        }
      ]
    }
  ]
}
```

Reglas estructurales y semánticas:

- `schema_version` debe ser `1`; `revision` debe ser un entero seguro positivo;
  `currency` debe ser `ARS`.
- `published_at` debe ser una fecha ISO 8601 UTC normalizada, con milisegundos y
  sufijo `Z`.
- `business.status` admite `open`, `closed` o `sold_out`.
  `business.message` es un campo requerido de tipo string: su contenido es
  semánticamente opcional, por lo que puede ser `""`; no puede tener espacios
  exteriores ni superar 160 caracteres.
- `categories` contiene exactamente `classic`, `filled`, `gourmet`,
  `empanadas` y `extras`, en ese orden y con los títulos, órdenes y
  `price_kinds` del ejemplo. Las categorías no son editables.
- `items` es requerido en cada categoría y puede estar vacío. Solo contiene
  productos cuya casilla `Mostrar` está activa; los borradores ocultos permanecen
  en la planilla.
- Cada ítem requiere un `id` único y estable en kebab-case o UUID,
  `category_code` igual al de su categoría, nombre no vacío, orden entero
  positivo y único dentro de la categoría, y exactamente los precios permitidos.
- `description` es un campo requerido cuyo valor puede ser un string no vacío o
  `null`. Los importes son enteros positivos expresados en pesos argentinos, no
  centavos.
- El editor de Apps Script limita el nombre a 80 caracteres y la descripción a
  240, y rechaza nombres visibles duplicados dentro de una categoría. Son reglas
  del publicador; el parser de Astro no repite esos tres controles.

## Canonicalización y hash

Apps Script y Astro construyen antes de calcular el hash el mismo objeto, con
estas propiedades y en este orden:

```text
schema_version, revision, currency, business, categories
```

Dentro de `business` el orden es `status, message`; dentro de cada categoría es
`code, title, order_index, price_kinds, items`; dentro de cada ítem es
`id, category_code, name, description, order_index, prices`. `prices` conserva
solo las claves presentes y las ordena como `whole, slice, unit, portion`.
Los arrays conservan su orden.

El texto canónico es el resultado compacto de `JSON.stringify`, codificado en
UTF-8. `source_hash` es su SHA-256 representado por exactamente 64 caracteres
hexadecimales en minúsculas. `published_at` y `source_hash` no forman parte del
objeto hasheado.

Apps Script calcula el hash al publicar. Astro reconstruye el objeto canónico,
recalcula el hash y aborta si no coincide antes de generar las páginas.

## Publicación y consistencia

- Apps Script intenta adquirir un bloqueo global durante hasta 30 segundos para
  serializar validación, publicación y confirmación.
- Si existe una revisión pendiente, una nueva solicitud vuelve a pedir el deploy
  de esa misma revisión. Los cambios posteriores de la planilla permanecen como
  borrador y no reemplazan el snapshot pendiente.
- Una publicación nueva valida el borrador completo, crea la revisión y escribe
  primero una copia privada de recuperación en Drive.
- La copia servida se codifica en base64 y se escribe fragmentada en el slot
  inactivo de Script Properties. Apps Script comprueba cantidad, longitud y hash
  de los fragmentos antes de mover `SNAPSHOT_ACTIVE_SLOT`.
- `doGet` no adquiere el lock: durante una actualización que ya tiene un slot
  activo sirve esa copia anterior y nunca el slot inactivo incompleto. En la
  primera publicación todavía no existe una copia anterior y responde
  `snapshot_not_published` hasta que se activa el primer slot válido.
- Solo después de guardar el snapshot se registra la revisión pendiente y se
  llama al Deploy Hook. Una respuesta HTTP exitosa del hook significa
  solicitud aceptada, no publicación confirmada.
- Astro memoiza una sola promesa de lectura durante el build, por lo que `/`,
  `/carta/` y `/publication.json` se generan desde la misma revisión.
- `/publication.json` devuelve `schemaVersion`, `revision`, `sourceHash` y
  `builtAt`. Apps Script confirma una publicación únicamente si versión,
  revisión y hash coinciden y `builtAt` es una fecha válida.

## Límites, reintentos y confirmación

- Apps Script divide la copia pública en fragmentos de hasta 7000 caracteres y
  rechaza snapshots cuya representación base64 supera 180000 caracteres.
- Astro acepta como máximo 512 KiB de respuesta y espera hasta 30 segundos por
  intento.
- Astro realiza como máximo tres intentos. Reintenta errores de transporte,
  timeouts y respuestas HTTP `404`, `408`, `429` o `5xx`, con esperas de uno y
  dos segundos. Un tipo de contenido incorrecto, JSON inválido, tamaño excesivo,
  contrato inválido o hash incorrecto falla sin reintento.
- El trigger de verificación consulta `/publication.json` cada cinco minutos.
  Después de quince minutos sin coincidencia, la planilla muestra que no pudo
  confirmar; la revisión continúa pendiente y `Publicar cambios` permite volver
  a solicitar el mismo deploy.

## Disponibilidad y recuperación

- La web pública ya construida no consulta Google ni otro backend. Una caída de
  Google, un snapshot inválido o un build fallido no reemplazan el deployment
  productivo anterior.
- Drive es una copia privada de recuperación, no la fuente leída por `doGet`.
  Ante una revisión pendiente que no esté disponible en Script Properties, un
  reintento de publicación intenta restaurarla desde Drive y, si hace falta,
  reconstruirla desde el borrador solo cuando conserva el hash esperado.
- La lectura normal usa exclusivamente el slot señalado por
  `SNAPSHOT_ACTIVE_SLOT`; durante la migración también admite el formato legado.
  No cae automáticamente al slot A/B inactivo ni a Drive si el slot activo está
  corrupto.
- Si no existe una copia activa válida, `doGet` responde JSON con
  `{"error":"snapshot_not_published"}` y estado HTTP `200`. Astro lo rechaza y
  el build falla; la recuperación requiere corregir la fuente o reintentar la
  publicación.

## Superficie pública

El sitio contiene HTML, CSS, fuentes, imágenes, JSON de confirmación y
JavaScript local de navegación. No expone el Deploy Hook ni
`MENU_SNAPSHOT_URL`, y no realiza lecturas de Google durante una visita.

`/publication.json` lleva `Cache-Control: no-store` y permite distinguir entre
deploy solicitado y revisión efectivamente servida. El snapshot de Apps Script
también es público porque contiene únicamente información destinada a la carta.

## Entorno

| Variable | Uso |
| --- | --- |
| `MENU_DATA_SOURCE` | Fuente requerida por el build oficial: `fixture` o `google_snapshot`. |
| `ALLOW_FIXTURE_BUILD` | Opt-in exigido para fixture en entornos no productivos. |
| `MENU_SNAPSHOT_URL` | Endpoint de solo lectura requerido para `google_snapshot`; HTTPS en producción. |
| `PUBLIC_SITE_URL` | URL canónica y origen consultado por el verificador; HTTPS y requerida en producción. |

La prohibición del fixture productivo vive en `npm run build`, que ejecuta la
validación de entorno antes de Astro. Vercel debe conservar ese comando: invocar
`astro build` directamente omite ese guard. `verify-dist-secrets` comprueba al
final que el artefacto no contenga el endpoint del snapshot, el Deploy Hook ni
otros marcadores privados.

## Fuera de alcance

- Autenticación o panel administrativo propio.
- Disponibilidad por producto.
- Inventario, pedidos, pagos o delivery.
- Roles y gestión de usuarios dentro de la aplicación.
- Categorías editables.
- Imágenes por producto.
- Escrituras desde el navegador público.
