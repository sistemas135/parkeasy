-- ParkEasy · datos maestros
-- El catálogo inicial de modelos (153 marcas/modelos con peso en libras) ya está cargado en producción
-- y se alimenta solo desde la app del runner; se administra en Admin → Modelos.

-- 150 tarjetas: 1001–1150 (cada una con su token secreto para el QR)
insert into tarjetas (codigo, token)
select i::text, encode(gen_random_bytes(9),'hex') from generate_series(1001,1150) i
on conflict do nothing;
