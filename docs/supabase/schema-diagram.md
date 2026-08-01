# Modelo de datos

```mermaid
erDiagram
  AUTH_USERS ||--o| ADMIN_USERS : authorizes
  AUTH_USERS ||--o{ MENU_ITEMS : updates
  AUTH_USERS ||--o{ MENU_AVAILABILITY : updates
  AUTH_USERS ||--o{ MENU_PUBLISH_REQUESTS : requests

  MENU_CATEGORIES ||--o{ MENU_ITEMS : contains
  MENU_ITEMS ||--|{ MENU_ITEM_PRICES : prices
  MENU_ITEMS ||--|| MENU_AVAILABILITY : runtime_state

  MENU_CONTENT_STATE ||--o{ MENU_PUBLISH_REQUESTS : snapshots_revision

  MENU_CATEGORIES {
    text code PK
    text title
    smallint order_index
    enum_array allowed_price_kinds
  }

  MENU_ITEMS {
    uuid id PK
    text category_code FK
    text name
    text description
    integer order_index
    bigint version
    timestamptz archived_at
  }

  MENU_ITEM_PRICES {
    uuid item_id PK,FK
    enum price_kind PK
    integer amount
  }

  MENU_AVAILABILITY {
    uuid item_id PK,FK
    boolean available
    timestamptz updated_at
  }

  BUSINESS_RUNTIME_STATE {
    boolean singleton PK
    enum status
    text message
    timestamptz updated_at
  }

  ADMIN_USERS {
    uuid user_id PK,FK
    boolean active
  }

  MENU_CONTENT_STATE {
    boolean singleton PK
    bigint current_revision
    bigint last_publish_requested_revision
    timestamptz last_publish_requested_at
  }

  MENU_PUBLISH_REQUESTS {
    bigint id PK
    uuid requested_by FK
    bigint content_revision
    enum status
    integer hook_status_code
    text hook_job_id
  }
```

`MENU_CATEGORIES`, `MENU_ITEMS` y `MENU_ITEM_PRICES` pertenecen a
`menu_content`; `MENU_AVAILABILITY` y `BUSINESS_RUNTIME_STATE` pertenecen a
`public`; los otros objetos de aplicación pertenecen a `app_private`.
