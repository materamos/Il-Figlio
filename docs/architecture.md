# Arquitectura de Il Figlio

## Objetivo

Il Figlio es una carta QR de una sola sucursal con una landing integrada. Su panel privado permite que una única persona agregue, edite, archive y restaure sabores, cambie precios y actualice disponibilidad. No es un ecommerce: los pedidos se cierran principalmente por WhatsApp al `+54 9 11 4409-7322`.

La arquitectura reutiliza las garantías que funcionaron en El Faraón sin trasladar su complejidad de sedes, roles, menú del día ni publicación multicatálogo.

## Componentes

```text
Admin privado ──RPC autenticada──> Supabase editorial
      │                                  │
      ├── disponibilidad/estado ──> contrato runtime público ──> navegador
      │                                  │
      └── publicar ──> Edge Function ──> Deploy Hook ──> Vercel/Astro
                                                        │
Supabase editorial ──snapshot transaccional de build───┘
```

| Componente | Responsabilidad |
| --- | --- |
| Astro estático | Landing, contenido indexable, carta, admin y fallback sin JavaScript. |
| Supabase Postgres | Contenido editorial, precios, disponibilidad, estado, autorización y revisiones. |
| Supabase Auth | Sesión del único usuario autorizado; registro público deshabilitado. |
| Edge Function | Valida al usuario y solicita una publicación sin exponer el Deploy Hook. |
| Vercel | Genera y sirve el artefacto estático, aplica headers y redirects. |

## Dos ritmos de actualización

### Editorial: requiere publicación

Incluye altas, nombres, descripciones, precios, archivos y restauraciones. Cada transacción incrementa la revisión de contenido. El administrador distingue con claridad entre “guardado” y “publicado”; el botón de publicación solicita un nuevo build mediante la Edge Function.

El build obtiene toda la carta y su revisión con `get_build_menu_snapshot()` en una única transacción consistente. No se aceptan lecturas parciales que puedan mezclar productos y precios de distintos momentos.

### Operativo: inmediato

Incluye disponibilidad por sabor y estado general (`accepting_orders`, `paused`, `sold_out`, `closed`). No incrementa la revisión editorial ni dispara un deploy. El navegador consulta únicamente el contrato runtime público y superpone ese estado sobre el HTML estático.

Si la lectura runtime falla, la carta permanece visible pero no asume disponibilidad: invita a confirmarla por WhatsApp.

## Modelo previsto

```text
menu_content.menu_categories
menu_content.menu_items
menu_content.menu_item_prices

public.menu_availability
public.business_runtime_state

app_private.admin_users
app_private.menu_content_state
app_private.menu_publish_requests
```

- Las categorías y sus modelos de precio son fijos.
- Un producto no cambia de categoría después de crearse.
- La disponibilidad corresponde al sabor completo.
- “Eliminar” archiva y deshabilita en la misma transacción; nunca borra físicamente desde el admin.
- Restaurar conserva el producto agotado hasta que el responsable lo habilite explícitamente.

## Límites de confianza

| Actor | Acceso permitido |
| --- | --- |
| `anon` | Solo RPC/lectura del estado runtime público. |
| Usuario autenticado no autorizado | Ninguna operación administrativa. |
| Usuario de `app_private.admin_users` | RPCs administrativas atómicas. |
| Build de Vercel | Conexión privada de solo lectura para el snapshot. |
| Edge Function | Deploy Hook y operaciones internas de publicación. |

RLS y grants se aplican juntos. Las tablas editoriales no se escriben directamente desde el navegador y las operaciones con múltiples filas se encapsulan en RPCs transaccionales.

## Contrato de entorno

| Variable | Alcance | Uso |
| --- | --- | --- |
| `MENU_DATA_SOURCE` | Build | `fixture` o `supabase`. |
| `ALLOW_FIXTURE_BUILD` | Build no productivo | Opt-in explícito para fixture. |
| `PUBLIC_SUPABASE_URL` | Cliente y build | Endpoint del proyecto. |
| `PUBLIC_SUPABASE_ANON_KEY` | Cliente y build | Clave pública protegida por RLS. |
| `SUPABASE_DB_URL` | Build privado | Snapshot consistente; nunca llega a `dist/`. |
| `PUBLIC_SITE_URL` | Build | URL canónica; HTTPS obligatorio en producción. |
| `VERCEL_DEPLOY_HOOK_URL` | Edge Function | Solicitud de publicación; nunca se configura en Vercel cliente. |
| `PUBLISH_ALLOWED_ORIGINS` | Edge Function | Orígenes exactos autorizados para publicar. |
| `DEPLOY_HOOK_MODE` | Edge Function | `test` local o `vercel` remoto. |
| `DEPLOY_HOOK_TIMEOUT_MS` | Edge Function | Timeout acotado del Deploy Hook. |
| `PUBLISH_COOLDOWN_SECONDS` | Edge Function | Ventana anti-repetición. |

La validación previa a `astro build` prohíbe fixture en producción y exige todas las credenciales de Supabase. El mismo comando de build ejecuta después `verify-dist-secrets` sobre el artefacto completo; CI repite el control como evidencia explícita.

## Decisiones de alcance

Incluido:

- Landing y carta en una sola página, mobile-first.
- CTA simple de WhatsApp, sin armador de pedido.
- Cinco categorías fijas.
- Un solo usuario y recuperación de contraseña.
- Estado manual con horarios informativos.
- Publicación editorial controlada y operación inmediata.

Fuera del MVP:

- Carrito, checkout y pagos online.
- Rappi, PedidosYa u otras integraciones de delivery.
- Roles, invitaciones y administración de usuarios.
- Categorías u orden editorial configurables.
- Imágenes por producto.
- Borrado irreversible desde la interfaz.

## Fallos seguros

- Supabase runtime inaccesible: mostrar “Confirmá disponibilidad por WhatsApp”.
- Snapshot inválido o credenciales ausentes: abortar el build.
- Hook fallido o timeout: conservar la revisión como no publicada y permitir reintento.
- Producto archivado antes del próximo deploy: mostrarlo agotado en el despliegue anterior y omitirlo en el siguiente.
- Sesión vencida: detener la acción, conservar el formulario y solicitar reautenticación.
