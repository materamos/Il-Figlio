# Arquitectura de Il Figlio

## Objetivo

Il Figlio es una landing y carta QR estática para una sola sucursal. El alcance editorial es deliberadamente pequeño: nombres, descripciones, precios, visibilidad, orden y un estado global del negocio.

No es un ecommerce y no mantiene inventario ni disponibilidad por producto. Los pedidos se coordinan por WhatsApp.

## Componentes

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
| Google Sheet | Fuente editorial y superficie de publicación. |
| Apps Script | Validación, revisión, hash, snapshot y solicitud de deploy. |
| Web app de Apps Script | Lectura pública del último snapshot válido mediante `GET`. |
| Astro | Segunda validación y generación estática de landing, carta y metadata. |
| Vercel | Build, artefactos inmutables y hosting. |

## Contrato publicado

El web app expone un JSON con este contrato:

```json
{
  "schema_version": 1,
  "revision": 1,
  "published_at": "2026-08-11T00:00:00.000Z",
  "source_hash": "sha256-hex",
  "currency": "ARS",
  "business": {
    "status": "open",
    "message": ""
  },
  "categories": []
}
```

Estados válidos: `open`, `closed` y `sold_out`. El mensaje es opcional y admite hasta 160 caracteres.

Las categorías y sus modelos de precio permanecen fijos en código. El snapshot incluye únicamente productos con `visible = Sí`. Cada producto conserva un ID estable, un orden positivo dentro de su categoría y exactamente los tipos de precio permitidos.

`source_hash` es SHA-256 hexadecimal de la representación canónica de:

```text
{ schema_version, revision, currency, business, categories }
```

Apps Script calcula el hash al publicar y Astro lo vuelve a calcular antes del build.

## Consistencia

- Apps Script usa un bloqueo global para impedir publicaciones simultáneas.
- Mientras una revisión está pendiente no se acepta otra publicación.
- El snapshot se sustituye solo después de validar la planilla completa.
- Apps Script conserva una copia privada en Drive y sirve una copia fragmentada
  desde Script Properties.
- La copia usa dos slots: se escribe y verifica el inactivo antes de cambiar el
  puntero público. `doGet` no espera el lock y nunca observa una escritura parcial.
- Astro memoiza una sola lectura durante el build, por lo que `/`, `/carta/` y `/publication.json` usan la misma revisión.
- Un snapshot inválido, demasiado grande, lento o con hash incorrecto aborta el build.
- Un build fallido no reemplaza el deployment productivo anterior.

## Superficie pública

La web pública contiene únicamente HTML, CSS, fuentes, imágenes y JavaScript local de navegación. No consulta Google ni otro backend durante la visita.

`/publication.json` contiene la revisión, el hash y la hora del build. Apps Script lo usa para distinguir entre deploy solicitado y revisión efectivamente servida.

## Entorno

| Variable | Uso |
| --- | --- |
| `MENU_DATA_SOURCE` | `fixture` o `google_snapshot`. |
| `ALLOW_FIXTURE_BUILD` | Opt-in para fixture en entornos no productivos. |
| `MENU_SNAPSHOT_URL` | Endpoint de solo lectura consumido durante el build. |
| `PUBLIC_SITE_URL` | URL canónica del sitio; HTTPS en producción. |

El Deploy Hook y la URL pública del sitio se guardan en Script Properties de Apps Script, no como celdas de la planilla.

## Fuera de alcance

- Autenticación o panel administrativo propio.
- Disponibilidad por producto.
- Inventario, pedidos, pagos o delivery.
- Roles y gestión de usuarios.
- Categorías editables.
- Imágenes por producto.
- Escrituras desde el navegador público.
