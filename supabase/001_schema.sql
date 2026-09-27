-- ParkEasy · esquema v1
-- Todo el acceso desde la app pasa por funciones RPC (security definer).
-- Las tablas NO son accesibles directamente con la llave anon.

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- ---------- helpers ----------
create or replace function pe_now_pa() returns timestamptz language sql stable as
$$ select now() $$;

-- día operativo: el día "de negocio" cambia a las 6am hora Panamá
create or replace function pe_dia_operativo(ts timestamptz) returns date language sql immutable as
$$ select ((ts at time zone 'America/Panama') - interval '6 hours')::date $$;

-- ---------- configuración ----------
create table if not exists config (
  clave text primary key,
  valor jsonb not null,
  actualizado timestamptz default now()
);
insert into config (clave, valor) values
 ('tarifas', '{"dia":5,"noche":6,"overnight":10,"mensual":100,"tarjeta_perdida":20,"hora_noche":17,"itbms_incluido":true}'),
 ('niveles', '{"C":{"max_lb":3000,"nombre":"Sedán"},"B":{"max_lb":4500,"nombre":"SUV mediano"},"A":{"max_lb":6000,"nombre":"SUV grande / pick-up"},"margen_lb":200}'),
 ('sitio',  '{"nombre":"ParkEasy · Loom","direccion":"San Francisco, frente a Plaza 76","abre":"09:00","cierra":"00:00","propinas":"pool por turno"}')
on conflict (clave) do nothing;

-- ---------- plazas ----------
create table if not exists plazas (
  plaza int not null check (plaza between 1 and 99),
  nivel char(1) not null check (nivel in ('A','B','C')),
  activa boolean not null default true,
  primary key (plaza, nivel)
);
insert into plazas (plaza, nivel)
select p, n from generate_series(1,23) p, unnest(array['A','B','C']) n
on conflict do nothing;

-- ---------- personal ----------
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rol text not null check (rol in ('admin','capitan','runner')),
  pin_hash text not null,
  activo boolean not null default true,
  creado timestamptz default now()
);
create table if not exists staff_sessions (
  token text primary key,
  staff_id uuid not null references staff(id),
  creado timestamptz default now(),
  ultimo_uso timestamptz default now()
);

-- ---------- tarjetas con QR ----------
create table if not exists tarjetas (
  codigo text primary key,              -- número impreso, ej. 1042
  token text not null unique,           -- secreto dentro del QR
  estado text not null default 'disponible' check (estado in ('disponible','en_uso','perdida','baja')),
  visita_actual uuid,
  creado timestamptz default now()
);

-- ---------- catálogo de modelos ----------
create table if not exists modelos (
  id serial primary key,
  nombre text not null unique,
  peso_lb int not null,
  fuente text not null default 'catalogo',   -- catalogo | manual | externo
  usos int not null default 0
);

-- ---------- mensuales ----------
create table if not exists mensuales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  placa text not null,
  modelo text,
  telefono text,
  activo boolean not null default true,
  creado timestamptz default now()
);
create unique index if not exists mensuales_placa on mensuales (upper(placa)) where activo;

-- ---------- visitas ----------
create table if not exists visitas (
  id uuid primary key default gen_random_uuid(),
  tarjeta text references tarjetas(codigo),
  estado text not null default 'recibido'
    check (estado in ('recibido','estacionado','solicitado','en_camino','en_puerta','entregado','cancelado')),
  -- vehículo
  placa text, modelo text, color text, peso_lb int, categoria text,
  nivel_sugerido char(1), plaza int, nivel char(1),
  fotos jsonb not null default '[]',
  -- tiempos
  recibido_en timestamptz not null default now(),
  estacionado_en timestamptz, solicitado_en timestamptz, en_camino_en timestamptz,
  en_puerta_en timestamptz, entregado_en timestamptz,
  cuando text,                       -- ahora | 5 | 10
  -- personal
  runner_recibe uuid references staff(id),
  runner_entrega uuid references staff(id),
  -- cobro
  tipo text not null default 'abierto' check (tipo in ('abierto','mensual','cortesia')),
  tarifa numeric(8,2) not null default 0,
  overnight numeric(8,2) not null default 0,
  extra numeric(8,2) not null default 0,         -- tarjeta perdida, etc.
  propina numeric(8,2) not null default 0,
  total numeric(8,2) generated always as (tarifa + overnight + extra + propina) stored,
  pago_metodo text check (pago_metodo in ('efectivo','yappy','tarjeta','mensual','cortesia')),
  pago_estado text not null default 'pendiente' check (pago_estado in ('pendiente','por_confirmar','pagado')),
  pago_confirmado_en timestamptz,
  pago_confirmado_por uuid references staff(id),
  pago_referencia text,
  tarjeta_perdida boolean not null default false,
  calificacion int check (calificacion between 1 and 5),
  notas text,
  dia_operativo date not null default pe_dia_operativo(now())
);
create index if not exists visitas_dia on visitas (dia_operativo);
create index if not exists visitas_estado on visitas (estado);

-- ---------- bitácora ----------
create table if not exists eventos (
  id bigserial primary key,
  visita uuid references visitas(id),
  staff_id uuid,
  tipo text not null,
  datos jsonb,
  creado timestamptz default now()
);

-- ---------- seguridad: nada directo para anon ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter table config enable row level security;
alter table plazas enable row level security;
alter table staff enable row level security;
alter table staff_sessions enable row level security;
alter table tarjetas enable row level security;
alter table modelos enable row level security;
alter table mensuales enable row level security;
alter table visitas enable row level security;
alter table eventos enable row level security;

-- ---------- funciones internas ----------
create or replace function pe_staff(p_sess text, p_roles text[]) returns staff
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  select st.* into s from staff_sessions ss join staff st on st.id = ss.staff_id
   where ss.token = p_sess and st.activo;
  if s.id is null then raise exception 'SESION_INVALIDA'; end if;
  if not (s.rol = any(p_roles)) then raise exception 'SIN_PERMISO'; end if;
  update staff_sessions set ultimo_uso = now() where token = p_sess;
  return s;
end $$;

create or replace function pe_log(p_visita uuid, p_staff uuid, p_tipo text, p_datos jsonb default null) returns void
language sql security definer set search_path = public, extensions as
$$ insert into eventos (visita, staff_id, tipo, datos) values (p_visita, p_staff, p_tipo, p_datos) $$;

create or replace function pe_nivel_para(p_peso int) returns char(1)
language plpgsql stable security definer set search_path = public, extensions as $$
declare n jsonb; m int;
begin
  select valor into n from config where clave='niveles';
  m := coalesce((n->>'margen_lb')::int, 200);
  if p_peso is null then return null; end if;
  if p_peso + m <= (n->'C'->>'max_lb')::int then return 'C'; end if;
  if p_peso + m <= (n->'B'->>'max_lb')::int then return 'B'; end if;
  if p_peso <= (n->'A'->>'max_lb')::int then return 'A'; end if;
  return 'X';
end $$;

-- plaza sugerida: nivel libre, prefiriendo la torre con menos carros encima/debajo
create or replace function pe_plaza_sugerida(p_nivel char) returns int
language sql stable security definer set search_path = public, extensions as $$
  with ocupadas as (
    select plaza, nivel from visitas where estado in ('estacionado','solicitado','en_camino','en_puerta') and plaza is not null
  )
  select p.plaza from plazas p
  where p.nivel = p_nivel and p.activa
    and not exists (select 1 from ocupadas o where o.plaza = p.plaza and o.nivel = p.nivel)
  order by (select count(*) from ocupadas o where o.plaza = p.plaza), p.plaza
  limit 1
$$;

create or replace function pe_tarifa_visita(v visitas) returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare t jsonb; h int;
begin
  if v.tipo <> 'abierto' then return 0; end if;
  select valor into t from config where clave='tarifas';
  h := extract(hour from (v.recibido_en at time zone 'America/Panama'));
  if h >= coalesce((t->>'hora_noche')::int,17) or h < 6 then return (t->>'noche')::numeric; end if;
  return (t->>'dia')::numeric;
end $$;

create or replace function pe_overnight_visita(v visitas) returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare t jsonb;
begin
  if v.tipo <> 'abierto' then return 0; end if;
  select valor into t from config where clave='tarifas';
  -- overnight: el carro sigue aquí en un día operativo distinto al de recepción
  if pe_dia_operativo(now()) > v.dia_operativo then return (t->>'overnight')::numeric; end if;
  return 0;
end $$;

create or replace function pe_visita_json(v visitas) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'id', v.id, 'tarjeta', v.tarjeta, 'estado', v.estado,
    'placa', v.placa, 'modelo', v.modelo, 'color', v.color, 'peso_lb', v.peso_lb, 'categoria', v.categoria,
    'nivel_sugerido', v.nivel_sugerido, 'plaza', v.plaza, 'nivel', v.nivel,
    'ubicacion', case when v.plaza is null then null else lpad(v.plaza::text,2,'0')||'-'||v.nivel end,
    'fotos', v.fotos,
    'recibido_en', v.recibido_en, 'estacionado_en', v.estacionado_en, 'solicitado_en', v.solicitado_en,
    'en_camino_en', v.en_camino_en, 'en_puerta_en', v.en_puerta_en, 'entregado_en', v.entregado_en,
    'cuando', v.cuando, 'tipo', v.tipo,
    'tarifa', v.tarifa, 'overnight', v.overnight, 'extra', v.extra, 'propina', v.propina, 'total', v.total,
    'pago_metodo', v.pago_metodo, 'pago_estado', v.pago_estado, 'pago_referencia', v.pago_referencia,
    'tarjeta_perdida', v.tarjeta_perdida, 'calificacion', v.calificacion, 'notas', v.notas,
    'runner_recibe', (select nombre from staff where id = v.runner_recibe),
    'runner_entrega', (select nombre from staff where id = v.runner_entrega),
    'dia_operativo', v.dia_operativo
  )
$$;

-- =====================================================================
-- CLIENTE (identificado por el token del QR)
-- =====================================================================
create or replace function pe_visita_por_token(p_token text) returns visitas
language plpgsql stable security definer set search_path = public, extensions as $$
declare v visitas;
begin
  select vi.* into v from tarjetas t join visitas vi on vi.id = t.visita_actual
   where t.token = p_token;
  return v;
end $$;

create or replace function cliente_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas; t tarjetas; s jsonb; cfg jsonb;
begin
  select * into t from tarjetas where token = p_token;
  if t.codigo is null then return jsonb_build_object('ok', false, 'error', 'TARJETA_INVALIDA'); end if;
  select valor into cfg from config where clave='sitio';
  select valor into s from config where clave='tarifas';
  if t.visita_actual is null then
    return jsonb_build_object('ok', true, 'tarjeta', t.codigo, 'visita', null, 'sitio', cfg);
  end if;
  select * into v from visitas where id = t.visita_actual;
  -- precio vigente (se recalcula mientras esté pendiente)
  if v.pago_estado = 'pendiente' and v.estado in ('recibido','estacionado') then
    update visitas set tarifa = pe_tarifa_visita(v), overnight = pe_overnight_visita(v) where id = v.id returning * into v;
  end if;
  return jsonb_build_object('ok', true, 'tarjeta', t.codigo, 'visita', pe_visita_json(v), 'sitio', cfg,
    'tarifas', s);
end $$;

create or replace function cliente_pedir(p_token text, p_cuando text, p_propina numeric, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas;
begin
  v := pe_visita_por_token(p_token);
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'SIN_VISITA'); end if;
  if v.estado not in ('recibido','estacionado') then return jsonb_build_object('ok', false, 'error', 'YA_SOLICITADO'); end if;
  if p_metodo not in ('efectivo','yappy','tarjeta') then return jsonb_build_object('ok', false, 'error', 'METODO'); end if;
  update visitas set
    estado = 'solicitado', solicitado_en = now(), cuando = coalesce(p_cuando,'ahora'),
    propina = greatest(coalesce(p_propina,0),0),
    tarifa = pe_tarifa_visita(v), overnight = pe_overnight_visita(v),
    pago_metodo = case when v.tipo='abierto' then p_metodo else v.pago_metodo end,
    pago_estado = case
        when v.tipo <> 'abierto' and coalesce(p_propina,0) = 0 then 'pagado'
        when p_metodo = 'efectivo' then 'pendiente'
        else 'por_confirmar' end
  where id = v.id returning * into v;
  perform pe_log(v.id, null, 'solicitado', jsonb_build_object('cuando', p_cuando, 'metodo', p_metodo, 'propina', p_propina));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function cliente_calificar(p_token text, p_estrellas int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas;
begin
  -- después de entregar, la tarjeta ya no apunta a la visita: buscar la última entregada con esa tarjeta
  select vi.* into v from tarjetas t join visitas vi on vi.tarjeta = t.codigo
   where t.token = p_token and vi.estado = 'entregado' order by vi.entregado_en desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false); end if;
  update visitas set calificacion = p_estrellas where id = v.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function cliente_ultima(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v visitas;
begin
  select vi.* into v from tarjetas t join visitas vi on vi.tarjeta = t.codigo
   where t.token = p_token and vi.estado = 'entregado' and vi.entregado_en > now() - interval '2 hours'
   order by vi.entregado_en desc limit 1;
  if v.id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- =====================================================================
-- PERSONAL
-- =====================================================================
create or replace function staff_login(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; tok text;
begin
  select * into s from staff where activo and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'PIN_INCORRECTO'); end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into staff_sessions (token, staff_id) values (tok, s.id);
  return jsonb_build_object('ok', true, 'token', tok, 'nombre', s.nombre, 'rol', s.rol, 'id', s.id);
end $$;

create or replace function staff_yo(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  return jsonb_build_object('ok', true, 'nombre', s.nombre, 'rol', s.rol, 'id', s.id);
exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

create or replace function staff_logout(p_sess text) returns void
language sql security definer set search_path = public, extensions as
$$ delete from staff_sessions where token = p_sess $$;

-- cupos por nivel
create or replace function pe_cupos() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_object_agg(n, jsonb_build_object('total', total, 'libres', total - ocupadas)) from (
    select p.nivel n, count(*) total,
      (select count(*) from visitas v where v.nivel = p.nivel and v.estado in ('estacionado','solicitado','en_camino','en_puerta')) ocupadas
    from plazas p where p.activa group by p.nivel) x
$$;

-- mapa de ocupación (para tablero): plaza -> {A:visita|null,...}
create or replace function pe_mapa() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_agg(jsonb_build_object('plaza', p.plaza,
    'A', (select jsonb_build_object('id', v.id,'placa',v.placa,'modelo',v.modelo,'estado',v.estado) from visitas v where v.plaza=p.plaza and v.nivel='A' and v.estado in ('estacionado','solicitado','en_camino','en_puerta') limit 1),
    'B', (select jsonb_build_object('id', v.id,'placa',v.placa,'modelo',v.modelo,'estado',v.estado) from visitas v where v.plaza=p.plaza and v.nivel='B' and v.estado in ('estacionado','solicitado','en_camino','en_puerta') limit 1),
    'C', (select jsonb_build_object('id', v.id,'placa',v.placa,'modelo',v.modelo,'estado',v.estado) from visitas v where v.plaza=p.plaza and v.nivel='C' and v.estado in ('estacionado','solicitado','en_camino','en_puerta') limit 1)
  ) order by p.plaza) from (select distinct plaza from plazas where activa) p
$$;

-- =====================================================================
-- RUNNER
-- =====================================================================
create or replace function runner_estado(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  return jsonb_build_object('ok', true,
    'yo', jsonb_build_object('nombre', s.nombre, 'rol', s.rol, 'id', s.id),
    'cola', coalesce((select jsonb_agg(pe_visita_json(v) order by
                 case v.estado when 'en_puerta' then 0 when 'en_camino' then 1 else 2 end, v.solicitado_en)
              from visitas v where v.estado in ('solicitado','en_camino','en_puerta')), '[]'),
    'pendientes', coalesce((select jsonb_agg(pe_visita_json(v) order by v.recibido_en)
              from visitas v where v.estado = 'recibido'), '[]'),
    'custodia', (select count(*) from visitas where estado in ('estacionado','solicitado','en_camino','en_puerta')),
    'cupos', pe_cupos(),
    'ahora', now());
end $$;

create or replace function runner_recibir(p_sess text, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; t tarjetas; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into t from tarjetas where codigo = p_codigo or token = p_codigo;
  if t.codigo is null then return jsonb_build_object('ok', false, 'error', 'TARJETA_NO_EXISTE'); end if;
  if t.estado <> 'disponible' then
    return jsonb_build_object('ok', false, 'error', 'TARJETA_EN_USO', 'visita', t.visita_actual);
  end if;
  insert into visitas (tarjeta, runner_recibe) values (t.codigo, s.id) returning * into v;
  update visitas set tarifa = pe_tarifa_visita(v) where id = v.id returning * into v;
  update tarjetas set estado = 'en_uso', visita_actual = v.id where codigo = t.codigo;
  perform pe_log(v.id, s.id, 'recibido', jsonb_build_object('tarjeta', t.codigo));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function runner_fotos(p_sess text, p_visita uuid, p_fotos jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  update visitas set fotos = p_fotos where id = p_visita returning * into v;
  return jsonb_build_object('ok', v.id is not null, 'visita', pe_visita_json(v));
end $$;

create or replace function buscar_modelo(p_q text) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'peso_lb', peso_lb, 'nivel', pe_nivel_para(peso_lb), 'fuente', fuente) order by usos desc, nombre), '[]')
  from (
    select * from modelos
    where p_q is not null and length(trim(p_q)) >= 2
      and (select bool_and(case when length(w) >= 3 then unaccent(lower(nombre)) like '%'||unaccent(lower(w))||'%'
                                else (' '||unaccent(lower(nombre))) like '% '||unaccent(lower(w))||'%' end)
           from regexp_split_to_table(trim(p_q), '\s+') w)
    limit 8) m
$$;

-- datos del vehículo: devuelve nivel y plaza sugerida
create or replace function runner_datos(p_sess text, p_visita uuid, p_placa text, p_modelo text, p_peso int, p_categoria text, p_color text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; peso int; niv char(1); m mensuales; sug int;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  peso := p_peso;
  if peso is null and p_categoria is not null then
    peso := case p_categoria when 'sedan' then 2600 when 'suv_mediano' then 4000 when 'suv_grande' then 5300 else null end;
  end if;
  niv := pe_nivel_para(peso);
  select * into m from mensuales where activo and upper(placa) = upper(trim(p_placa));
  update visitas set placa = upper(trim(p_placa)), modelo = p_modelo, peso_lb = peso, categoria = p_categoria, color = p_color,
    nivel_sugerido = niv,
    tipo = case when m.id is not null then 'mensual' else tipo end,
    tarifa = case when m.id is not null then 0 else tarifa end,
    pago_metodo = case when m.id is not null then 'mensual' else pago_metodo end,
    pago_estado = case when m.id is not null then 'pagado' else pago_estado end
  where id = p_visita returning * into v;
  -- el catálogo se alimenta solo
  if p_modelo is not null and peso is not null then
    insert into modelos (nombre, peso_lb, fuente, usos) values (p_modelo, peso, case when p_peso is null then 'manual' else 'catalogo' end, 1)
    on conflict (nombre) do update set usos = modelos.usos + 1;
  end if;
  sug := case when niv in ('A','B','C') then pe_plaza_sugerida(niv) else null end;
  perform pe_log(v.id, s.id, 'datos', jsonb_build_object('placa', p_placa, 'modelo', p_modelo, 'peso', peso, 'nivel', niv));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v), 'nivel', niv, 'plaza_sugerida', sug,
    'mensual', m.id is not null, 'mensual_nombre', m.nombre);
end $$;

create or replace function runner_ubicar(p_sess text, p_visita uuid, p_plaza int, p_nivel char) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; ocupada uuid;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select id into ocupada from visitas where plaza = p_plaza and nivel = p_nivel and id <> p_visita
     and estado in ('estacionado','solicitado','en_camino','en_puerta') limit 1;
  if ocupada is not null then return jsonb_build_object('ok', false, 'error', 'PLAZA_OCUPADA'); end if;
  update visitas set plaza = p_plaza, nivel = p_nivel,
    estado = case when estado = 'recibido' then 'estacionado' else estado end,
    estacionado_en = coalesce(estacionado_en, now())
  where id = p_visita returning * into v;
  perform pe_log(v.id, s.id, 'estacionado', jsonb_build_object('plaza', p_plaza, 'nivel', p_nivel));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function runner_tomar(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  update visitas set estado = 'en_camino', en_camino_en = now(), runner_entrega = s.id
   where id = p_visita and estado = 'solicitado' returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'YA_TOMADO'); end if;
  perform pe_log(v.id, s.id, 'en_camino');
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function runner_en_puerta(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  update visitas set estado = 'en_puerta', en_puerta_en = now(), runner_entrega = coalesce(runner_entrega, s.id)
   where id = p_visita and estado in ('solicitado','en_camino') returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'ESTADO'); end if;
  perform pe_log(v.id, s.id, 'en_puerta');
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- cobro en efectivo: lo registra quien recibe el dinero
create or replace function runner_cobrar_efectivo(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into v from visitas where id = p_visita;
  if v.pago_metodo <> 'efectivo' then return jsonb_build_object('ok', false, 'error', 'NO_ES_EFECTIVO'); end if;
  update visitas set pago_estado = 'pagado', pago_confirmado_en = now(), pago_confirmado_por = s.id
   where id = p_visita returning * into v;
  perform pe_log(v.id, s.id, 'pago_efectivo', jsonb_build_object('total', v.total));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

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
  update visitas set estado = 'entregado', entregado_en = now(), runner_entrega = coalesce(runner_entrega, s.id)
   where id = p_visita returning * into v;
  update tarjetas set estado = case when v.tarjeta_perdida then 'perdida' else 'disponible' end, visita_actual = null where codigo = v.tarjeta;
  perform pe_log(v.id, s.id, 'entregado');
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function runner_visita(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into v from visitas where id = p_visita;
  return jsonb_build_object('ok', v.id is not null, 'visita', pe_visita_json(v));
end $$;

-- =====================================================================
-- CAPITÁN / TABLERO (operativo, sin dinero agregado)
-- =====================================================================
create or replace function ops_estado(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  return jsonb_build_object('ok', true,
    'cola', coalesce((select jsonb_agg(pe_visita_json(v) order by
                 case v.estado when 'en_puerta' then 0 when 'en_camino' then 1 else 2 end, v.solicitado_en)
              from visitas v where v.estado in ('solicitado','en_camino','en_puerta')), '[]'),
    'sin_ubicacion', coalesce((select jsonb_agg(pe_visita_json(v) order by v.recibido_en) from visitas v where v.estado = 'recibido'), '[]'),
    'por_confirmar', coalesce((select jsonb_agg(pe_visita_json(v) order by v.solicitado_en) from visitas v where v.pago_estado = 'por_confirmar' and v.estado not in ('entregado','cancelado')), '[]'),
    'custodia_lista', coalesce((select jsonb_agg(pe_visita_json(v) order by v.plaza, v.nivel) from visitas v where v.estado in ('estacionado','solicitado','en_camino','en_puerta')), '[]'),
    'custodia', (select count(*) from visitas where estado in ('estacionado','solicitado','en_camino','en_puerta')),
    'cupos', pe_cupos(), 'mapa', pe_mapa(),
    'runners', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'rol', rol, 'ultimo_uso', uu)) from
                 (select st.nombre, st.rol, max(ss.ultimo_uso) uu from staff_sessions ss join staff st on st.id = ss.staff_id
                   where ss.ultimo_uso > now() - interval '12 hours' group by st.id, st.nombre, st.rol) q), '[]'),
    'ahora', now());
end $$;

-- confirmación manual de Yappy / tarjeta (hasta que entre el webhook)
create or replace function ops_confirmar_pago(p_sess text, p_visita uuid, p_referencia text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  update visitas set pago_estado = 'pagado', pago_confirmado_en = now(), pago_confirmado_por = s.id, pago_referencia = p_referencia
   where id = p_visita and pago_metodo in ('yappy','tarjeta') returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APLICA'); end if;
  perform pe_log(v.id, s.id, 'pago_confirmado_manual', jsonb_build_object('metodo', v.pago_metodo, 'ref', p_referencia, 'total', v.total));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- cambiar método de pago (ej. cliente sin Yappy paga en efectivo)
create or replace function ops_cambiar_metodo(p_sess text, p_visita uuid, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  update visitas set pago_metodo = p_metodo, pago_estado = case when p_metodo = 'efectivo' then 'pendiente' else 'por_confirmar' end
   where id = p_visita and pago_estado <> 'pagado' and p_metodo in ('efectivo','yappy','tarjeta') returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APLICA'); end if;
  perform pe_log(v.id, s.id, 'cambio_metodo', jsonb_build_object('metodo', p_metodo));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- el cliente perdió la tarjeta: se cobra el extra y se libera la tarjeta al entregar
create or replace function ops_tarjeta_perdida(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas; t jsonb;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  select valor into t from config where clave='tarifas';
  update visitas set tarjeta_perdida = true, extra = (t->>'tarjeta_perdida')::numeric,
    pago_estado = case when pago_estado = 'pagado' and (t->>'tarjeta_perdida')::numeric > 0 then 'pendiente' else pago_estado end,
    pago_metodo = coalesce(pago_metodo, 'efectivo')
   where id = p_visita and estado <> 'entregado' returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'NO_APLICA'); end if;
  perform pe_log(v.id, s.id, 'tarjeta_perdida', jsonb_build_object('extra', v.extra));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

-- pedir el carro desde el stand (cliente sin celular / sin señal)
create or replace function ops_pedir(p_sess text, p_visita uuid, p_metodo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan','runner']);
  select * into v from visitas where id = p_visita;
  if v.id is null or v.estado not in ('recibido','estacionado') then return jsonb_build_object('ok', false, 'error', 'ESTADO'); end if;
  update visitas set estado = 'solicitado', solicitado_en = now(), cuando = 'ahora',
    tarifa = pe_tarifa_visita(v), overnight = pe_overnight_visita(v),
    pago_metodo = case when v.tipo='abierto' then coalesce(p_metodo,'efectivo') else v.pago_metodo end,
    pago_estado = case when v.tipo <> 'abierto' then 'pagado' when coalesce(p_metodo,'efectivo') = 'efectivo' then 'pendiente' else 'por_confirmar' end
  where id = v.id returning * into v;
  perform pe_log(v.id, s.id, 'solicitado_stand', jsonb_build_object('metodo', p_metodo));
  return jsonb_build_object('ok', true, 'visita', pe_visita_json(v));
end $$;

create or replace function ops_cancelar(p_sess text, p_visita uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; v visitas;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  update visitas set estado = 'cancelado', notas = coalesce(notas,'') || ' [cancelado: '||coalesce(p_motivo,'')||']' where id = p_visita and estado <> 'entregado' returning * into v;
  if v.id is null then return jsonb_build_object('ok', false); end if;
  update tarjetas set estado = 'disponible', visita_actual = null where codigo = v.tarjeta;
  perform pe_log(v.id, s.id, 'cancelado', jsonb_build_object('motivo', p_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- ADMINISTRACIÓN (solo dueño)
-- =====================================================================
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
    'ingreso_servicio', coalesce(sum(tarifa + overnight + extra) filter (where pago_estado = 'pagado'), 0),
    'propinas', coalesce(sum(propina) filter (where pago_estado = 'pagado'), 0),
    'total_cobrado', coalesce(sum(total) filter (where pago_estado = 'pagado'), 0),
    'pendiente_cobro', coalesce(sum(total) filter (where pago_estado <> 'pagado' and estado <> 'cancelado'), 0),
    'por_metodo', (select coalesce(jsonb_object_agg(m, t), '{}') from (select pago_metodo m, sum(total) t from visitas
        where dia_operativo between p_desde and p_hasta and pago_estado = 'pagado' and pago_metodo is not null group by pago_metodo) x),
    'tiempo_entrega_prom_seg', (select avg(extract(epoch from (en_puerta_en - solicitado_en))) from visitas
        where dia_operativo between p_desde and p_hasta and en_puerta_en is not null and solicitado_en is not null),
    'calificacion_prom', avg(calificacion),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'carros', c, 'cobrado', t) order by d), '[]') from
        (select dia_operativo d, count(*) c, coalesce(sum(total) filter (where pago_estado='pagado'),0) t from visitas
          where dia_operativo between p_desde and p_hasta and estado <> 'cancelado' group by dia_operativo) y)
  ) into r from visitas where dia_operativo between p_desde and p_hasta;
  return jsonb_build_object('ok', true, 'resumen', r);
end $$;

create or replace function admin_visitas(p_sess text, p_desde date, p_hasta date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'visitas', coalesce((select jsonb_agg(pe_visita_json(v) order by v.recibido_en desc)
    from visitas v where v.dia_operativo between p_desde and p_hasta), '[]'));
end $$;

-- corte de caja: efectivo por quien lo recibió
create or replace function admin_corte(p_sess text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true,
    'efectivo_por_persona', coalesce((select jsonb_agg(jsonb_build_object('nombre', st.nombre, 'carros', c, 'monto', m)) from
       (select pago_confirmado_por p, count(*) c, sum(total) m from visitas where dia_operativo = p_dia and pago_metodo='efectivo' and pago_estado='pagado' group by pago_confirmado_por) x
       join staff st on st.id = x.p), '[]'),
    'digital', coalesce((select jsonb_agg(jsonb_build_object('metodo', pago_metodo, 'carros', c, 'monto', m, 'referencias', refs)) from
       (select pago_metodo, count(*) c, sum(total) m, jsonb_agg(jsonb_build_object('tarjeta', tarjeta, 'placa', placa, 'total', total, 'ref', pago_referencia, 'hora', pago_confirmado_en)) refs
        from visitas where dia_operativo = p_dia and pago_metodo in ('yappy','tarjeta') and pago_estado='pagado' group by pago_metodo) y), '[]'),
    'propinas_pool', (select coalesce(sum(propina),0) from visitas where dia_operativo = p_dia and pago_estado='pagado'),
    'turnos', coalesce((select jsonb_agg(jsonb_build_object('nombre', st.nombre, 'rol', st.rol, 'recibidos', r, 'entregados', e)) from
       (select st.id sid, count(*) filter (where v.runner_recibe = st.id) r, count(*) filter (where v.runner_entrega = st.id) e
        from staff st join visitas v on (v.runner_recibe = st.id or v.runner_entrega = st.id) and v.dia_operativo = p_dia group by st.id) z
       join staff st on st.id = z.sid), '[]'));
end $$;

create or replace function admin_config_get(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'config', (select jsonb_object_agg(clave, valor) from config));
end $$;

create or replace function admin_config_set(p_sess text, p_clave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  insert into config (clave, valor, actualizado) values (p_clave, p_valor, now())
    on conflict (clave) do update set valor = excluded.valor, actualizado = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_staff_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'rol', rol, 'activo', activo) order by rol, nombre) from staff), '[]'));
end $$;

create or replace function admin_staff_upsert(p_sess text, p_id uuid, p_nombre text, p_rol text, p_pin text, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; nid uuid;
begin
  s := pe_staff(p_sess, array['admin']);
  if p_id is null then
    if p_pin is null or length(p_pin) < 4 then return jsonb_build_object('ok', false, 'error', 'PIN_CORTO'); end if;
    if exists (select 1 from staff where activo and pin_hash = crypt(p_pin, pin_hash)) then return jsonb_build_object('ok', false, 'error', 'PIN_REPETIDO'); end if;
    insert into staff (nombre, rol, pin_hash, activo) values (p_nombre, p_rol, crypt(p_pin, gen_salt('bf')), coalesce(p_activo, true)) returning id into nid;
  else
    if p_pin is not null and length(p_pin) >= 4 and exists (select 1 from staff where activo and id <> p_id and pin_hash = crypt(p_pin, pin_hash)) then
      return jsonb_build_object('ok', false, 'error', 'PIN_REPETIDO'); end if;
    update staff set nombre = coalesce(p_nombre, nombre), rol = coalesce(p_rol, rol), activo = coalesce(p_activo, activo),
      pin_hash = case when p_pin is not null and length(p_pin) >= 4 then crypt(p_pin, gen_salt('bf')) else pin_hash end
    where id = p_id returning id into nid;
    if p_activo is false then delete from staff_sessions where staff_id = p_id; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

create or replace function admin_mensuales_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'mensuales', coalesce((select jsonb_agg(to_jsonb(m) order by nombre) from mensuales m), '[]'));
end $$;

create or replace function admin_mensual_upsert(p_sess text, p_id uuid, p_nombre text, p_placa text, p_modelo text, p_telefono text, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; nid uuid;
begin
  s := pe_staff(p_sess, array['admin']);
  if p_id is null then
    insert into mensuales (nombre, placa, modelo, telefono, activo) values (p_nombre, upper(trim(p_placa)), p_modelo, p_telefono, coalesce(p_activo,true)) returning id into nid;
  else
    update mensuales set nombre = coalesce(p_nombre,nombre), placa = coalesce(upper(trim(p_placa)),placa), modelo = coalesce(p_modelo,modelo),
      telefono = coalesce(p_telefono,telefono), activo = coalesce(p_activo,activo) where id = p_id returning id into nid;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

create or replace function admin_tarjetas_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'tarjetas', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'token', token, 'estado', estado, 'visita_actual', visita_actual) order by codigo) from tarjetas), '[]'));
end $$;

create or replace function admin_tarjetas_generar(p_sess text, p_desde int, p_hasta int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; n int := 0; i int;
begin
  s := pe_staff(p_sess, array['admin']);
  for i in p_desde..p_hasta loop
    insert into tarjetas (codigo, token) values (i::text, encode(gen_random_bytes(9), 'hex')) on conflict do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'creadas', n);
end $$;

create or replace function admin_tarjeta_estado(p_sess text, p_codigo text, p_estado text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  update tarjetas set estado = p_estado, visita_actual = case when p_estado = 'disponible' then null else visita_actual end where codigo = p_codigo and p_estado in ('disponible','perdida','baja');
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_modelos_list(p_sess text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  return jsonb_build_object('ok', true, 'modelos', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'peso_lb', peso_lb, 'fuente', fuente, 'usos', usos, 'nivel', pe_nivel_para(peso_lb)) order by nombre) from modelos), '[]'));
end $$;

create or replace function admin_modelo_upsert(p_sess text, p_nombre text, p_peso int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin']);
  insert into modelos (nombre, peso_lb, fuente) values (p_nombre, p_peso, 'catalogo') on conflict (nombre) do update set peso_lb = excluded.peso_lb, fuente = 'catalogo';
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_eventos(p_sess text, p_visita uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s staff;
begin
  s := pe_staff(p_sess, array['admin','capitan']);
  return jsonb_build_object('ok', true, 'eventos', coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'datos', e.datos, 'creado', e.creado, 'quien', st.nombre) order by e.creado)
    from eventos e left join staff st on st.id = e.staff_id where e.visita = p_visita), '[]'));
end $$;

-- ---------- permisos de ejecución ----------
grant usage on schema public to anon;
grant execute on function
  cliente_estado(text), cliente_pedir(text,text,numeric,text), cliente_calificar(text,int), cliente_ultima(text),
  staff_login(text), staff_yo(text), staff_logout(text),
  runner_estado(text), runner_recibir(text,text), runner_fotos(text,uuid,jsonb), buscar_modelo(text),
  runner_datos(text,uuid,text,text,int,text,text), runner_ubicar(text,uuid,int,char), runner_tomar(text,uuid),
  runner_en_puerta(text,uuid), runner_cobrar_efectivo(text,uuid), runner_entregar(text,uuid,text), runner_visita(text,uuid),
  ops_estado(text), ops_confirmar_pago(text,uuid,text), ops_cambiar_metodo(text,uuid,text), ops_tarjeta_perdida(text,uuid),
  ops_pedir(text,uuid,text), ops_cancelar(text,uuid,text),
  admin_resumen(text,date,date), admin_visitas(text,date,date), admin_corte(text,date), admin_config_get(text), admin_config_set(text,text,jsonb),
  admin_staff_list(text), admin_staff_upsert(text,uuid,text,text,text,boolean), admin_mensuales_list(text),
  admin_mensual_upsert(text,uuid,text,text,text,text,boolean), admin_tarjetas_list(text), admin_tarjetas_generar(text,int,int),
  admin_tarjeta_estado(text,text,text), admin_modelos_list(text), admin_modelo_upsert(text,text,int), admin_eventos(text,uuid)
to anon;

-- las funciones internas no se exponen
revoke execute on function pe_staff(text,text[]), pe_log(uuid,uuid,text,jsonb), pe_visita_json(visitas), pe_visita_por_token(text),
  pe_tarifa_visita(visitas), pe_overnight_visita(visitas), pe_cupos(), pe_mapa(), pe_plaza_sugerida(char), pe_nivel_para(int) from anon, authenticated, public;
