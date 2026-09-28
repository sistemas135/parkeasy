-- ParkEasy · v3: comercios aliados (restaurantes que cubren el valet de sus clientes)
-- (idempotente; se aplica sobre 001–004)
--
-- Modelo: el comercio prepaga (por defecto $300, cobrado a su tarjeta de crédito y registrado
-- manualmente como "recarga"). Cada validación descuenta del saldo la tarifa vigente al momento
-- de escanear. El saldo puede quedar negativo: al cierre de mes se cobra ese excedente + el
-- prepago del mes entrante.

-- ---------- config ----------
update config set valor = valor || '{"aliado_prepago": 300}'::jsonb, actualizado = now()
where clave = 'tarifas' and not (valor ? 'aliado_prepago');

-- ---------- tablas ----------
create table if not exists comercios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  contacto text,
  telefono text,
  pin_hash text not null,
  saldo numeric(10,2) not null default 0,
  estado text not null default 'activo' check (estado in ('activo','suspendido','terminado')),
  notas text,
  creado timestamptz default now()
);
create table if not exists comercio_movimientos (
  id uuid primary key default gen_random_uuid(),
  comercio_id uuid not null references comercios(id),
  tipo text not null check (tipo in ('recarga','validacion','ajuste','reverso')),
  monto numeric(10,2) not null,          -- recarga/ajuste: +; validación: −
  saldo_despues numeric(10,2) not null,
  visita_id uuid references visitas(id),
  referencia text,
  staff_id uuid references staff(id),
  creado timestamptz default now()
);
create index if not exists comercio_mov_idx on comercio_movimientos (comercio_id, creado);
create table if not exists comercio_sessions (
  token text primary key,
  comercio_id uuid not null references comercios(id),
  creado timestamptz default now(),
  ultimo_uso timestamptz default now()
);
alter table comercios enable row level security;
alter table comercio_movimientos enable row level security;
alter table comercio_sessions enable row level security;
revoke all on comercios, comercio_movimientos, comercio_sessions from anon, authenticated;

alter table visitas add column if not exists comercio_id uuid references comercios(id);
alter table visitas add column if not exists cubierto numeric(8,2) not null default 0;   -- parte que paga el comercio
alter table visitas add column if not exists validado_en timestamptz;
-- 'aliado' como método de pago
alter table visitas drop constraint if exists visitas_pago_metodo_check;
alter table visitas add constraint visitas_pago_metodo_check check (pago_metodo in ('efectivo','yappy','tarjeta','mensual','cortesia','aliado'));

-- ---------- helpers ----------
create or replace function pe_comercio(p_sess text) returns comercios
language plpgsql security definer set search_path = public, extensions as $$
declare c comercios;
begin
  select co.* into c from comercio_sessions cs join comercios co on co.id = cs.comercio_id
   where cs.token = p_sess and co.estado <> 'terminado';
  if c.id is null then raise exception 'SESION_INVALIDA'; end if;
  update comercio_sessions set ultimo_uso = now() where token = p_sess;
  return c;
end $$;

-- aplica un movimiento y actualiza el saldo (fila bloqueada)
create or replace function pe_comercio_mov(p_comercio uuid, p_tipo text, p_monto numeric, p_visita uuid, p_ref text, p_staff uuid) returns numeric
language plpgsql security definer set search_path = public, extensions as $$
declare nuevo numeric;
begin
  update comercios set saldo = saldo + p_monto where id = p_comercio returning saldo into nuevo;
  if nuevo is null then raise exception 'COMERCIO_NO_EXISTE'; end if;
  insert into comercio_movimientos (comercio_id, tipo, monto, saldo_despues, visita_id, referencia, staff_id)
    values (p_comercio, p_tipo, p_monto, nuevo, p_visita, p_ref, p_staff);
  return nuevo;
end $$;

-- ---------- visita json: agrega comercio ----------
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
    cot := jsonb_build_object('minutos', v.minutos, 'precio', v.tarifa + v.cubierto);
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
    'comercio_id', v.comercio_id, 'cubierto', v.cubierto, 'validado_en', v.validado_en,
    'comercio', (select co.nombre from comercios co where co.id = v.comercio_id),
    'pago_metodo', v.pago_metodo, 'pago_estado', v.pago_estado, 'pago_referencia', v.pago_referencia,
    'tarjeta_perdida', v.tarjeta_perdida, 'calificacion', v.calificacion, 'notas', v.notas,
    'runner_recibe', (select nombre from staff where id = v.runner_recibe),
    'runner_entrega', (select nombre from staff where id = v.runner_entrega),
    'dia_operativo', v.dia_operativo,
    'cotizacion', cot
  );
end $$;

-- ---------- cliente pide: descuenta lo cubierto por el comercio ----------
create or replace function cliente_pedir(p_token text, p_cuando text, p_propina numeric, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas; precio numeric; parte numeric; c contratos; fh int; prop numeric;
begin
  v := pe_visita_por_token(p_token);
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'SIN_VISITA'); end if;
  if v.estado not in ('recibido','estacionado') then return jsonb_build_object('ok', false, 'error', 'YA_SOLICITADO'); end if;
  v.solicitado_en := now();
  precio := pe_tarifa_visita(v);
  parte := greatest(0, precio - v.cubierto);           -- lo que paga el cliente
  prop := greatest(coalesce(p_propina,0),0);
  if v.tipo = 'mensual' and v.contrato_id is not null then
    select * into c from contratos where id = v.contrato_id;
    fh := pe_fuera_horario_min(v.recibido_en, v.solicitado_en, c.horario_desde, c.horario_hasta);
  end if;
  if (parte + prop + v.extra) > 0 and p_metodo not in ('efectivo','yappy','tarjeta') then return jsonb_build_object('ok', false, 'error', 'METODO'); end if;
  update visitas set
    estado = 'solicitado', solicitado_en = v.solicitado_en, cuando = coalesce(p_cuando,'ahora'),
    propina = prop,
    tarifa = parte, overnight = 0,
    minutos = ceil(extract(epoch from (v.solicitado_en - v.recibido_en))/60),
    fuera_horario_min = fh,
    pago_metodo = case when (parte + prop + v.extra) = 0 then coalesce(case when v.comercio_id is not null then 'aliado' else null end, pago_metodo, 'mensual') else p_metodo end,
    pago_estado = case
        when (parte + prop + v.extra) = 0 then 'pagado'
        when p_metodo = 'efectivo' then 'pendiente'
        else 'por_confirmar' end
  where id = v.id returning * into v;
  perform pe_log(v.id, null, 'solicitado', jsonb_build_object('cuando', p_cuando, 'metodo', p_metodo, 'propina', p_propina, 'tarifa', precio, 'cubierto', v.cubierto, 'minutos', v.minutos));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function ops_pedir(p_sess text, p_visita uuid, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; precio numeric; parte numeric; c contratos; fh int;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into v from visitas where id = p_visita;
  if v.id is null or v.estado not in ('recibido','estacionado') then return jsonb_build_object('ok', false, 'error', 'ESTADO'); end if;
  v.solicitado_en := now();
  precio := pe_tarifa_visita(v);
  parte := greatest(0, precio - v.cubierto);
  if v.tipo = 'mensual' and v.contrato_id is not null then
    select * into c from contratos where id = v.contrato_id;
    fh := pe_fuera_horario_min(v.recibido_en, v.solicitado_en, c.horario_desde, c.horario_hasta);
  end if;
  update visitas set estado = 'solicitado', solicitado_en = v.solicitado_en, cuando = 'ahora',
    tarifa = parte, overnight = 0,
    minutos = ceil(extract(epoch from (v.solicitado_en - v.recibido_en))/60), fuera_horario_min = fh,
    pago_metodo = case when (parte + v.extra) = 0 then coalesce(case when v.comercio_id is not null then 'aliado' else null end, pago_metodo, 'mensual') else coalesce(p_metodo,'efectivo') end,
    pago_estado = case when (parte + v.extra) = 0 then 'pagado' when coalesce(p_metodo,'efectivo') = 'efectivo' then 'pendiente' else 'por_confirmar' end
  where id = v.id returning * into v;
  perform pe_log(v.id, s.id, 'solicitado_stand', jsonb_build_object('metodo', p_metodo, 'tarifa', precio, 'cubierto', v.cubierto));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- tarjeta perdida: si el pago era del aliado, el cargo lo paga el cliente
create or replace function ops_tarjeta_perdida(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; t jsonb; cargo numeric;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  select valor into t from config where clave='tarifas';
  cargo := coalesce((t->>'tarjeta_perdida')::numeric, 0);
  update visitas set tarjeta_perdida = true, extra = cargo,
    pago_estado = case when cargo > 0 and pago_estado = 'pagado' then 'pendiente' else pago_estado end,
    pago_metodo = case when cargo > 0 and pago_metodo in ('mensual','cortesia','aliado') then 'efectivo' else coalesce(pago_metodo, 'efectivo') end
   where id = p_visita and estado <> 'entregado' returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APLICA'); end if;
  perform pe_log(v.id, s.id, 'tarjeta_perdida', jsonb_build_object('extra', v.extra));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- ---------- app del comercio aliado ----------
create or replace function aliado_login(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c comercios; tok text;
begin
  select * into c from comercios where estado <> 'terminado' and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'PIN_INCORRECTO'); end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into comercio_sessions (token, comercio_id) values (tok, c.id);
  return jsonb_build_object('ok', true, 'token', tok, 'nombre', c.nombre, 'id', c.id, 'estado', c.estado);
end $$;

create or replace function aliado_logout(p_sess text) returns void
language sql security definer set search_path = public, extensions as
$$ delete from comercio_sessions where token = p_sess $$;

create or replace function aliado_estado(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c comercios; hoy date; mes date; t jsonb;
begin
  c := pe_comercio(p_sess);
  hoy := pe_dia_operativo(now());
  mes := date_trunc('month', (now() at time zone 'America/Panama'))::date;
  select valor into t from config where clave='tarifas';
  return jsonb_build_object('ok', true,
    'comercio', jsonb_build_object('id', c.id, 'nombre', c.nombre, 'saldo', c.saldo, 'estado', c.estado, 'prepago', coalesce((t->>'aliado_prepago')::numeric, 300)),
    'hoy', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'hora', v.validado_en, 'tarjeta', v.tarjeta, 'placa', v.placa, 'modelo', v.modelo, 'monto', v.cubierto, 'estado', v.estado) order by v.validado_en desc)
              from visitas v where v.comercio_id = c.id and v.dia_operativo = hoy), '[]'),
    'hoy_total', (select coalesce(sum(cubierto),0) from visitas v where v.comercio_id = c.id and v.dia_operativo = hoy),
    'mes_carros', (select count(*) from visitas v where v.comercio_id = c.id and v.dia_operativo >= mes),
    'mes_total', (select coalesce(sum(cubierto),0) from visitas v where v.comercio_id = c.id and v.dia_operativo >= mes));
end $$;

-- busca la tarjeta y dice qué se cubriría (sin aplicar)
create or replace function aliado_consultar(p_sess text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c comercios; t tarjetas; v visitas; monto numeric; cot jsonb;
begin
  c := pe_comercio(p_sess);
  select * into t from tarjetas where codigo = p_codigo or token = p_codigo;
  if t.codigo is null then return jsonb_build_object('ok', false, 'error', 'TARJETA_NO_EXISTE'); end if;
  if t.visita_actual is null then return jsonb_build_object('ok', false, 'error', 'SIN_CARRO', 'tarjeta', t.codigo); end if;
  select * into v from visitas where id = t.visita_actual;
  if v.comercio_id is not null then return jsonb_build_object('ok', false, 'error', 'YA_VALIDADA', 'tarjeta', t.codigo, 'comercio', (select nombre from comercios where id = v.comercio_id), 'visita', pe_visita_json(v)); end if;
  if v.tipo <> 'abierto' then return jsonb_build_object('ok', false, 'error', 'CONTRATO', 'tarjeta', t.codigo); end if;
  if v.estado = 'entregado' or v.estado = 'cancelado' then return jsonb_build_object('ok', false, 'error', 'SIN_CARRO', 'tarjeta', t.codigo); end if;
  if v.pago_estado = 'pagado' then return jsonb_build_object('ok', false, 'error', 'YA_PAGADA', 'tarjeta', t.codigo); end if;
  if v.estado in ('recibido','estacionado') then
    cot := pe_cotizar(v.recibido_en, now()); monto := (cot->>'precio')::numeric;
  else
    monto := v.tarifa; cot := jsonb_build_object('minutos', v.minutos, 'precio', v.tarifa);
  end if;
  return jsonb_build_object('ok', true, 'tarjeta', t.codigo, 'visita', pe_visita_json(v), 'monto', monto, 'cotizacion', cot, 'saldo', c.saldo, 'saldo_despues', c.saldo - monto);
end $$;

-- valida: el comercio cubre la tarifa vigente en este momento
create or replace function aliado_validar(p_sess text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c comercios; t tarjetas; v visitas; monto numeric; nuevo numeric; pendiente numeric;
begin
  c := pe_comercio(p_sess);
  if c.estado <> 'activo' then return jsonb_build_object('ok', false, 'error', 'COMERCIO_SUSPENDIDO'); end if;
  select * into t from tarjetas where codigo = p_codigo or token = p_codigo;
  if t.codigo is null then return jsonb_build_object('ok', false, 'error', 'TARJETA_NO_EXISTE'); end if;
  if t.visita_actual is null then return jsonb_build_object('ok', false, 'error', 'SIN_CARRO', 'tarjeta', t.codigo); end if;
  select * into v from visitas where id = t.visita_actual for update;
  if v.comercio_id is not null then return jsonb_build_object('ok', false, 'error', 'YA_VALIDADA', 'tarjeta', t.codigo); end if;
  if v.tipo <> 'abierto' then return jsonb_build_object('ok', false, 'error', 'CONTRATO', 'tarjeta', t.codigo); end if;
  if v.estado in ('entregado','cancelado') then return jsonb_build_object('ok', false, 'error', 'SIN_CARRO', 'tarjeta', t.codigo); end if;
  if v.pago_estado = 'pagado' then return jsonb_build_object('ok', false, 'error', 'YA_PAGADA', 'tarjeta', t.codigo); end if;

  if v.estado in ('recibido','estacionado') then
    -- aún no pidió: se cubre la tarifa vigente ahora; si pasa al siguiente tramo, el cliente paga la diferencia
    monto := (pe_cotizar(v.recibido_en, now())->>'precio')::numeric;
    update visitas set comercio_id = c.id, cubierto = monto, validado_en = now() where id = v.id returning * into v;
  else
    -- ya pidió y no ha pagado: se cubre la tarifa fijada; queda pendiente solo propina / extra
    monto := v.tarifa;
    pendiente := v.propina + v.extra;
    update visitas set comercio_id = c.id, cubierto = monto, validado_en = now(), tarifa = 0,
      pago_metodo = case when pendiente = 0 then 'aliado' else pago_metodo end,
      pago_estado = case when pendiente = 0 then 'pagado' else pago_estado end
     where id = v.id returning * into v;
  end if;
  nuevo := pe_comercio_mov(c.id, 'validacion', -monto, v.id, t.codigo, null);
  perform pe_log(v.id, null, 'validacion_aliado', jsonb_build_object('comercio', c.nombre, 'monto', monto, 'saldo', nuevo));
  return jsonb_build_object('ok', true, 'tarjeta', t.codigo, 'monto', monto, 'saldo', nuevo, 'visita', pe_visita_json(v));
end $$;

-- ---------- admin: comercios ----------
create or replace function admin_comercios_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; mes date; t jsonb;
begin
  s := pe_staff(p_sess, array['admin']);
  mes := date_trunc('month', (now() at time zone 'America/Panama'))::date;
  select valor into t from config where clave='tarifas';
  return jsonb_build_object('ok', true, 'prepago', coalesce((t->>'aliado_prepago')::numeric, 300), 'comercios', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre, 'contacto', c.contacto, 'telefono', c.telefono, 'saldo', c.saldo, 'estado', c.estado, 'notas', c.notas, 'creado', c.creado,
      'mes_carros', (select count(*) from visitas v where v.comercio_id = c.id and v.dia_operativo >= mes),
      'mes_consumo', (select coalesce(sum(cubierto),0) from visitas v where v.comercio_id = c.id and v.dia_operativo >= mes),
      'ultima_recarga', (select max(creado) from comercio_movimientos m where m.comercio_id = c.id and m.tipo = 'recarga')
    ) order by c.estado, c.nombre) from comercios c), '[]'));
end $$;

create or replace function admin_comercio_upsert(p_sess text, p_id uuid, p_nombre text, p_contacto text, p_telefono text, p_pin text, p_estado text, p_notas text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; nid uuid;
begin
  s := pe_staff(p_sess, array['admin']);
  if p_pin is not null and length(p_pin) >= 4 and exists (select 1 from comercios where estado <> 'terminado' and (p_id is null or id <> p_id) and pin_hash = crypt(p_pin, pin_hash)) then
    return jsonb_build_object('ok', false, 'error', 'PIN_REPETIDO');
  end if;
  if p_id is null then
    if p_pin is null or length(p_pin) < 4 then return jsonb_build_object('ok', false, 'error', 'PIN_CORTO'); end if;
    insert into comercios (nombre, contacto, telefono, pin_hash, estado, notas)
      values (p_nombre, p_contacto, p_telefono, crypt(p_pin, gen_salt('bf')), coalesce(p_estado,'activo'), p_notas) returning id into nid;
  else
    update comercios set nombre = coalesce(p_nombre,nombre), contacto = coalesce(p_contacto,contacto), telefono = coalesce(p_telefono,telefono),
      pin_hash = case when p_pin is not null and length(p_pin) >= 4 then crypt(p_pin, gen_salt('bf')) else pin_hash end,
      estado = coalesce(p_estado,estado), notas = coalesce(p_notas,notas)
    where id = p_id returning id into nid;
    if p_estado in ('suspendido','terminado') then delete from comercio_sessions where comercio_id = p_id; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- recarga (cobro a la tarjeta de crédito del comercio, registrado a mano) o ajuste manual (+/−)
create or replace function admin_comercio_recarga(p_sess text, p_comercio uuid, p_monto numeric, p_referencia text, p_tipo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; nuevo numeric; tipo text;
begin
  s := pe_staff(p_sess, array['admin']);
  tipo := coalesce(p_tipo, 'recarga');
  if tipo not in ('recarga','ajuste') then return jsonb_build_object('ok', false, 'error', 'TIPO'); end if;
  if p_monto is null or p_monto = 0 then return jsonb_build_object('ok', false, 'error', 'MONTO'); end if;
  if tipo = 'recarga' and p_monto < 0 then return jsonb_build_object('ok', false, 'error', 'MONTO'); end if;
  nuevo := pe_comercio_mov(p_comercio, tipo, p_monto, null, p_referencia, s.id);
  return jsonb_build_object('ok', true, 'saldo', nuevo);
end $$;

-- estado de cuenta de un mes: saldo inicial, recargas, consumo, saldo final y qué cobrar al cierre
create or replace function admin_comercio_cuenta(p_sess text, p_comercio uuid, p_mes date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; c comercios; m date; m2 date; ini numeric; fin numeric; t jsonb; prepago numeric; saldo_actual numeric;
begin
  s := pe_staff(p_sess, array['admin']);
  select * into c from comercios where id = p_comercio;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'NO_EXISTE'); end if;
  m := date_trunc('month', p_mes)::date; m2 := (m + interval '1 month')::date;
  select valor into t from config where clave='tarifas'; prepago := coalesce((t->>'aliado_prepago')::numeric, 300);
  select coalesce(sum(monto),0) into ini from comercio_movimientos where comercio_id = p_comercio and (creado at time zone 'America/Panama')::date < m;
  select coalesce(sum(monto),0) into fin from comercio_movimientos where comercio_id = p_comercio and (creado at time zone 'America/Panama')::date < m2;
  saldo_actual := c.saldo;
  return jsonb_build_object('ok', true,
    'comercio', jsonb_build_object('id', c.id, 'nombre', c.nombre, 'contacto', c.contacto, 'telefono', c.telefono, 'saldo', c.saldo, 'estado', c.estado),
    'mes', m, 'prepago', prepago,
    'saldo_inicial', ini, 'saldo_final', fin,
    'recargas', (select coalesce(sum(monto),0) from comercio_movimientos where comercio_id = p_comercio and tipo in ('recarga','ajuste') and monto > 0 and (creado at time zone 'America/Panama')::date >= m and (creado at time zone 'America/Panama')::date < m2),
    'consumo', (select coalesce(-sum(monto),0) from comercio_movimientos where comercio_id = p_comercio and tipo = 'validacion' and (creado at time zone 'America/Panama')::date >= m and (creado at time zone 'America/Panama')::date < m2),
    'carros', (select count(*) from comercio_movimientos where comercio_id = p_comercio and tipo = 'validacion' and (creado at time zone 'America/Panama')::date >= m and (creado at time zone 'America/Panama')::date < m2),
    -- cierre: excedente consumido (saldo negativo) + prepago del mes entrante
    'cierre', jsonb_build_object('excedente', greatest(0, -fin), 'prepago', prepago, 'total', greatest(0, -fin) + prepago),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', mv.id, 'fecha', mv.creado, 'tipo', mv.tipo, 'monto', mv.monto, 'saldo', mv.saldo_despues, 'referencia', mv.referencia,
        'tarjeta', v.tarjeta, 'placa', v.placa, 'modelo', v.modelo, 'quien', st.nombre) order by mv.creado desc)
      from comercio_movimientos mv left join visitas v on v.id = mv.visita_id left join staff st on st.id = mv.staff_id
      where mv.comercio_id = p_comercio and (mv.creado at time zone 'America/Panama')::date >= m and (mv.creado at time zone 'America/Panama')::date < m2), '[]'));
end $$;

-- resumen admin: incluye lo cubierto por aliados como ingreso de servicio
create or replace function admin_resumen(p_sess text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; r jsonb;
begin
  s := pe_staff(p_sess, array['admin']);
  select jsonb_build_object(
    'carros', count(*) filter (where estado <> 'cancelado'),
    'entregados', count(*) filter (where estado = 'entregado'),
    'abiertos', count(*) filter (where tipo = 'abierto' and estado <> 'cancelado'),
    'mensuales', count(*) filter (where tipo = 'mensual'),
    'cortesias', count(*) filter (where tipo = 'cortesia'),
    'aliados', count(*) filter (where comercio_id is not null and estado <> 'cancelado'),
    'cubierto_aliados', coalesce(sum(cubierto) filter (where estado <> 'cancelado'), 0),
    'ingreso_servicio', coalesce(sum(tarifa + overnight + extra) filter (where pago_estado = 'pagado'), 0) + coalesce(sum(cubierto) filter (where estado <> 'cancelado'), 0),
    'propinas', coalesce(sum(propina) filter (where pago_estado = 'pagado'), 0),
    'total_cobrado', coalesce(sum(total) filter (where pago_estado = 'pagado'), 0) + coalesce(sum(cubierto) filter (where estado <> 'cancelado'), 0),
    'pendiente_cobro', coalesce(sum(total) filter (where pago_estado <> 'pagado' and estado <> 'cancelado'), 0),
    'por_metodo', (select coalesce(jsonb_object_agg(m, t), '{}') from (
        select pago_metodo m, sum(total) t from visitas where dia_operativo between p_desde and p_hasta and pago_estado = 'pagado' and pago_metodo is not null and total > 0 group by pago_metodo
        union all
        select 'aliado', sum(cubierto) from visitas where dia_operativo between p_desde and p_hasta and comercio_id is not null and estado <> 'cancelado' having sum(cubierto) > 0) x),
    'tiempo_entrega_prom_seg', (select avg(extract(epoch from (en_puerta_en - solicitado_en))) from visitas
        where dia_operativo between p_desde and p_hasta and en_puerta_en is not null and solicitado_en is not null),
    'calificacion_prom', avg(calificacion),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'carros', c, 'cobrado', t) order by d), '[]') from
        (select dia_operativo d, count(*) c, coalesce(sum(total) filter (where pago_estado='pagado'),0) + coalesce(sum(cubierto),0) t from visitas
          where dia_operativo between p_desde and p_hasta and estado <> 'cancelado' group by dia_operativo) y)
  ) into r from visitas where dia_operativo between p_desde and p_hasta;
  return jsonb_build_object('ok', true, 'resumen', r);
end $$;

-- ---------- permisos ----------
grant execute on function aliado_login(text), aliado_logout(text), aliado_estado(text), aliado_consultar(text,text), aliado_validar(text,text),
  admin_comercios_list(text), admin_comercio_upsert(text,uuid,text,text,text,text,text,text), admin_comercio_recarga(text,uuid,numeric,text,text), admin_comercio_cuenta(text,uuid,date) to anon;
revoke execute on function pe_comercio(text), pe_comercio_mov(uuid,text,numeric,uuid,text,uuid) from anon, authenticated, public;
