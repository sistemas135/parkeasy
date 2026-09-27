# ParkEasy · sistema de valet parking

Operación de valet en el proyecto **Loom** (San Francisco, Panamá): 23 plazas con triplicadores (A/B/C = 69 espacios).

## Arquitectura
- **Frontend**: `docs/` — una sola web app estática (HTML/CSS/JS sin framework), publicada con GitHub Pages.
  - `#/t/<token>` cliente (escanea el QR de su tarjeta) · `#/valet` app del runner · `#/tablero` capitán · `#/admin` dueño.
  - `config.js` tiene la URL y la llave *anon* de Supabase (pública por diseño).
- **Backend**: Supabase (Postgres + Storage). Toda la lógica vive en funciones SQL `security definer`
  (`supabase/001_schema.sql`); las tablas no son accesibles con la llave anon. Fotos en el bucket público `fotos`.
- **Personal**: entra con PIN (bcrypt). Roles: `admin`, `capitan`, `runner`. Sesiones en `staff_sessions`.
- **Clientes**: no se registran; se identifican por el token secreto del QR de la tarjeta.

## Reglas de negocio implementadas
- Tarifas (ITBMS incluido, editables en Admin): día $5 · noche $6 (desde las 17:00) · overnight +$10 · mensual $100 · tarjeta perdida $20.
- Niveles por peso del carro (margen 200 lb): C ≤ 3,000 lb · B ≤ 4,500 lb · A ≤ 6,000 lb. El sistema sugiere nivel y plaza.
- El runner no puede entregar sin pago confirmado. Efectivo lo registra quien lo recibe; Yappy/tarjeta los confirma el capitán en el tablero (temporal, hasta integrar el webhook).
- Propinas: pool por turno (se ven en Admin → Corte de caja).
- Día operativo: 6:00 a.m. a 6:00 a.m. del día siguiente.

## Desarrollo / pruebas
- `test/mock_backend.py`: mini PostgREST local contra un Postgres con el esquema cargado (rol `anon`).
- `test/e2e.py`: prueba de punta a punta con Playwright (recibir → pedir → confirmar pago → entregar → admin).

## Despliegue
GitHub Pages publica la carpeta `docs/` de la rama `main`.
