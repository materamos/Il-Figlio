# Notas de transcripción del menú inicial

Fuentes consultadas:

- `IMG-20260723-WA0115.jpg`: 12 pizzas clásicas, ingredientes y precios de grande/porción.
- `IMG-20260723-WA0116.jpg`: 4 pizzas rellenas, 4 gourmet, dos fainás, regla de mitad y mitad y datos de contacto.
- Confirmación del propietario del proyecto: empanadas de carne y de jamón y queso, ambas a $2.800 por unidad.
- Perfil de Instagram `@ilfigliopizza`: pizza al molde, masas de larga fermentación y horario de viernes a domingo desde las 19:00.

## Normalizaciones inequívocas

- `MOZARELLA` se transcribió como `Mozzarella`.
- Las abreviaturas `j. cocido` se expandieron a `jamón cocido`.
- Se agregaron tildes y mayúsculas/minúsculas propias de texto corrido (`jamón`, `orégano`, `fainá`, etc.).
- Los importes se guardan como enteros en pesos argentinos, sin puntos de miles.
- Napolitana especial se transcribió a $19.000 la grande y $4.000 la porción, según la fila 7 de la carta.

## Ambigüedades preservadas

- La carta alterna `Fugazzeta` y `Fugazzetta`. Se conservó la grafía que aparece en cada sabor; no se unificó sin confirmación del negocio.
- La carta escribe `Peperoni`. No se cambió a `Pepperoni` porque puede ser el nombre editorial elegido.
- `C.B.O` no se expandió: la carta no explica la sigla.
- `Champignons` y la aclaración `bacon (panceta)` se conservaron por fidelidad al texto de origen.
- `Orégano o albahaca` en Mozzarella y `base de cebolla o tomate` en C.B.O se mantienen como alternativas textuales; la fuente no indica si el cliente elige o si depende de producción.
- Las empanadas no traen descripción confirmada, por lo que no se inventaron ingredientes.

## Datos deliberadamente ausentes

No se incorporaron zona o costo de entrega, medios de pago ni disponibilidad real. `initialMenuAvailability` habilita todos los productos únicamente como semilla de desarrollo; Supabase y el admin serán la fuente operativa al activar el sistema. El estado abierto/cerrado sigue siendo operativo y se administra en tiempo real.
