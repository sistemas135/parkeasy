# ParkEasy · sistema de valet parking

Operación de valet en el proyecto **Loom** (San Francisco, Panamá): 23 plazas con triplicadores (A/B/C = 69 espacios).

## Arquitectura
- **Frontend**: `docs/` — una sola web app estática (HTML/CSS/JS sin framework), publicada con GitHub Pages.
  - `#/t/<token>` cliente (escanea el QR de su tarjeta) · `#/valet` app del runner · `#/tablero` capitán · `#/admin` dueño · `#/aliado` comercio aliado · `#/terminos` términos y condiciones.
  - `config.js` tiene la URL y la llave *anon* de Supabase (pública por diseño).
- **Backend**: Supabase (Postgres + Storage). Toda la lógica vive en funciones SQL `security definer`
  (`supabase/001_schema.sql`); las tablas no son accesibles con la llave anon. Fotos en el bucket público `fotos`.
- **Personal**: entra con PIN (bcrypt). Roles: `admin`, `capitan`, `runner`. Sesiones en `staff_sessions`.
- **Clientes**: no se registran; se identifican por el token secreto del QR de la tarjeta.

## Reglas de negocio implementadas
- Tarifa por tiempo (ITBMS incluido, editable en Admin → Tarifas), a cualquier hora y día: 0–4 h $5 · 4:01–8 h $10 · 8:01–12 h $15 · 12:01–24 h $60 · cada 24 h adicionales +$60. Gracia de 10 min en cada corte. El reloj se detiene cuando el cliente pide el carro; ese es el precio que paga. Tarjeta perdida $20.
- El cliente ve en su ticket la tarifa actual, a qué hora sube y el tarifario completo.
- Contratos (mensuales/largo plazo, $100/mes, post-pago): no se muestran al público. Cada contrato tiene tarjetas fijas (códigos 9001+) que se reciben sin cobro; horario y placas opcionales; estado de cuenta y pagos en Admin → Contratos. Fuera del horario del contrato se cobra la tarifa por tiempo.
- Una tarjeta con ingreso registrado y sin salida está `en_uso` y no puede iniciar otra visita.
- Comercios aliados (restaurantes que cubren el valet de sus clientes): prepago de $300 cobrado a su tarjeta de crédito y registrado a mano como recarga (Admin → Comercios). El comercio entra con su PIN en `#/aliado`, escanea la tarjeta del cliente y cubre la tarifa vigente en ese momento; si el cliente se queda más tiempo paga solo la diferencia. El saldo puede quedar negativo; al cierre del mes se cobra el excedente + $300 del mes entrante (estado de cuenta en Admin → Comercios → Cuenta).
- Niveles por peso del carro (margen 200 lb): C ≤ 3,000 lb · B ≤ 4,500 lb · A ≤ 6,000 lb. El sistema sugiere nivel y plaza.
- El runner no puede entregar sin pago confirmado. Efectivo lo registra quien lo recibe; Yappy/tarjeta los confirma el capitán en el tablero (temporal, hasta integrar el webhook).
- Propinas: pool por turno (se ven en Admin → Corte de caja).
- Día operativo: 6:00 a.m. a 6:00 a.m. del día siguiente.

## Desarrollo / pruebas
- `test/mock_backend.py`: mini PostgREST local contra un Postgres con el esquema cargado (rol `anon`).
- `test/e2e.py`: prueba de punta a punta con Playwright (recibir → pedir → confirmar pago → entregar → admin → contratos).
- `test/prod_e2e.py`: la misma prueba contra producción (GitHub Pages + Supabase); requiere `.dbpass` y limpia sus datos con SQL.
- Migraciones en `supabase/`: `001_schema.sql`, `002_seed.sql`, `003_storage.sql`, `004_tiempo_contratos.sql` (tarifa por tiempo + contratos), `005_comercios_aliados.sql` (comercios aliados). Todas aplicadas en producción.

## Despliegue
GitHub Pages publica `docs/` (rama `main`). Los parches en `patches/*.patch` los aplica el workflow `.github/workflows/apply-patches.yml`.
