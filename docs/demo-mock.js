/* ParkEasy · DEMO: backend simulado en memoria (no toca la base real). Solo para probar botones. */
(function () {
  'use strict';
  window.PE_CONFIG = { SUPABASE_URL: 'https://demo.invalid', SUPABASE_ANON_KEY: 'demo', APP_NAME: 'ParkEasy', SITIO_SUB: 'DEMO · datos de prueba' };
  var MODELOS = [['Toyota Corolla', 2900], ['Toyota Yaris', 2400], ['Toyota Camry', 3400], ['Toyota RAV4', 3600], ['Toyota Fortuner', 4700], ['Toyota Hilux', 4800], ['Toyota Prado', 5200], ['Toyota Land Cruiser', 5800], ['Honda Civic', 2900], ['Honda CR-V', 3500], ['Honda Pilot', 4300], ['Hyundai Tucson', 3500], ['Hyundai Santa Fe', 4000], ['Hyundai Accent', 2600], ['Kia Rio', 2700], ['Kia Sportage', 3600], ['Kia Sorento', 4100], ['Nissan Sentra', 3000], ['Nissan X-Trail', 3500], ['Nissan Frontier', 4500], ['Mazda 3', 3100], ['Mazda CX-5', 3600], ['Ford Explorer', 4500], ['Ford F-150', 5000], ['Chevrolet Tahoe', 5600], ['BMW X5', 4900], ['Mercedes-Benz GLC', 4100], ['Tesla Model 3', 3900], ['Tesla Model Y', 4400], ['Mitsubishi Montero', 4900]];
  var TRAMOS = [[240, 5], [480, 10], [720, 15], [1440, 60]], ADIC = 60, GRACIA = 10;
  var ST = { tarjetas: {}, visitas: {}, fotos: {}, seq: 1, staff: { '1111': { id: 's1', nombre: 'Luis', rol: 'runner' }, '2222': { id: 's2', nombre: 'Carlos', rol: 'capitan' }, '123456': { id: 's3', nombre: 'Jimmy', rol: 'admin' } }, sess: {} };
  for (var i = 1001; i <= 1030; i++) ST.tarjetas[String(i)] = { codigo: String(i), token: 'demo' + i, estado: 'disponible', visita_actual: null, tipo: 'publica' };
  // un carro ya en custodia para que la cola no esté vacía
  function seed() {
    var v = nueva('1001', 's1'); v.placa = 'AB 1234'; v.modelo = 'Toyota Fortuner'; v.color = 'Blanco'; v.peso_lb = 4700; v.nivel_sugerido = 'A'; v.estado = 'estacionado'; v.plaza = 5; v.nivel = 'A';
    v.recibido_en = new Date(Date.now() - 50 * 60000).toISOString(); v.estacionado_en = v.recibido_en;
    var w = nueva('1002', 's1'); w.placa = 'CD 5678'; w.modelo = 'Kia Rio'; w.color = 'Rojo'; w.peso_lb = 2700; w.nivel_sugerido = 'C'; w.estado = 'estacionado'; w.plaza = 12; w.nivel = 'C';
    w.recibido_en = new Date(Date.now() - 2 * 3600000).toISOString(); w.estacionado_en = w.recibido_en;
  }
  function nueva(codigo, staffId) {
    var id = 'v' + (ST.seq++);
    var v = { id: id, tarjeta: codigo, estado: 'recibido', placa: null, modelo: null, color: null, peso_lb: null, categoria: null, nivel_sugerido: null, plaza: null, nivel: null, fotos: [],
      recibido_en: new Date().toISOString(), estacionado_en: null, solicitado_en: null, en_camino_en: null, en_puerta_en: null, entregado_en: null, cuando: null,
      runner_recibe: staffId, runner_entrega: null, tipo: 'abierto', tarifa: 0, overnight: 0, extra: 0, propina: 0, pago_metodo: null, pago_estado: 'pendiente', pago_referencia: null,
      tarjeta_perdida: false, calificacion: null, minutos: null, comercio_id: null, cubierto: 0, comercio: null };
    ST.visitas[id] = v; ST.tarjetas[codigo].estado = 'en_uso'; ST.tarjetas[codigo].visita_actual = id;
    return v;
  }
  function nombreStaff(id) { for (var k in ST.staff) if (ST.staff[k].id === id) return ST.staff[k].nombre; return null; }
  function precioMin(m) { if (m <= 0) m = 1; for (var i = 0; i < TRAMOS.length; i++) if (m <= TRAMOS[i][0]) return TRAMOS[i][1]; var ult = TRAMOS[TRAMOS.length - 1]; return ult[1] + ADIC * Math.ceil((m - ult[0]) / 1440); }
  function cotizar(desde, hasta) {
    var min = Math.max(0, Math.ceil((new Date(hasta) - new Date(desde)) / 60000)), ef = Math.max(1, min - GRACIA), precio = precioMin(ef), subeEn = null, subeA = null;
    for (var i = 0; i < TRAMOS.length; i++) if (ef <= TRAMOS[i][0]) { subeEn = new Date(new Date(desde).getTime() + (TRAMOS[i][0] + GRACIA) * 60000).toISOString(); subeA = precioMin(TRAMOS[i][0] + 1); break; }
    return { minutos: min, precio: precio, sube_a: subeA, sube_en: subeEn };
  }
  function json(v) {
    var cot = (v.estado === 'recibido' || v.estado === 'estacionado') ? cotizar(v.recibido_en, new Date().toISOString()) : { minutos: v.minutos, precio: v.tarifa + v.cubierto };
    var o = {}; for (var k in v) o[k] = v[k];
    o.total = v.tarifa + v.overnight + v.extra + v.propina; o.ubicacion = v.plaza ? (v.plaza < 10 ? '0' : '') + v.plaza + '-' + v.nivel : null;
    o.runner_recibe = nombreStaff(v.runner_recibe); o.runner_entrega = nombreStaff(v.runner_entrega); o.cotizacion = cot; o.dia_operativo = new Date().toISOString().slice(0, 10);
    return o;
  }
  function nivelPara(lb) { if (!lb) return null; if (lb + 200 <= 3000) return 'C'; if (lb + 200 <= 4500) return 'B'; if (lb <= 6000) return 'A'; return 'X'; }
  function activas() { return Object.keys(ST.visitas).map(function (k) { return ST.visitas[k]; }).filter(function (v) { return ['estacionado', 'solicitado', 'en_camino', 'en_puerta'].indexOf(v.estado) >= 0; }); }
  function cupos() { var r = {}; ['A', 'B', 'C'].forEach(function (n) { var oc = activas().filter(function (v) { return v.nivel === n; }).length; r[n] = { total: 23, libres: 23 - oc }; }); return r; }
  function plazaSugerida(n) { var oc = {}; activas().forEach(function (v) { oc[v.plaza + v.nivel] = 1; }); for (var p = 1; p <= 23; p++) if (!oc[p + n]) return p; return null; }
  function staff(p) { var s = ST.sess[p.p_sess]; if (!s) throw new Error('SESION_INVALIDA'); return s; }
  function porToken(t) { for (var k in ST.tarjetas) if (ST.tarjetas[k].token === t) return ST.tarjetas[k]; return null; }
  function tarifario() { return { tramos: TRAMOS.map(function (t) { return { hasta_min: t[0], precio: t[1] }; }), por_24h_adicional: ADIC, gracia_min: GRACIA, tarjeta_perdida: 20, itbms_incluido: true }; }

  var RPC = {
    staff_login: function (p) { var s = ST.staff[p.p_pin]; if (!s) return { ok: false, error: 'PIN_INCORRECTO' }; var tok = 'demo-' + Math.random().toString(36).slice(2); ST.sess[tok] = s; return { ok: true, token: tok, nombre: s.nombre, rol: s.rol, id: s.id }; },
    staff_logout: function (p) { delete ST.sess[p.p_sess]; return null; },
    staff_yo: function (p) { var s = staff(p); return { ok: true, nombre: s.nombre, rol: s.rol, id: s.id }; },
    runner_estado: function (p) {
      var s = staff(p), all = Object.keys(ST.visitas).map(function (k) { return ST.visitas[k]; });
      var ord = { en_puerta: 0, en_camino: 1, solicitado: 2 };
      return { ok: true, yo: { nombre: s.nombre, rol: s.rol, id: s.id },
        cola: all.filter(function (v) { return ord[v.estado] != null; }).sort(function (a, b) { return (ord[a.estado] - ord[b.estado]) || (a.solicitado_en < b.solicitado_en ? -1 : 1); }).map(json),
        pendientes: all.filter(function (v) { return v.estado === 'recibido'; }).map(json),
        custodia: activas().length, cupos: cupos(), ahora: new Date().toISOString() };
    },
    runner_recibir: function (p) {
      var s = staff(p), t = ST.tarjetas[p.p_codigo] || porToken(p.p_codigo);
      if (!t) return { ok: false, error: 'TARJETA_NO_EXISTE' };
      if (t.estado !== 'disponible') return { ok: false, error: 'TARJETA_EN_USO', visita: t.visita_actual };
      return { ok: true, visita: json(nueva(t.codigo, s.id)), contrato: null, aviso: null };
    },
    runner_fotos: function (p) { staff(p); var v = ST.visitas[p.p_visita]; v.fotos = p.p_fotos || []; return { ok: true, visita: json(v) }; },
    buscar_modelo: function (p) {
      var q = String(p.p_q || '').toLowerCase().trim(); if (q.length < 2) return [];
      var words = q.split(/\s+/);
      return MODELOS.filter(function (m) { var n = m[0].toLowerCase(); return words.every(function (w) { return n.indexOf(w) >= 0; }); }).slice(0, 8).map(function (m) { return { nombre: m[0], peso_lb: m[1], nivel: nivelPara(m[1]) }; });
    },
    runner_datos: function (p) {
      staff(p); var v = ST.visitas[p.p_visita], peso = p.p_peso;
      if (peso == null && p.p_categoria) peso = { sedan: 2600, suv_mediano: 4000, suv_grande: 5300 }[p.p_categoria];
      v.placa = String(p.p_placa || '').toUpperCase().trim(); v.modelo = p.p_modelo; v.peso_lb = peso; v.categoria = p.p_categoria; v.color = p.p_color; v.nivel_sugerido = nivelPara(peso);
      return { ok: true, visita: json(v), nivel: v.nivel_sugerido, plaza_sugerida: v.nivel_sugerido && v.nivel_sugerido !== 'X' ? plazaSugerida(v.nivel_sugerido) : null, mensual: false };
    },
    runner_ubicar: function (p) {
      staff(p); var v = ST.visitas[p.p_visita];
      if (activas().some(function (x) { return x.id !== v.id && x.plaza === Number(p.p_plaza) && x.nivel === p.p_nivel; })) return { ok: false, error: 'PLAZA_OCUPADA' };
      v.plaza = Number(p.p_plaza); v.nivel = p.p_nivel; v.estado = 'estacionado'; v.estacionado_en = new Date().toISOString();
      return { ok: true, visita: json(v) };
    },
    runner_visita: function (p) { staff(p); var v = ST.visitas[p.p_visita]; return v ? { ok: true, visita: json(v) } : { ok: false, error: 'NO_EXISTE' }; },
    runner_tomar: function (p) { var s = staff(p), v = ST.visitas[p.p_visita]; if (v.estado !== 'solicitado') return { ok: false, error: 'YA_TOMADO' }; v.estado = 'en_camino'; v.en_camino_en = new Date().toISOString(); v.runner_entrega = s.id; return { ok: true, visita: json(v) }; },
    runner_en_puerta: function (p) { var s = staff(p), v = ST.visitas[p.p_visita]; if (['solicitado', 'en_camino'].indexOf(v.estado) < 0) return { ok: false, error: 'ESTADO' }; v.estado = 'en_puerta'; v.en_puerta_en = new Date().toISOString(); v.runner_entrega = v.runner_entrega || s.id; return { ok: true, visita: json(v) }; },
    runner_cobrar_efectivo: function (p) { staff(p); var v = ST.visitas[p.p_visita]; if (v.pago_metodo !== 'efectivo') return { ok: false, error: 'NO_ES_EFECTIVO' }; v.pago_estado = 'pagado'; return { ok: true, visita: json(v) }; },
    ops_cambiar_metodo: function (p) { staff(p); var v = ST.visitas[p.p_visita]; if (v.pago_estado === 'pagado') return { ok: false, error: 'NO_APLICA' }; v.pago_metodo = p.p_metodo; v.pago_estado = p.p_metodo === 'efectivo' ? 'pendiente' : 'por_confirmar'; return { ok: true, visita: json(v) }; },
    runner_entregar: function (p) {
      var s = staff(p), v = ST.visitas[p.p_visita];
      if (!v) return { ok: false, error: 'NO_EXISTE' };
      if (v.estado === 'entregado') return { ok: false, error: 'YA_ENTREGADO' };
      if (v.pago_estado !== 'pagado') return { ok: false, error: 'PAGO_PENDIENTE' };
      if (!v.tarjeta_perdida) { var t = ST.tarjetas[v.tarjeta]; if (!p.p_codigo_tarjeta || (p.p_codigo_tarjeta !== t.codigo && p.p_codigo_tarjeta !== t.token)) return { ok: false, error: 'TARJETA_NO_COINCIDE' }; }
      v.estado = 'entregado'; v.entregado_en = new Date().toISOString(); v.runner_entrega = v.runner_entrega || s.id;
      if (v.minutos == null) v.minutos = Math.ceil((new Date(v.solicitado_en || Date.now()) - new Date(v.recibido_en)) / 60000);
      ST.tarjetas[v.tarjeta].estado = v.tarjeta_perdida ? 'perdida' : 'disponible'; ST.tarjetas[v.tarjeta].visita_actual = null;
      return { ok: true, visita: json(v) };
    },
    // ---- cliente ----
    cliente_estado: function (p) { var t = porToken(p.p_token); if (!t) return { ok: false, error: 'TARJETA_INVALIDA' }; var v = t.visita_actual ? ST.visitas[t.visita_actual] : null; return { ok: true, tarjeta: t.codigo, tipo_tarjeta: 'publica', visita: v ? json(v) : null, sitio: { nombre: 'Loom · San Francisco (DEMO)' }, tarifario: tarifario() }; },
    cliente_pedir: function (p) { var t = porToken(p.p_token), v = t && t.visita_actual ? ST.visitas[t.visita_actual] : null; if (!v) return { ok: false, error: 'SIN_VISITA' }; return pedir(v, p.p_cuando, p.p_propina, p.p_metodo); },
    cliente_calificar: function (p) { var t = porToken(p.p_token); var u = ultima(t); if (u) u.calificacion = p.p_estrellas; return { ok: true }; },
    cliente_ultima: function (p) { var t = porToken(p.p_token); var u = ultima(t); return u ? { ok: true, visita: json(u) } : { ok: false }; },
    tarifario: function () { return tarifario(); }
  };
  function ultima(t) { if (!t) return null; var vs = Object.keys(ST.visitas).map(function (k) { return ST.visitas[k]; }).filter(function (v) { return v.tarjeta === t.codigo && v.estado === 'entregado'; }); return vs.length ? vs[vs.length - 1] : null; }
  function pedir(v, cuando, propina, metodo) {
    if (['recibido', 'estacionado'].indexOf(v.estado) < 0) return { ok: false, error: 'YA_SOLICITADO' };
    v.solicitado_en = new Date().toISOString(); var precio = cotizar(v.recibido_en, v.solicitado_en).precio, parte = Math.max(0, precio - v.cubierto), prop = Math.max(0, Number(propina) || 0);
    if (parte + prop + v.extra > 0 && ['efectivo', 'yappy', 'tarjeta'].indexOf(metodo) < 0) return { ok: false, error: 'METODO' };
    v.estado = 'solicitado'; v.cuando = cuando || 'ahora'; v.propina = prop; v.tarifa = parte; v.minutos = Math.ceil((new Date(v.solicitado_en) - new Date(v.recibido_en)) / 60000);
    if (parte + prop + v.extra === 0) { v.pago_metodo = v.comercio_id ? 'aliado' : 'mensual'; v.pago_estado = 'pagado'; } else { v.pago_metodo = metodo; v.pago_estado = metodo === 'efectivo' ? 'pendiente' : 'por_confirmar'; }
    return { ok: true, visita: json(v) };
  }

  // ---- fetch simulado ----
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    url = String(url);
    if (url.indexOf('https://demo.invalid') !== 0) return realFetch(url, opts);
    var delay = 150 + Math.random() * 250;
    return new Promise(function (res) {
      setTimeout(function () {
        var m = url.match(/\/rest\/v1\/rpc\/(\w+)/);
        if (m) {
          var params = {}; try { params = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
          try {
            if (!RPC[m[1]]) throw new Error('RPC_NO_DISPONIBLE_EN_DEMO: ' + m[1]);
            var out = RPC[m[1]](params);
            res(new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          } catch (e) { res(new Response(JSON.stringify({ message: e.message }), { status: 400, headers: { 'Content-Type': 'application/json' } })); }
          return;
        }
        var s = url.match(/\/storage\/v1\/object\/fotos\/(.+)$/);
        if (s && opts && opts.method === 'POST') { ST.fotos[s[1]] = URL.createObjectURL(opts.body); res(new Response(JSON.stringify({ Key: 'fotos/' + s[1] }), { status: 200 })); return; }
        res(new Response('{}', { status: 404 }));
      }, delay);
    });
  };
  // las fotos "subidas" se muestran desde memoria
  new MutationObserver(function () {
    document.querySelectorAll('img[src^="https://demo.invalid/storage/v1/object/public/fotos/"],a[href^="https://demo.invalid/storage/v1/object/public/fotos/"]').forEach(function (el) {
      var key = (el.src || el.href).split('/public/fotos/')[1]; var u = ST.fotos[decodeURIComponent(key)]; if (u) { if (el.tagName === 'IMG') el.src = u; else el.href = u; }
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ---- barra de demo: simula al cliente y al capitán ----
  function ultimaEnCustodia() { var vs = activas().filter(function (v) { return v.estado === 'estacionado' || v.estado === 'recibido'; }); return vs.length ? vs[vs.length - 1] : null; }
  function toast(m) { if (window.PE_toast) window.PE_toast(m); }
  window.PE_DEMO = {
    pedir: function (metodo) { var v = ultimaEnCustodia(); if (!v) { toast('No hay carros estacionados: recibe uno primero'); return; } var r = pedir(v, 'ahora', metodo === 'efectivo' ? 0 : 2, metodo); toast(r.ok ? 'Cliente ' + v.tarjeta + ' pidió su carro · ' + metodo : 'No se pudo'); },
    confirmar: function () { var n = 0; Object.keys(ST.visitas).forEach(function (k) { var v = ST.visitas[k]; if (v.pago_estado === 'por_confirmar') { v.pago_estado = 'pagado'; n++; } }); toast(n ? 'Capitán confirmó ' + n + ' pago(s)' : 'No hay pagos por confirmar'); },
    cliente: function () { var v = ultimaEnCustodia() || activas()[0]; if (!v) { toast('No hay carros en custodia'); return; } window.open(location.pathname + '#/t/' + ST.tarjetas[v.tarjeta].token, '_blank'); },
    reset: function () { location.reload(); }
  };
  seed();
  if (!location.hash || location.hash === '#/') location.hash = '#/valet';
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.id = 'demobar';
    bar.innerHTML = '<span>DEMO · PIN 1111</span><button onclick="PE_DEMO.pedir(\'yappy\')">Cliente pide · Yappy</button><button onclick="PE_DEMO.pedir(\'efectivo\')">Cliente pide · efectivo</button><button onclick="PE_DEMO.confirmar()">Capitán confirma pago</button><button onclick="PE_DEMO.cliente()">Ver como cliente</button><button onclick="PE_DEMO.reset()">Reiniciar</button>';
    document.body.appendChild(bar);
  });
})();
