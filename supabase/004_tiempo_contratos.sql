-- ParkEasy · v2: tarifa por tiempo + contratos con tarjeta fija
-- (idempotente; se aplica sobre 001–003)

-- ---------- tarifas por tiempo ----------
update config set valor = '{
  "tramos": [
    {"hasta_min": 240,  "precio": 5},
    {"hasta_min": 480,  "precio": 10},
    {"hasta_min": 720,  "precio": 15},
    {"hasta_min": 1440, "precio": 60}
  ],
  "por_24h_adicional": 60,
  "gracia_min": 10,
  "tarjeta_perdida": 20,
  "mensual": 100,
  "itbms_incluido": true
}'::jsonb, actualizado = now()
where clave = 'tarifas' and (valor ? 'dia');

-- ---------- contratos ----------
create table if not exists contratos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  empresa text,
  telefono text,
  placas text[] not null default '{}',
  horario_desde time not null default '08:00',
  horario_hasta time not null default '17:00',
  cobrar_fuera_horario boolean not null default true,
  monto numeric(8,2) not null default 100,
  estado text not null default 'activo' check (estado in ('activo','suspendido','terminado')),
  notas text,
  creado timestamptz default now()
);
create table if not exists contrato_pagos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references contratos(id),
  mes date not null,                -- primer día del mes
  monto numeric(8,2) not null,
  pagado_en timestamptz default now(),
  referencia text,
  unique (contrato_id, mes)
);
alter table tarjetas add column if not exists tipo text not null default 'publica' check (tipo in ('publica','contrato'));
alter table tarjetas add column if not exists contrato_id uuid references contratos(id);
alter table visitas add column if not exists contrato_id uuid references contratos(id);
alter table visitas add column if not exists minutos int;          -- duración cobrada (recepción → solicitud)
alter table visitas add column if not exists fuera_horario_min int; -- minutos fuera del horario del contrato
alter table contratos enable row level security;
alter table contrato_pagos enable row level security;
revoke all on contratos, contrato_pagos from anon, authenticated;

-- ---------- cálculo del precio por tiempo ----------
-- precio para una cantidad de minutos (ya con gracia aplicada)
create or replace function pe_precio_minutos(p_min int) returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare t jsonb; tr jsonb; ult numeric; ult_min int;
begin
  select valor into t from config where clave='tarifas';
  if t is null or not (t ? 'tramos') then return 0; end if;
  if p_min <= 0 then p_min := 1; end if;
  for tr in select x from jsonb_array_elements(t->'tramos') x order by (x->>'hasta_min')::int loop
    if p_min <= (tr->>'hasta_min')::int then return (tr->>'precio')::numeric; end if;
  end loop;
  -- más allá del último tramo: cada 24 h adicionales
  select (x->>'precio')::numeric, (x->>'hasta_min')::int into ult, ult_min from jsonb_array_elements(t->'tramos') x order by (x->>'hasta_min')::int desc limit 1;
  return ult + coalesce((t->>'por_24h_adicional')::numeric, ult) * ceil((p_min - ult_min)::numeric / 1440);
end $$;

-- precio actual y próximo corte para un intervalo (desde, hasta). Devuelve {minutos, precio, sube_a, sube_en}
create or replace function pe_cotizar(p_desde timestamptz, p_hasta timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare t jsonb; gracia int; min_total int; min_ef int; precio numeric; tr jsonb; sube_en timestamptz; sube_a numeric; ult_min int; ult numeric;
begin
  select valor into t from config where clave='tarifas';
  gracia := coalesce((t->>'gracia_min')::int, 0);
  min_total := greatest(0, ceil(extract(epoch from (p_hasta - p_desde)) / 60))::int;
  min_ef := greatest(1, min_total - gracia);
  precio := pe_precio_minutos(min_ef);
  -- próximo corte
  sube_en := null; sube_a := null;
  for tr in select x from jsonb_array_elements(t->'tramos') x order by (x->>'hasta_min')::int loop
    if min_ef <= (tr->>'hasta_min')::int then
      sube_en := p_desde + ((tr->>'hasta_min')::int + gracia) * interval '1 minute';
      sube_a := pe_precio_minutos((tr->>'hasta_min')::int + 1);
      exit;
    end if;
  end loop;
  if sube_en is null then
    select (x->>'hasta_min')::int into ult_min from jsonb_array_elements(t->'tramos') x order by (x->>'hasta_min')::int desc limit 1;
    -- siguiente múltiplo de 24 h después del último tramo
    sube_en := p_desde + (ult_min + 1440 * ceil((min_ef - ult_min)::numeric / 1440) + gracia) * interval '1 minute';
    sube_a := pe_precio_minutos(ult_min + 1440 * ceil((min_ef - ult_min)::numeric / 1440)::int + 1);
  end if;
  return jsonb_build_object('minutos', min_total, 'precio', precio, 'sube_a', sube_a, 'sube_en', sube_en);
end $$;

-- minutos fuera del horario de un contrato entre dos instantes (hora Panamá)
create or replace function pe_fuera_horario_min(p_desde timestamptz, p_hasta timestamptz, p_hdesde time, p_hhasta time) returns int
language plpgsql stable security definer set search_path = public, extensions as $$
declare d date; ini timestamptz; fin timestamptz; cubierto interval := '0'; total interval; a timestamptz; b timestamptz;
begin
  if p_hasta <= p_desde then return 0; end if;
  total := p_hasta - p_desde;
  d := (p_desde at time zone 'America/Panama')::date;
  while d <= (p_hasta at time zone 'America/Panama')::date loop
    ini := (d::text || ' ' || p_hdesde::text)::timestamp at time zone 'America/Panama';
    fin := (d::text || ' ' || p_hhasta::text)::timestamp at time zone 'America/Panama';
    a := greatest(ini, p_desde); b := least(fin, p_hasta);
    if b > a then cubierto := cubierto + (b - a); end if;
    d := d + 1;
  end loop;
  return greatest(0, ceil(extract(epoch from (total - cubierto)) / 60))::int;
end $$;

-- tarifa de una visita (reemplaza la de v1): reloj desde recibido hasta solicitud (o ahora)
create or replace function pe_tarifa_visita(v visitas) returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare c contratos; hasta timestamptz; fh int; t jsonb; gracia int;
begin
  hasta := coalesce(v.solicitado_en, now());
  if v.tipo = 'cortesia' then return 0; end if;
  if v.tipo = 'mensual' then
    if v.contrato_id is null then return 0; end if;
    select * into c from contratos where id = v.contrato_id;
    if c.id is null or not c.cobrar_fuera_horario then return 0; end if;
    fh := pe_fuera_horario_min(v.recibido_en, hasta, c.horario_desde, c.horario_hasta);
    select valor into t from config where clave='tarifas'; gracia := coalesce((t->>'gracia_min')::int, 0);
    if fh <= gracia then return 0; end if;
    return pe_precio_minutos(fh - gracia);
  end if;
  return (pe_cotizar(v.recibido_en, hasta)->>'precio')::numeric;
end $$;

-- ya no hay overnight aparte: está dentro de los tramos
create or replace function pe_overnight_visita(v visitas) returns numeric
language sql stable security definer set search_path = public, extensions as $$ select 0::numeric $$;

-- ---------- visita json con cotización en vivo ----------
create or replace function pe_visita_json(v visitas) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare cot jsonb; c contratos; fh int;
begin
  if v.tipo = 'abierto' and v.estado in ('recibido','estacionado') then
    cot := pe_cotizar(v.recibido_en, now());
  elsif v.tipo = 'mensual' and v.contrato_id is not null then
    select * into c from contratos where id = v.contrato_id;
    fh := pe_fuera_horario_min(v.recibido_en, coalesce(v.solicitado_en, now()), c.horario_desde, c.horario_hasta);
    cot := jsonb_build_object('minutos', ceil(extract(epoch from (coalesce(v.solicitado_en, now()) - v.recibido_en))/60), 'precio', pe_tarifa_visita(v), 'fuera_horario_min', fh,
      'horario_hasta', c.horario_hasta, 'contrato_nombre', c.nombre, 'contrato_estado', c.estado);
  else
    cot := jsonb_build_object('minutos', v.minutos, 'precio', v.tarifa);
  end if;
  return jsonb_build_object(
    'id', v.id, 'tarjeta', v.tarjeta, 'estado', v.estado,
    'placa', v.placa, 'modelo', v.modelo, 'color', v.color, 'peso_lb', v.peso_lb, 'categoria', v.categoria,
    'nivel_sugerido', v.nivel_sugerido, 'plaza', v.plaza, 'nivel', v.nivel,
    'ubicacion', case when v.plaza is null then null else lpad(v.plaza::text,2,'0')||'-'||v.nivel end,
    'fotos', v.fotos,
    'recibido_en', v.recibido_en, 'estacionado_en', v.estacionado_en, 'solicitado_en', v.solicitado_en,
    'en_camino_en', v.en_camino_en, 'en_puerta_en', v.en_puerta_en, 'entregado_en', v.entregado_en,
    'cuando', v.cuando, 'tipo', v.tipo, 'contrato_id', v.contrato_id,
    'tarifa', v.tarifa, 'overnight', v.overnight, 'extra', v.extra, 'propina', v.propina, 'total', v.total,
    'minutos', v.minutos, 'fuera_horario_min', v.fuera_horario_min,
    'pago_metodo', v.pago_metodo, 'pago_estado', v.pago_estado, 'pago_referencia', v.pago_referencia,
    'tarjeta_perdida', v.tarjeta_perdida, 'calificacion', v.calificacion, 'notas', v.notas,
    'runner_recibe', (select nombre from staff where id = v.runner_recibe),
    'runner_entrega', (select nombre from staff where id = v.runner_entrega),
    'dia_operativo', v.dia_operativo,
    'cotizacion', cot
  );
end $$;

-- ---------- tarifario público ----------
create or replace function tarifario() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('tramos', valor->'tramos', 'por_24h_adicional', valor->'por_24h_adicional', 'gracia_min', valor->'gracia_min', 'tarjeta_perdida', valor->'tarjeta_perdida', 'itbms_incluido', valor->'itbms_incluido')
  from config where clave='tarifas'
$$;

-- ---------- cliente: incluye tarifario ----------
create or replace function cliente_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas; t tarjetas; cfg jsonb;
begin
  select * into t from tarjetas where token = p_token;
  if t.codigo is null then return jsonb_build_object('ok', false, 'error', 'TARJETA_INVALIDA'); end if;
  select valor into cfg from config where clave='sitio';
  if t.visita_actual is null then
    return jsonb_build_object('ok', true, 'tarjeta', t.codigo, 'tipo_tarjeta', t.tipo, 'visita', null, 'sitio', cfg, 'tarifario', tarifario());
  end if;
  select * into v from visitas where id = t.visita_actual;
  return jsonb_build_object('ok', true, 'tarjeta', t.codigo, 'tipo_tarjeta', t.tipo, 'visita', pe_visita_json(v), 'sitio', cfg, 'tarifario', tarifario());
end $$;

-- cliente pide: el reloj se detiene aquí; el precio queda fijo
create or replace function cliente_pedir(p_token text, p_cuando text, p_propina numeric, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas; precio numeric; c contratos; fh int;
begin
  v := pe_visita_por_token(p_token);
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'SIN_VISITA'); end if;
  if v.estado not in ('recibido','estacionado') then return jsonb_build_object('ok', false, 'error', 'YA_SOLICITADO'); end if;
  v.solicitado_en := now();
  precio := pe_tarifa_visita(v);
  if v.tipo = 'mensual' and v.contrato_id is not null then
    select * into c from contratos where id = v.contrato_id;
    fh := pe_fuera_horario_min(v.recibido_en, v.solicitado_en, c.horario_desde, c.horario_hasta);
  end if;
  if (precio + greatest(coalesce(p_propina,0),0)) > 0 and p_metodo not in ('efectivo','yappy','tarjeta') then return jsonb_build_object('ok', false, 'error', 'METODO'); end if;
  update visitas set
    estado = 'solicitado', solicitado_en = v.solicitado_en, cuando = coalesce(p_cuando,'ahora'),
    propina = greatest(coalesce(p_propina,0),0),
    tarifa = precio, overnight = 0,
    minutos = ceil(extract(epoch from (v.solicitado_en - v.recibido_en))/60),
    fuera_horario_min = fh,
    pago_metodo = case when (precio + greatest(coalesce(p_propina,0),0)) = 0 then coalesce(pago_metodo, 'mensual') else p_metodo end,
    pago_estado = case
        when (precio + greatest(coalesce(p_propina,0),0)) = 0 then 'pagado'
        when p_metodo = 'efectivo' then 'pendiente'
        else 'por_confirmar' end
  where id = v.id returning * into v;
  perform pe_log(v.id, null, 'solicitado', jsonb_build_object('cuando', p_cuando, 'metodo', p_metodo, 'propina', p_propina, 'tarifa', precio, 'minutos', v.minutos));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- pedir desde el stand
create or replace function ops_pedir(p_sess text, p_visita uuid, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; precio numeric; c contratos; fh int;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into v from visitas where id = p_visita;
  if v.id is null or v.estado not in ('recibido','estacionado') then return jsonb_build_object('ok', false, 'error', 'ESTADO'); end if;
  v.solicitado_en := now();
  precio := pe_tarifa_visita(v);
  if v.tipo = 'mensual' and v.contrato_id is not null then
    select * into c from contratos where id = v.contrato_id;
    fh := pe_fuera_horario_min(v.recibido_en, v.solicitado_en, c.horario_desde, c.horario_hasta);
  end if;
  update visitas set estado = 'solicitado', solicitado_en = v.solicitado_en, cuando = 'ahora',
    tarifa = precio, overnight = 0,
    minutos = ceil(extract(epoch from (v.solicitado_en - v.recibido_en))/60), fuera_horario_min = fh,
    pago_metodo = case when precio = 0 then coalesce(pago_metodo,'mensual') else coalesce(p_metodo,'efectivo') end,
    pago_estado = case when precio = 0 then 'pagado' when coalesce(p_metodo,'efectivo') = 'efectivo' then 'pendiente' else 'por_confirmar' end
  where id = v.id returning * into v;
  perform pe_log(v.id, s.id, 'solicitado_stand', jsonb_build_object('metodo', p_metodo, 'tarifa', precio));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- ---------- recibir: reconoce tarjetas de contrato ----------
create or replace function runner_recibir(p_sess text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; t tarjetas; v visitas; c contratos; aviso text;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into t from tarjetas where codigo = p_codigo or token = p_codigo;
  if t.codigo is null then return jsonb_build_object('ok', false, 'error', 'TARJETA_NO_EXISTE'); end if;
  if t.estado = 'baja' or t.estado = 'perdida' then return jsonb_build_object('ok', false, 'error', 'TARJETA_INACTIVA'); end if;
  if t.estado <> 'disponible' then
    return jsonb_build_object('ok', false, 'error', 'TARJETA_EN_USO', 'visita', t.visita_actual);
  end if;
  if t.tipo = 'contrato' and t.contrato_id is not null then
    select * into c from contratos where id = t.contrato_id;
  end if;
  if c.id is not null and c.estado = 'activo' then
    insert into visitas (tarjeta, runner_recibe, tipo, contrato_id, pago_metodo, pago_estado, placa, tarifa)
      values (t.codigo, s.id, 'mensual', c.id, 'mensual', 'pagado', (case when array_length(c.placas,1) = 1 then c.placas[1] else null end), 0) returning * into v;
  else
    if c.id is not null then aviso := 'CONTRATO_' || upper(c.estado); end if;
    insert into visitas (tarjeta, runner_recibe) values (t.codigo, s.id) returning * into v;
  end if;
  update tarjetas set estado = 'en_uso', visita_actual = v.id where codigo = t.codigo;
  perform pe_log(v.id, s.id, 'recibido', jsonb_build_object('tarjeta', t.codigo, 'contrato', c.id, 'aviso', aviso));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v), 'contrato', case when c.id is not null then jsonb_build_object('nombre', c.nombre, 'estado', c.estado, 'placas', c.placas) else null end, 'aviso', aviso);
end $$;

-- datos del vehículo: ya no detecta mensuales por placa (los contratos van por tarjeta)
create or replace function runner_datos(p_sess text, p_visita uuid, p_placa text, p_modelo text, p_peso int, p_categoria text, p_color text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; peso int; niv char(1); sug int;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  peso := p_peso;
  if peso is null and p_categoria is not null then
    peso := case p_categoria when 'sedan' then 2600 when 'suv_mediano' then 4000 when 'suv_grande' then 5300 else null end;
  end if;
  niv := pe_nivel_para(peso);
  update visitas set placa = upper(trim(p_placa)), modelo = p_modelo, peso_lb = peso, categoria = p_categoria, color = p_color, nivel_sugerido = niv
  where id = p_visita returning * into v;
  if p_modelo is not null and peso is not null then
    insert into modelos (nombre, peso_lb, fuente, usos) values (p_modelo, peso, case when p_peso is null then 'manual' else 'catalogo' end, 1)
    on conflict (nombre) do update set usos = modelos.usos + 1;
  end if;
  sug := case when niv in ('A','B','C') then pe_plaza_sugerida(niv) else null end;
  perform pe_log(v.id, s.id, 'datos', jsonb_build_object('placa', p_placa, 'modelo', p_modelo, 'peso', peso, 'nivel', niv));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v), 'nivel', niv, 'plaza_sugerida', sug, 'mensual', v.tipo = 'mensual');
end $$;

-- tarjeta perdida: si es de contrato, se da de baja definitivamente y se avisa
create or replace function ops_tarjeta_perdida(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; t jsonb; cargo numeric;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  select valor into t from config where clave='tarifas';
  cargo := coalesce((t->>'tarjeta_perdida')::numeric, 0);
  update visitas set tarjeta_perdida = true, extra = cargo,
    pago_estado = case when cargo > 0 and pago_estado = 'pagado' then 'pendiente' else pago_estado end,
    pago_metodo = case when cargo > 0 and pago_metodo in ('mensual','cortesia') then 'efectivo' else coalesce(pago_metodo, 'efectivo') end
   where id = p_visita and estado <> 'entregado' returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APLICA'); end if;
  perform pe_log(v.id, s.id, 'tarjeta_perdida', jsonb_build_object('extra', v.extra));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- entregar: una tarjeta de contrato perdida queda en baja (no vuelve al inventario)
create or replace function runner_entregar(p_sess text, p_visita uuid, p_codigo_tarjeta text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into v from visitas where id = p_visita;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'NO_EXISTE'); end if;
  if v.estado = 'entregado' then return jsonb_build_object('ok', false, 'error', 'YA_ENTREGADO'); end if;
  if v.pago_estado <> 'pagado' then return jsonb_build_object('ok', false, 'error', 'PAGO_PENDIENTE'); end if;
  if not v.tarjeta_perdida then
    if p_codigo_tarjeta is null or not exists (select 1 from tarjetas t where t.codigo = v.tarjeta and (t.codigo = p_codigo_tarjeta or t.token = p_codigo_tarjeta)) then
      return jsonb_build_object('ok', false, 'error', 'TARJETA_NO_COINCIDE');
    end if;
  end if;
  update visitas set estado = 'entregado', entregado_en = now(), runner_entrega = coalesce(runner_entrega, s.id),
    minutos = coalesce(minutos, ceil(extract(epoch from (coalesce(solicitado_en, now()) - recibido_en))/60))
   where id = p_visita returning * into v;
  update tarjetas set estado = case when v.tarjeta_perdida then (case when tipo = 'contrato' then 'baja' else 'perdida' end) else 'disponible' end, visita_actual = null where codigo = v.tarjeta;
  perform pe_log(v.id, s.id, 'entregado');
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- ---------- admin: contratos ----------
create or replace function admin_contratos_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'contratos', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'empresa', c.empresa, 'telefono', c.telefono, 'placas', c.placas,
      'horario_desde', c.horario_desde, 'horario_hasta', c.horario_hasta, 'cobrar_fuera_horario', c.cobrar_fuera_horario,
      'monto', c.monto, 'estado', c.estado, 'notas', c.notas, 'creado', c.creado,
      'tarjetas', (select coalesce(jsonb_agg(jsonb_build_object('codigo', t.codigo, 'token', t.token, 'estado', t.estado) order by t.codigo), '[]') from tarjetas t where t.contrato_id = c.id),
      'visitas_mes', (select count(*) from visitas v where v.contrato_id = c.id and v.dia_operativo >= date_trunc('month', (now() at time zone 'America/Panama'))::date),
      'pagado_mes', exists (select 1 from contrato_pagos p where p.contrato_id = c.id and p.mes = date_trunc('month', (now() at time zone 'America/Panama'))::date)
    ) order by c.estado, c.nombre) from contratos c), '[]'));
end $$;

create or replace function admin_contrato_upsert(p_sess text, p_id uuid, p_nombre text, p_empresa text, p_telefono text, p_placas text[], p_hdesde time, p_hhasta time, p_cobrar_fh boolean, p_monto numeric, p_estado text, p_notas text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; nid uuid;
begin
  s := pe_staff(p_sess, array['admin']);
  if p_id is null then
    insert into contratos (nombre, empresa, telefono, placas, horario_desde, horario_hasta, cobrar_fuera_horario, monto, estado, notas)
      values (p_nombre, p_empresa, p_telefono, coalesce((select array_agg(upper(trim(x))) from unnest(p_placas) x where trim(x) <> ''), '{}'), coalesce(p_hdesde,'08:00'), coalesce(p_hhasta,'17:00'), coalesce(p_cobrar_fh,true), coalesce(p_monto,100), coalesce(p_estado,'activo'), p_notas)
      returning id into nid;
  else
    update contratos set nombre = coalesce(p_nombre,nombre), empresa = coalesce(p_empresa,empresa), telefono = coalesce(p_telefono,telefono),
      placas = coalesce((select array_agg(upper(trim(x))) from unnest(p_placas) x where trim(x) <> ''), placas),
      horario_desde = coalesce(p_hdesde,horario_desde), horario_hasta = coalesce(p_hhasta,horario_hasta),
      cobrar_fuera_horario = coalesce(p_cobrar_fh,cobrar_fuera_horario), monto = coalesce(p_monto,monto),
      estado = coalesce(p_estado,estado), notas = coalesce(p_notas,notas)
    where id = p_id returning id into nid;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- asignar / crear una tarjeta de contrato (códigos 9001+ por defecto)
create or replace function admin_contrato_tarjeta(p_sess text, p_contrato uuid, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; cod text; t tarjetas;
begin
  s := pe_staff(p_sess, array['admin']);
  cod := p_codigo;
  if cod is null or cod = '' then
    select (coalesce(max(codigo::int), 9000) + 1)::text into cod from tarjetas where codigo ~ '^9[0-9]{3}$';
  end if;
  select * into t from tarjetas where codigo = cod;
  if t.codigo is null then
    insert into tarjetas (codigo, token, tipo, contrato_id) values (cod, encode(gen_random_bytes(9),'hex'), 'contrato', p_contrato);
  else
    if t.estado = 'en_uso' then return jsonb_build_object('ok', false, 'error', 'TARJETA_EN_USO'); end if;
    update tarjetas set tipo = 'contrato', contrato_id = p_contrato, estado = 'disponible', visita_actual = null where codigo = cod;
  end if;
  return jsonb_build_object('ok', true, 'codigo', cod);
end $$;

-- quitar tarjeta de un contrato: queda de baja (el QR impreso no debe volver al público)
create or replace function admin_contrato_tarjeta_baja(p_sess text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  update tarjetas set estado = 'baja' where codigo = p_codigo and tipo = 'contrato' and estado <> 'en_uso';
  return jsonb_build_object('ok', found);
end $$;

-- estado de cuenta de un mes
create or replace function admin_contrato_cuenta(p_sess text, p_contrato uuid, p_mes date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; c contratos; m date;
begin
  s := pe_staff(p_sess, array['admin']);
  select * into c from contratos where id = p_contrato;
  m := date_trunc('month', p_mes)::date;
  return jsonb_build_object('ok', true, 'contrato', jsonb_build_object('id', c.id, 'nombre', c.nombre, 'empresa', c.empresa, 'monto', c.monto, 'estado', c.estado),
    'mes', m,
    'visitas', coalesce((select jsonb_agg(jsonb_build_object('dia', v.dia_operativo, 'tarjeta', v.tarjeta, 'placa', v.placa, 'recibido', v.recibido_en, 'entregado', v.entregado_en, 'minutos', v.minutos, 'fuera_horario_min', v.fuera_horario_min, 'extra', v.tarifa + v.extra, 'pago', v.pago_estado, 'estado', v.estado) order by v.recibido_en)
        from visitas v where v.contrato_id = p_contrato and v.dia_operativo >= m and v.dia_operativo < m + interval '1 month' and v.estado <> 'cancelado'), '[]'),
    'dias', (select count(distinct dia_operativo) from visitas v where v.contrato_id = p_contrato and v.dia_operativo >= m and v.dia_operativo < m + interval '1 month' and v.estado <> 'cancelado'),
    'extras', (select coalesce(sum(tarifa + extra),0) from visitas v where v.contrato_id = p_contrato and v.dia_operativo >= m and v.dia_operativo < m + interval '1 month' and v.estado <> 'cancelado'),
    'pago', (select jsonb_build_object('monto', p.monto, 'pagado_en', p.pagado_en, 'referencia', p.referencia) from contrato_pagos p where p.contrato_id = p_contrato and p.mes = m));
end $$;

create or replace function admin_contrato_pago(p_sess text, p_contrato uuid, p_mes date, p_monto numeric, p_referencia text, p_quitar boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; m date;
begin
  s := pe_staff(p_sess, array['admin']);
  m := date_trunc('month', p_mes)::date;
  if coalesce(p_quitar,false) then delete from contrato_pagos where contrato_id = p_contrato and mes = m; return jsonb_build_object('ok', true); end if;
  insert into contrato_pagos (contrato_id, mes, monto, referencia) values (p_contrato, m, coalesce(p_monto, (select monto from contratos where id = p_contrato)), p_referencia)
    on conflict (contrato_id, mes) do update set monto = excluded.monto, referencia = excluded.referencia, pagado_en = now();
  return jsonb_build_object('ok', true);
end $$;

-- lista de tarjetas: incluye tipo y contrato
create or replace function admin_tarjetas_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'tarjetas', coalesce((select jsonb_agg(jsonb_build_object('codigo', t.codigo, 'token', t.token, 'estado', t.estado, 'tipo', t.tipo, 'visita_actual', t.visita_actual,
     'contrato', (select c.nombre from contratos c where c.id = t.contrato_id)) order by t.codigo) from tarjetas t), '[]'));
end $$;

grant execute on function tarifario(), admin_contratos_list(text), admin_contrato_upsert(text,uuid,text,text,text,text[],time,time,boolean,numeric,text,text),
  admin_contrato_tarjeta(text,uuid,text), admin_contrato_tarjeta_baja(text,text), admin_contrato_cuenta(text,uuid,date), admin_contrato_pago(text,uuid,date,numeric,text,boolean) to anon;
revoke execute on function pe_precio_minutos(int), pe_cotizar(timestamptz,timestamptz), pe_fuera_horario_min(timestamptz,timestamptz,time,time) from anon, authenticated, public;
