/* ParkEasy · tablero en vivo (capitán) y administración (dueño) */
(function () {
  'use strict';
  var PE = window.PE, esc = PE.esc, money = PE.money, hora = PE.hora, fecha = PE.fecha, mmss = PE.mmss, secsSince = PE.secsSince, ubic = PE.ubic, carro = PE.carro, MN = PE.metodoNombre, EN = PE.estadoNombre, pad2 = PE.pad2, I = PE.I;
  var app = document.getElementById('app');
  var D = { mode: null, sess: null, data: null, timer: null, tick: null, nav: 'hoy', adm: {}, busy: false };

  function hoyPA() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' }); } // YYYY-MM-DD
  function diaOperativoPA() { var d = new Date(Date.now() - 6 * 3600 * 1000); return d.toLocaleDateString('en-CA', { timeZone: 'America/Panama' }); }

  window.PE_desk = function (mode, pinScreen) {
    D.mode = mode; D.sess = PE.Sess.get(); D.data = null;
    document.body.className = 'desk-mode';
    window.PE_onLogin = function (r) {
      if (mode === 'admin' && r.rol !== 'admin') { PE_toast('Este PIN no tiene acceso a Administración', true); return; }
      if (mode === 'tablero' && r.rol === 'runner') { PE_toast('El tablero es para capitanes', true); return; }
      D.sess = { token: r.token, nombre: r.nombre, rol: r.rol, id: r.id }; PE.Sess.set(D.sess); start();
    };
    if (!D.sess) { pinScreen(mode === 'admin' ? 'Administración' : 'Tablero del capitán'); return; }
    if ((mode === 'admin' && D.sess.rol !== 'admin') || (mode === 'tablero' && D.sess.rol === 'runner')) {
      app.innerHTML = '<div class="phone"><div class="screen" style="justify-content:center"><h1 class="sm">Sin acceso</h1><p>Tu PIN (' + esc(D.sess.nombre) + ') no tiene permiso para esta vista.</p><button class="btn2" data-a="d:logout">Cambiar de usuario</button><a class="btn2" href="#/valet" style="text-decoration:none">Ir a la app del valet</a></div></div>';
      return;
    }
    start();
  };
  window.PE_deskStop = function () { clearInterval(D.timer); clearInterval(D.tick); window.PE_onLogin = null; document.body.className = ''; };
  function start() {
    clearInterval(D.timer); clearInterval(D.tick);
    if (D.mode === 'tablero') { loadT(); D.timer = setInterval(loadT, 4000); D.tick = setInterval(function () { if (D.data && !document.querySelector('.overlay')) renderT(); }, 1000); }
    else { D.nav = 'hoy'; D.adm = { desde: diaOperativoPA(), hasta: diaOperativoPA(), dia: diaOperativoPA() }; renderA(); loadA(); }
  }
  function hdr(title, extra) {
    return '<div class="desk-hdr noprint"><div class="brand"><img class="logo" alt="" src="logo.png"><div><div class="brand-name">ParkEasy · ' + esc(title) + '</div><div class="brand-sub" id="reloj">' + esc(window.PE_CONFIG.SITIO_SUB) + '</div></div></div>' + (extra || '') + '<div class="row"><span class="tag">' + esc(D.sess.nombre) + '</span><button class="btn2 sm" data-a="d:logout">Salir</button></div></div>';
  }

  /* =============================== TABLERO =============================== */
  function loadT() { PE.rpc('ops_estado', { p_sess: D.sess.token }).then(function (d) { D.data = d; if (!document.querySelector('.overlay')) renderT(); }).catch(function () {}); }
  function renderT() {
    var d = D.data, h = hdr('Tablero en vivo', '<div class="tag dark">' + new Date().toLocaleTimeString('es-PA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Panama' }) + '</div>');
    if (!d) { app.innerHTML = '<div class="desk">' + h + '<div class="empty">Cargando…</div></div>'; return; }
    var cola = d.cola || [], sinU = d.sin_ubicacion || [], porC = d.por_confirmar || [], cust = d.custodia_lista || [], cupos = d.cupos || {};
    var lateCola = cola.filter(function (v) { return v.estado === 'solicitado' && secsSince(v.solicitado_en) > 240; }).length;
    var lateU = sinU.filter(function (v) { return secsSince(v.recibido_en) > 300; }).length;
    var b = '<div class="desk-body">';
    b += '<div class="col-12 kpis" style="grid-template-columns:repeat(6,minmax(0,1fr))">'
      + '<div class="kpi dark"><div class="n">' + d.custodia + '</div><div class="l">En custodia</div></div>'
      + '<div class="kpi' + (cola.length ? ' blue' : '') + '"><div class="n">' + cola.length + '</div><div class="l">Por entregar</div></div>'
      + '<div class="kpi"><div class="n" style="' + (lateCola ? 'color:var(--bad)' : '') + '">' + lateCola + '</div><div class="l">Esperando +4 min</div></div>'
      + '<div class="kpi"><div class="n" style="' + (lateU ? 'color:var(--bad)' : '') + '">' + sinU.length + '</div><div class="l">Sin ubicación</div></div>'
      + '<div class="kpi"><div class="n" style="' + (porC.length ? 'color:var(--warn)' : '') + '">' + porC.length + '</div><div class="l">Pagos por confirmar</div></div>'
      + '<div class="kpi"><div class="n" style="font-size:15px;line-height:1.5">' + ['A', 'B', 'C'].map(function (k) { return k + ' ' + (cupos[k] ? cupos[k].libres + '/' + cupos[k].total : '–'); }).join(' · ') + '</div><div class="l">Cupos libres</div></div></div>';
    // cola
    b += '<div class="panel col-6"><h2>Entregas pendientes <span class="tag">' + cola.length + '</span></h2>';
    if (!cola.length) b += '<div class="empty">Nadie ha pedido su carro.</div>';
    cola.forEach(function (v) {
      var s = secsSince(v.solicitado_en), late = v.estado === 'solicitado' && s > 240;
      var pago = v.pago_estado === 'pagado' ? '<span class="tag ok">Pagado · ' + (MN[v.pago_metodo] || '') + '</span>' : (v.pago_metodo === 'efectivo' ? '<span class="tag warn">Efectivo ' + money(v.total) + '</span>' : '<span class="tag bad">' + (MN[v.pago_metodo] || 'Pago') + ' por confirmar · ' + money(v.total) + '</span>');
      b += '<div class="req' + (late ? ' alert' : '') + '"><div class="info"><div class="row-between"><span class="code">' + esc(v.tarjeta) + ' · ' + esc(ubic(v)) + '</span><span class="timer' + (late ? ' late' : '') + '">' + mmss(s) + '</span></div><div class="sub">' + esc(carro(v)) + (v.placa ? ' · ' + esc(v.placa) : '') + (v.runner_entrega ? ' · ' + esc(v.runner_entrega) : '') + '</div><div class="tags"><span class="tag ' + (v.estado === 'en_puerta' ? 'dark' : (v.estado === 'en_camino' ? 'blue' : '')) + '">' + esc(EN[v.estado]) + (v.cuando && v.cuando !== 'ahora' ? ' · en ' + v.cuando + ' min' : '') + '</span>' + pago + '</div></div><button class="take ghost" data-a="d:menu" data-v="' + v.id + '">⋯</button></div>';
    });
    b += '</div>';
    // pagos por confirmar
    b += '<div class="panel col-6"><h2>Pagos por confirmar <span class="tag">' + porC.length + '</span></h2>';
    if (!porC.length) b += '<div class="empty">Sin pagos Yappy / tarjeta pendientes.</div>';
    porC.forEach(function (v) {
      b += '<div class="req"><div class="info"><div class="code">' + esc(v.tarjeta) + ' · ' + esc(MN[v.pago_metodo] || '') + ' · ' + money(v.total) + '</div><div class="sub">' + esc(carro(v)) + (v.placa ? ' · ' + esc(v.placa) : '') + ' · pedido ' + esc(hora(v.solicitado_en)) + (v.propina > 0 ? ' · propina ' + money(v.propina) : '') + '</div></div><button class="take" data-a="d:confirmar" data-v="' + v.id + '">Confirmar</button><button class="take ghost" data-a="d:aefectivo" data-v="' + v.id + '">Efectivo</button></div>';
    });
    b += '<p style="font-size:12px">Confirma solo cuando veas el Yappy recibido o el voucher del datáfono. Esta semana se automatiza.</p></div>';
    // sin ubicación
    b += '<div class="panel col-4"><h2>Sin ubicación <span class="tag' + (lateU ? ' bad' : '') + '">' + sinU.length + '</span></h2>';
    if (!sinU.length) b += '<div class="empty">Todo ubicado.</div>';
    sinU.forEach(function (v) { var s = secsSince(v.recibido_en); b += '<div class="req' + (s > 300 ? ' alert' : '') + '"><div class="info"><div class="row-between"><span class="code">Tarjeta ' + esc(v.tarjeta) + '</span><span class="timer' + (s > 300 ? ' late' : '') + '">' + mmss(s) + '</span></div><div class="sub">' + esc(v.modelo ? carro(v) : 'Sin datos') + (v.runner_recibe ? ' · ' + esc(v.runner_recibe) : '') + '</div></div><button class="take ghost" data-a="d:menu" data-v="' + v.id + '">⋯</button></div>'; });
    b += '</div>';
    // runners
    b += '<div class="panel col-4"><h2>Personal activo</h2>';
    (d.runners || []).forEach(function (r) { var s = secsSince(r.ultimo_uso); b += '<div class="li"><span class="tag ' + (s < 300 ? 'ok' : '') + '">' + esc(r.rol) + '</span>' + esc(r.nombre) + '<span style="margin-left:auto;color:var(--muted);font-weight:600;font-size:12px">' + (s < 60 ? 'ahora' : 'hace ' + Math.floor(s / 60) + ' min') + '</span></div>'; });
    if (!(d.runners || []).length) b += '<div class="empty">Nadie conectado.</div>';
    b += '</div>';
    // mapa
    b += '<div class="panel col-4"><h2>Mapa de plazas</h2><div class="mapa">';
    (d.mapa || []).forEach(function (t) {
      b += '<div class="torre"><span class="pn">' + pad2(t.plaza) + '</span>' + ['C', 'B', 'A'].map(function (n) { var x = t[n]; var cls = !x ? '' : (x.estado === 'estacionado' ? 'on' : 'req'); return '<div class="lv ' + cls + '" title="' + esc(x ? (x.placa || '') + ' ' + (x.modelo || '') : 'libre') + '">' + (x ? esc(x.placa || n) : n) + '</div>'; }).join('') + '</div>';
    });
    b += '</div><div class="tags" style="margin-top:6px"><span class="tag dark">En custodia</span><span class="tag blue">Pedido</span><span class="tag">Libre</span></div></div>';
    // custodia
    b += '<div class="panel col-12"><h2>En custodia <span class="tag">' + cust.length + '</span></h2><div class="tablewrap"><table><thead><tr><th>Tarjeta</th><th>Ubicación</th><th>Vehículo</th><th>Placa</th><th>Recibido</th><th>Estado</th><th>Pago</th><th></th></tr></thead><tbody>';
    if (!cust.length) b += '<tr><td colspan="8" class="empty">No hay carros en el lote.</td></tr>';
    cust.forEach(function (v) { b += '<tr><td><b>' + esc(v.tarjeta) + '</b>' + (v.tipo === 'mensual' ? ' <span class="tag ok">Mensual</span>' : '') + '</td><td><b>' + esc(ubic(v)) + '</b></td><td>' + esc(carro(v)) + '</td><td>' + esc(v.placa || '') + '</td><td>' + esc(hora(v.recibido_en)) + (v.runner_recibe ? ' · ' + esc(v.runner_recibe) : '') + '</td><td>' + esc(EN[v.estado]) + '</td><td>' + (v.pago_estado === 'pagado' ? '<span class="tag ok">Pagado</span>' : (v.pago_estado === 'por_confirmar' ? '<span class="tag bad">Por confirmar</span>' : '<span class="tag">Pendiente</span>')) + '</td><td><button class="btn2 sm" data-a="d:menu" data-v="' + v.id + '">Acciones</button></td></tr>'; });
    b += '</tbody></table></div></div>';
    b += '</div>';
    app.innerHTML = '<div class="desk">' + h + b + '</div>';
  }
  function findV(id) { var d = D.data || {}; var all = [].concat(d.cola || [], d.sin_ubicacion || [], d.custodia_lista || [], d.por_confirmar || []); return all.filter(function (v) { return v.id === id; })[0]; }
  function menu(v) {
    var pedible = v.estado === 'recibido' || v.estado === 'estacionado';
    var h = '<div class="overlay" data-a="d:cerrar"><div class="sheet" onclick="event.stopPropagation()"><div class="handle"></div><div class="row-between"><h2>Tarjeta ' + esc(v.tarjeta) + ' · ' + esc(ubic(v)) + '</h2><span class="tag">' + esc(EN[v.estado]) + '</span></div><p>' + esc(carro(v)) + (v.placa ? ' · ' + esc(v.placa) : '') + ' · recibido ' + esc(hora(v.recibido_en)) + '</p>'
      + '<div class="kv"><span class="k">Cobro</span><b>' + (v.tipo === 'mensual' ? 'Mensual' : money(v.total)) + ' · ' + (v.pago_estado === 'pagado' ? 'pagado' : v.pago_estado.replace('_', ' ')) + (v.pago_metodo ? ' · ' + MN[v.pago_metodo] : '') + '</b></div>'
      + ((v.fotos || []).length ? '<div class="thumbs">' + v.fotos.map(function (u) { return '<a class="thumb" href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '"></a>'; }).join('') + '</div>' : '')
      + '<div class="list">';
    if (pedible) h += '<button class="btn2 md" data-a="d:pedir" data-v="' + v.id + '">Pedir el carro desde el stand</button>';
    if (v.pago_estado === 'por_confirmar') h += '<button class="btn md" data-a="d:confirmar" data-v="' + v.id + '">Confirmar pago ' + esc(MN[v.pago_metodo] || '') + ' · ' + money(v.total) + '</button>';
    if (v.pago_estado !== 'pagado' && v.pago_metodo !== 'efectivo' && v.estado !== 'recibido' && v.estado !== 'estacionado') h += '<button class="btn2 md" data-a="d:aefectivo" data-v="' + v.id + '">Cambiar a efectivo</button>';
    if (!v.tarjeta_perdida) h += '<button class="btn2 md" data-a="d:perdida" data-v="' + v.id + '">Cliente perdió la tarjeta (+' + money((D.tarifas && D.tarifas.tarjeta_perdida) || 20) + ')</button>';
    h += '<button class="btn2 md bad" data-a="d:cancelar" data-v="' + v.id + '">Cancelar visita</button><button class="btn2 md" data-a="d:cerrar">Cerrar</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', h);
  }
  function closeMenu() { var o = document.querySelector('.overlay'); if (o) o.remove(); }

  /* =============================== ADMIN =============================== */
  var NAV = [['hoy', 'Resumen'], ['visitas', 'Visitas'], ['corte', 'Corte de caja'], ['personal', 'Personal'], ['tarifas', 'Tarifas'], ['mensuales', 'Mensuales'], ['tarjetas', 'Tarjetas'], ['modelos', 'Modelos']];
  function loadA() {
    var a = D.adm, t = D.sess.token, n = D.nav, p;
    a.loading = true; renderA();
    if (n === 'hoy') p = PE.rpc('admin_resumen', { p_sess: t, p_desde: a.desde, p_hasta: a.hasta }).then(function (r) { a.resumen = r.resumen; });
    else if (n === 'visitas') p = PE.rpc('admin_visitas', { p_sess: t, p_desde: a.desde, p_hasta: a.hasta }).then(function (r) { a.visitas = r.visitas; });
    else if (n === 'corte') p = PE.rpc('admin_corte', { p_sess: t, p_dia: a.dia }).then(function (r) { a.corte = r; });
    else if (n === 'personal') p = PE.rpc('admin_staff_list', { p_sess: t }).then(function (r) { a.staff = r.staff; });
    else if (n === 'tarifas') p = PE.rpc('admin_config_get', { p_sess: t }).then(function (r) { a.config = r.config; });
    else if (n === 'mensuales') p = PE.rpc('admin_mensuales_list', { p_sess: t }).then(function (r) { a.mensuales = r.mensuales; });
    else if (n === 'tarjetas') p = PE.rpc('admin_tarjetas_list', { p_sess: t }).then(function (r) { a.tarjetas = r.tarjetas; });
    else if (n === 'modelos') p = PE.rpc('admin_modelos_list', { p_sess: t }).then(function (r) { a.modelos = r.modelos; });
    (p || Promise.resolve()).then(function () { a.loading = false; renderA(); }).catch(function (e) { a.loading = false; PE_toast('Error: ' + e.message, true); renderA(); });
  }
  function rango() { var a = D.adm; return '<div class="row"><input type="date" class="input md" id="desde" value="' + a.desde + '" style="width:auto"><span>a</span><input type="date" class="input md" id="hasta" value="' + a.hasta + '" style="width:auto"><button class="btn sm" data-a="a:rango">Ver</button><button class="btn2 sm" data-a="a:hoy">Hoy</button></div>'; }
  function renderA() {
    var a = D.adm, h = hdr('Administración', '<div class="desk-nav">' + NAV.map(function (n) { return '<button class="' + (D.nav === n[0] ? 'on' : '') + '" data-a="a:nav" data-v="' + n[0] + '">' + n[1] + '</button>'; }).join('') + '</div>');
    var b = '<div class="desk-body">';
    if (a.loading && !a[D.nav === 'hoy' ? 'resumen' : D.nav]) b += '<div class="col-12 empty"><div class="spin" style="margin:0 auto 10px"></div>Cargando…</div>';
    else if (D.nav === 'hoy') b += renderResumen();
    else if (D.nav === 'visitas') b += renderVisitas();
    else if (D.nav === 'corte') b += renderCorte();
    else if (D.nav === 'personal') b += renderPersonal();
    else if (D.nav === 'tarifas') b += renderTarifas();
    else if (D.nav === 'mensuales') b += renderMensuales();
    else if (D.nav === 'tarjetas') b += renderTarjetas();
    else if (D.nav === 'modelos') b += renderModelos();
    b += '</div>';
    app.innerHTML = '<div class="desk">' + h + b + '</div>';
  }
  function renderResumen() {
    var r = D.adm.resumen; if (!r) return '';
    var pm = r.por_metodo || {};
    var b = '<div class="panel col-12"><h2>Resumen</h2>' + rango() + '</div>';
    b += '<div class="col-12 kpis" style="grid-template-columns:repeat(6,minmax(0,1fr))">'
      + '<div class="kpi dark"><div class="n">' + money(r.total_cobrado) + '</div><div class="l">Total cobrado</div></div>'
      + '<div class="kpi"><div class="n">' + money(r.ingreso_servicio) + '</div><div class="l">Servicio (sin propina)</div></div>'
      + '<div class="kpi"><div class="n">' + money(r.propinas) + '</div><div class="l">Propinas · pool</div></div>'
      + '<div class="kpi"><div class="n">' + r.carros + '</div><div class="l">Carros (' + r.abiertos + ' abiertos · ' + r.mensuales + ' mensuales)</div></div>'
      + '<div class="kpi"><div class="n">' + (r.tiempo_entrega_prom_seg ? mmss(Math.round(r.tiempo_entrega_prom_seg)) : '–') + '</div><div class="l">Entrega promedio</div></div>'
      + '<div class="kpi"><div class="n">' + (r.calificacion_prom ? Number(r.calificacion_prom).toFixed(1) + ' ★' : '–') + '</div><div class="l">Calificación</div></div></div>';
    b += '<div class="panel col-4"><h2>Por método</h2><table><tbody>' + Object.keys(pm).map(function (k) { return '<tr><td>' + esc(MN[k] || k) + '</td><td class="r"><b>' + money(pm[k]) + '</b></td></tr>'; }).join('') + '<tr><td>Pendiente de cobro</td><td class="r" style="color:var(--bad)">' + money(r.pendiente_cobro) + '</td></tr></tbody></table></div>';
    b += '<div class="panel col-8"><h2>Por día</h2><div class="tablewrap"><table><thead><tr><th>Día</th><th class="r">Carros</th><th class="r">Cobrado</th></tr></thead><tbody>' + (r.por_dia || []).map(function (d) { return '<tr><td>' + esc(d.dia) + '</td><td class="r">' + d.carros + '</td><td class="r"><b>' + money(d.cobrado) + '</b></td></tr>'; }).join('') + '</tbody></table></div></div>';
    return b;
  }
  function renderVisitas() {
    var vs = D.adm.visitas || [];
    var b = '<div class="panel col-12"><h2>Visitas <span class="tag">' + vs.length + '</span></h2>' + rango() + '<div class="tablewrap"><table><thead><tr><th>Día</th><th>Tarjeta</th><th>Vehículo</th><th>Placa</th><th>Ubic.</th><th>Recibido</th><th>Pedido</th><th>Entregado</th><th>Estado</th><th>Pago</th><th class="r">Servicio</th><th class="r">Propina</th><th class="r">Total</th><th>Runner</th><th></th></tr></thead><tbody>';
    vs.forEach(function (v) { b += '<tr><td>' + esc(v.dia_operativo) + '</td><td><b>' + esc(v.tarjeta) + '</b></td><td>' + esc(carro(v)) + '</td><td>' + esc(v.placa || '') + '</td><td>' + esc(ubic(v)) + '</td><td>' + esc(hora(v.recibido_en)) + '</td><td>' + esc(hora(v.solicitado_en)) + '</td><td>' + esc(hora(v.entregado_en)) + '</td><td>' + esc(EN[v.estado]) + '</td><td>' + (v.tipo === 'mensual' ? 'Mensual' : esc(MN[v.pago_metodo] || '–') + ' · ' + esc(v.pago_estado.replace('_', ' '))) + (v.pago_referencia ? ' (' + esc(v.pago_referencia) + ')' : '') + '</td><td class="r">' + money(Number(v.tarifa) + Number(v.overnight) + Number(v.extra)) + '</td><td class="r">' + money(v.propina) + '</td><td class="r"><b>' + money(v.total) + '</b></td><td>' + esc(v.runner_recibe || '') + (v.runner_entrega && v.runner_entrega !== v.runner_recibe ? ' / ' + esc(v.runner_entrega) : '') + '</td><td><button class="btn2 sm" data-a="a:eventos" data-v="' + v.id + '">Detalle</button></td></tr>'; });
    if (!vs.length) b += '<tr><td colspan="15" class="empty">Sin visitas en el rango.</td></tr>';
    return b + '</tbody></table></div></div>';
  }
  function renderCorte() {
    var c = D.adm.corte || {}, a = D.adm;
    var b = '<div class="panel col-12"><h2>Corte de caja</h2><div class="row"><input type="date" class="input md" id="dia" value="' + a.dia + '" style="width:auto"><button class="btn sm" data-a="a:dia">Ver</button><button class="btn2 sm" data-a="a:print">Imprimir</button></div><p style="font-size:12px">El día operativo va de 6:00 a.m. a 6:00 a.m. del día siguiente.</p></div>';
    b += '<div class="panel col-6"><h2>Efectivo por persona</h2><table><thead><tr><th>Persona</th><th class="r">Carros</th><th class="r">Debe entregar</th></tr></thead><tbody>' + (c.efectivo_por_persona || []).map(function (x) { return '<tr><td>' + esc(x.nombre) + '</td><td class="r">' + x.carros + '</td><td class="r"><b>' + money(x.monto) + '</b></td></tr>'; }).join('') + '<tr><td><b>Total efectivo</b></td><td></td><td class="r"><b>' + money((c.efectivo_por_persona || []).reduce(function (s, x) { return s + Number(x.monto); }, 0)) + '</b></td></tr></tbody></table></div>';
    b += '<div class="panel col-6"><h2>Digital (Yappy / tarjeta)</h2>' + (c.digital || []).map(function (m) { return '<div class="kv"><span class="k">' + esc(MN[m.metodo]) + ' · ' + m.carros + ' carros</span><b>' + money(m.monto) + '</b></div><div class="tablewrap"><table><tbody>' + (m.referencias || []).map(function (r) { return '<tr><td>' + esc(hora(r.hora)) + '</td><td>' + esc(r.tarjeta) + '</td><td>' + esc(r.placa || '') + '</td><td>' + esc(r.ref || '') + '</td><td class="r">' + money(r.total) + '</td></tr>'; }).join('') + '</tbody></table></div>'; }).join('') + (!(c.digital || []).length ? '<div class="empty">Sin pagos digitales.</div>' : '') + '</div>';
    b += '<div class="panel col-6"><h2>Propinas · pool del día</h2><div class="kpi dark"><div class="n">' + money(c.propinas_pool) + '</div><div class="l">A repartir entre el turno</div></div></div>';
    b += '<div class="panel col-6"><h2>Turnos</h2><table><thead><tr><th>Persona</th><th>Rol</th><th class="r">Recibió</th><th class="r">Entregó</th></tr></thead><tbody>' + (c.turnos || []).map(function (t) { return '<tr><td>' + esc(t.nombre) + '</td><td>' + esc(t.rol) + '</td><td class="r">' + t.recibidos + '</td><td class="r">' + t.entregados + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return b;
  }
  function renderPersonal() {
    var st = D.adm.staff || [];
    var b = '<div class="panel col-8"><h2>Personal</h2><div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>' + st.map(function (s) { return '<tr><td><b>' + esc(s.nombre) + '</b></td><td>' + esc(s.rol) + '</td><td>' + (s.activo ? '<span class="tag ok">Activo</span>' : '<span class="tag">Inactivo</span>') + '</td><td class="row"><button class="btn2 sm" data-a="a:pin" data-v="' + s.id + '">Cambiar PIN</button><button class="btn2 sm" data-a="a:toggle" data-v="' + s.id + '" data-on="' + (s.activo ? 1 : 0) + '">' + (s.activo ? 'Desactivar' : 'Activar') + '</button></td></tr>'; }).join('') + '</tbody></table></div></div>';
    b += '<div class="panel col-4"><h2>Nuevo</h2><div class="field"><label>Nombre</label><input class="input md" id="s_nombre"></div><div class="field"><label>Rol</label><select class="sel sm" id="s_rol"><option value="runner">Runner</option><option value="capitan">Capitán</option><option value="admin">Admin</option></select></div><div class="field"><label>PIN (4–6 dígitos)</label><input class="input md" id="s_pin" inputmode="numeric" maxlength="6"></div><button class="btn md" data-a="a:nuevoStaff">Crear</button><p style="font-size:12px">Cada persona entra con su PIN en la app del valet. El PIN no se puede repetir.</p></div>';
    return b;
  }
  function renderTarifas() {
    var c = D.adm.config || {}, t = c.tarifas || {}, s = c.sitio || {}, n = c.niveles || {};
    var f = function (id, label, val, type) { return '<div class="field"><label>' + label + '</label><input class="input md" id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (type ? ' type="' + type + '" step="0.01"' : '') + '></div>'; };
    var b = '<div class="panel col-6"><h2>Tarifas (ITBMS incluido)</h2><div class="formrow">' + f('t_dia', 'Por carro · día ($)', t.dia, 'number') + f('t_noche', 'Por carro · noche ($)', t.noche, 'number') + f('t_hora_noche', 'Noche desde (hora, 0–23)', t.hora_noche, 'number') + f('t_overnight', 'Overnight ($)', t.overnight, 'number') + f('t_mensual', 'Mensual ($)', t.mensual, 'number') + f('t_perdida', 'Tarjeta perdida ($)', t.tarjeta_perdida, 'number') + '</div><button class="btn md" data-a="a:saveTarifas">Guardar tarifas</button></div>';
    b += '<div class="panel col-6"><h2>Sitio</h2><div class="formrow">' + f('s_nombre', 'Nombre', s.nombre) + f('s_direccion', 'Dirección', s.direccion) + f('s_abre', 'Abre', s.abre) + f('s_cierra', 'Cierra', s.cierra) + f('s_yappy', 'Yappy (directorio / @)', s.yappy) + '</div><button class="btn md" data-a="a:saveSitio">Guardar sitio</button></div>';
    b += '<div class="panel col-6"><h2>Niveles del triplicador (lb)</h2><div class="formrow">' + f('n_C', 'C · máximo (sedán)', n.C && n.C.max_lb, 'number') + f('n_B', 'B · máximo (SUV mediano)', n.B && n.B.max_lb, 'number') + f('n_A', 'A · máximo (SUV grande)', n.A && n.A.max_lb, 'number') + f('n_margen', 'Margen de seguridad', n.margen_lb, 'number') + '</div><button class="btn md" data-a="a:saveNiveles">Guardar niveles</button></div>';
    return b;
  }
  function renderMensuales() {
    var ms = D.adm.mensuales || [];
    var b = '<div class="panel col-8"><h2>Clientes mensuales <span class="tag">' + ms.filter(function (m) { return m.activo; }).length + ' activos</span></h2><div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Placa</th><th>Modelo</th><th>Teléfono</th><th>Estado</th><th></th></tr></thead><tbody>' + ms.map(function (m) { return '<tr><td><b>' + esc(m.nombre) + '</b></td><td><span class="plate">' + esc(m.placa) + '</span></td><td>' + esc(m.modelo || '') + '</td><td>' + esc(m.telefono || '') + '</td><td>' + (m.activo ? '<span class="tag ok">Activo</span>' : '<span class="tag">Inactivo</span>') + '</td><td><button class="btn2 sm" data-a="a:toggleMensual" data-v="' + m.id + '" data-on="' + (m.activo ? 1 : 0) + '">' + (m.activo ? 'Desactivar' : 'Activar') + '</button></td></tr>'; }).join('') + '</tbody></table></div></div>';
    b += '<div class="panel col-4"><h2>Nuevo mensual</h2><div class="field"><label>Nombre</label><input class="input md" id="m_nombre"></div><div class="field"><label>Placa</label><input class="input md" id="m_placa" autocapitalize="characters"></div><div class="field"><label>Modelo</label><input class="input md" id="m_modelo"></div><div class="field"><label>Teléfono</label><input class="input md" id="m_tel"></div><button class="btn md" data-a="a:nuevoMensual">Crear</button><p style="font-size:12px">Al registrar la placa, el sistema marca la visita como mensual sin cargo.</p></div>';
    return b;
  }
  function renderTarjetas() {
    var ts = D.adm.tarjetas || [], cnt = {};
    ts.forEach(function (t) { cnt[t.estado] = (cnt[t.estado] || 0) + 1; });
    var b = '<div class="panel col-12 noprint"><h2>Tarjetas con QR</h2><div class="tags"><span class="tag ok">Disponibles ' + (cnt.disponible || 0) + '</span><span class="tag blue">En uso ' + (cnt.en_uso || 0) + '</span><span class="tag bad">Perdidas ' + (cnt.perdida || 0) + '</span><span class="tag">Baja ' + (cnt.baja || 0) + '</span></div>'
      + '<div class="formrow"><div class="field"><label>Imprimir desde</label><input class="input md" id="p_desde" value="1001" inputmode="numeric"></div><div class="field"><label>hasta</label><input class="input md" id="p_hasta" value="1010" inputmode="numeric"></div><button class="btn md" data-a="a:imprimir">Vista de impresión</button><div class="field"><label>Generar nuevas · desde</label><input class="input md" id="g_desde" inputmode="numeric" placeholder="1151"></div><div class="field"><label>hasta</label><input class="input md" id="g_hasta" inputmode="numeric" placeholder="1200"></div><button class="btn2 md" data-a="a:generar">Generar</button></div>'
      + '<p style="font-size:12px">Cada QR lleva el link de esa tarjeta: ' + esc(baseUrl()) + '#/t/… · Imprime 5 de prueba en papel y escanéalas con varios celulares antes de mandar a hacer las plásticas.</p></div>';
    if (D.adm.print) {
      var lo = D.adm.print[0], hi = D.adm.print[1];
      b += '<div class="panel col-12"><div class="cards-print">' + ts.filter(function (t) { var n = Number(t.codigo); return n >= lo && n <= hi; }).map(function (t) { return '<div class="card-print"><img src="' + qrData(baseUrl() + '#/t/' + t.token) + '" alt="QR"><div><img class="logo" src="logo.png" alt=""><div class="n">' + esc(t.codigo) + '</div><div class="t">ParkEasy · Valet<br>Escanea para pedir tu carro<br>Conserva esta tarjeta</div></div></div>'; }).join('') + '</div><button class="btn md noprint" style="margin-top:12px" data-a="a:print">Imprimir</button></div>';
    }
    b += '<div class="panel col-12 noprint"><div class="tablewrap"><table><thead><tr><th>Código</th><th>Estado</th><th>Link</th><th></th></tr></thead><tbody>' + ts.map(function (t) { return '<tr><td><b>' + esc(t.codigo) + '</b></td><td><span class="tag ' + ({ disponible: 'ok', en_uso: 'blue', perdida: 'bad' }[t.estado] || '') + '">' + esc(t.estado) + '</span></td><td style="font-size:11px;color:var(--muted)"><a href="' + esc(baseUrl() + '#/t/' + t.token) + '" target="_blank" rel="noopener">abrir como cliente</a></td><td class="row">' + (t.estado !== 'disponible' && t.estado !== 'en_uso' ? '<button class="btn2 sm" data-a="a:tarjeta" data-v="' + t.codigo + '" data-e="disponible">Reactivar</button>' : '') + (t.estado === 'disponible' ? '<button class="btn2 sm" data-a="a:tarjeta" data-v="' + t.codigo + '" data-e="baja">Dar de baja</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    return b;
  }
  function renderModelos() {
    var ms = D.adm.modelos || [];
    var b = '<div class="panel col-8"><h2>Catálogo de modelos <span class="tag">' + ms.length + '</span></h2><div class="tablewrap"><table><thead><tr><th>Modelo</th><th class="r">Peso (lb)</th><th>Nivel</th><th>Fuente</th><th class="r">Usos</th></tr></thead><tbody>' + ms.map(function (m) { return '<tr><td>' + esc(m.nombre) + '</td><td class="r">' + m.peso_lb.toLocaleString('en-US') + '</td><td><span class="tag ' + (m.nivel === 'X' ? 'bad' : 'dark') + '">' + m.nivel + '</span></td><td>' + esc(m.fuente) + '</td><td class="r">' + m.usos + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    b += '<div class="panel col-4"><h2>Agregar / corregir</h2><div class="field"><label>Marca y modelo</label><input class="input md" id="mo_nombre"></div><div class="field"><label>Peso en libras</label><input class="input md" id="mo_peso" inputmode="numeric"></div><button class="btn md" data-a="a:nuevoModelo">Guardar</button><p style="font-size:12px">Los modelos con fuente “manual” los agregó un runner por categoría; corrige aquí el peso real.</p></div>';
    return b;
  }
  function baseUrl() { return location.origin + location.pathname; }
  function qrData(text) { try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createDataURL(4, 0); } catch (e) { return ''; } }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function num(id) { var v = Number(val(id)); return isNaN(v) ? null : v; }

  /* =============================== acciones =============================== */
  window.PE_deskAct = function (a, v, el) {
    var t = D.sess && D.sess.token, adm = D.adm;
    var done = function (msg) { return function (r) { if (r && r.ok === false) { PE_toast(r.error || 'No se pudo', true); return; } if (msg) PE_toast(msg); if (D.mode === 'tablero') loadT(); else loadA(); }; };
    var fail = function () { PE_toast('Sin conexión', true); };
    switch (a) {
      case 'd:logout': PE.rpc('staff_logout', { p_sess: t }).catch(function () {}); PE.Sess.clear(); D.sess = null; window.PE_deskStop(); location.reload(); return;
      case 'd:cerrar': closeMenu(); return;
      case 'd:menu': { var vv = findV(v); if (vv) menu(vv); return; }
      case 'd:confirmar': { var ref = prompt('Referencia del pago (opcional):', ''); if (ref === null) return; closeMenu(); PE.rpc('ops_confirmar_pago', { p_sess: t, p_visita: v, p_referencia: ref || null }).then(done('Pago confirmado')).catch(fail); return; }
      case 'd:aefectivo': closeMenu(); PE.rpc('ops_cambiar_metodo', { p_sess: t, p_visita: v, p_metodo: 'efectivo' }).then(done('Cambiado a efectivo')).catch(fail); return;
      case 'd:pedir': { var m = prompt('Método de pago del cliente: efectivo, yappy o tarjeta', 'efectivo'); if (m === null) return; m = m.trim().toLowerCase(); if (['efectivo', 'yappy', 'tarjeta'].indexOf(m) < 0) m = 'efectivo'; closeMenu(); PE.rpc('ops_pedir', { p_sess: t, p_visita: v, p_metodo: m }).then(done('Carro solicitado')).catch(fail); return; }
      case 'd:perdida': if (!confirm('¿Registrar tarjeta perdida? Se agrega el cargo y la tarjeta queda fuera de circulación.')) return; closeMenu(); PE.rpc('ops_tarjeta_perdida', { p_sess: t, p_visita: v }).then(done('Tarjeta perdida registrada')).catch(fail); return;
      case 'd:cancelar': { var mo = prompt('Motivo de la cancelación:', ''); if (mo === null) return; closeMenu(); PE.rpc('ops_cancelar', { p_sess: t, p_visita: v, p_motivo: mo }).then(done('Visita cancelada')).catch(fail); return; }
      // admin
      case 'a:nav': D.nav = v; adm.print = null; loadA(); return;
      case 'a:rango': adm.desde = val('desde') || adm.desde; adm.hasta = val('hasta') || adm.hasta; loadA(); return;
      case 'a:hoy': adm.desde = adm.hasta = diaOperativoPA(); loadA(); return;
      case 'a:dia': adm.dia = val('dia') || adm.dia; loadA(); return;
      case 'a:print': window.print(); return;
      case 'a:eventos': PE.rpc('admin_eventos', { p_sess: t, p_visita: v }).then(function (r) { var vis = (adm.visitas || []).filter(function (x) { return x.id === v; })[0] || {}; document.body.insertAdjacentHTML('beforeend', '<div class="overlay" data-a="d:cerrar"><div class="sheet" onclick="event.stopPropagation()"><div class="handle"></div><h2>Tarjeta ' + esc(vis.tarjeta) + ' · ' + esc(carro(vis)) + '</h2>' + ((vis.fotos || []).length ? '<div class="thumbs">' + vis.fotos.map(function (u) { return '<a class="thumb" href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '"></a>'; }).join('') + '</div>' : '') + '<div class="list">' + (r.eventos || []).map(function (e) { return '<div class="li"><span class="tag">' + esc(hora(e.creado)) + '</span>' + esc(e.tipo.replace(/_/g, ' ')) + (e.quien ? ' · ' + esc(e.quien) : '') + (e.datos ? '<span style="margin-left:auto;font-size:11px;color:var(--muted)">' + esc(JSON.stringify(e.datos)) + '</span>' : '') + '</div>'; }).join('') + '</div><button class="btn2 md" data-a="d:cerrar">Cerrar</button></div></div>'); }); return;
      case 'a:nuevoStaff': { var n = val('s_nombre').trim(), p = val('s_pin').trim(); if (!n || !/^\d{4,6}$/.test(p)) { PE_toast('Nombre y PIN de 4 a 6 dígitos', true); return; } PE.rpc('admin_staff_upsert', { p_sess: t, p_id: null, p_nombre: n, p_rol: val('s_rol'), p_pin: p, p_activo: true }).then(done('Creado')).catch(fail); return; }
      case 'a:pin': { var np = prompt('Nuevo PIN (4 a 6 dígitos):', ''); if (!np) return; if (!/^\d{4,6}$/.test(np)) { PE_toast('PIN inválido', true); return; } PE.rpc('admin_staff_upsert', { p_sess: t, p_id: v, p_nombre: null, p_rol: null, p_pin: np, p_activo: null }).then(done('PIN actualizado')).catch(fail); return; }
      case 'a:toggle': PE.rpc('admin_staff_upsert', { p_sess: t, p_id: v, p_nombre: null, p_rol: null, p_pin: null, p_activo: el.getAttribute('data-on') !== '1' }).then(done()).catch(fail); return;
      case 'a:saveTarifas': PE.rpc('admin_config_set', { p_sess: t, p_clave: 'tarifas', p_valor: { dia: num('t_dia'), noche: num('t_noche'), hora_noche: num('t_hora_noche'), overnight: num('t_overnight'), mensual: num('t_mensual'), tarjeta_perdida: num('t_perdida'), itbms_incluido: true } }).then(done('Tarifas guardadas')).catch(fail); return;
      case 'a:saveSitio': PE.rpc('admin_config_set', { p_sess: t, p_clave: 'sitio', p_valor: { nombre: val('s_nombre'), direccion: val('s_direccion'), abre: val('s_abre'), cierra: val('s_cierra'), yappy: val('s_yappy'), propinas: 'pool por turno' } }).then(done('Sitio guardado')).catch(fail); return;
      case 'a:saveNiveles': PE.rpc('admin_config_set', { p_sess: t, p_clave: 'niveles', p_valor: { C: { max_lb: num('n_C'), nombre: 'Sedán' }, B: { max_lb: num('n_B'), nombre: 'SUV mediano' }, A: { max_lb: num('n_A'), nombre: 'SUV grande / pick-up' }, margen_lb: num('n_margen') } }).then(done('Niveles guardados')).catch(fail); return;
      case 'a:nuevoMensual': { var mn = val('m_nombre').trim(), mp = val('m_placa').trim(); if (!mn || !mp) { PE_toast('Nombre y placa', true); return; } PE.rpc('admin_mensual_upsert', { p_sess: t, p_id: null, p_nombre: mn, p_placa: mp, p_modelo: val('m_modelo') || null, p_telefono: val('m_tel') || null, p_activo: true }).then(done('Mensual creado')).catch(fail); return; }
      case 'a:toggleMensual': PE.rpc('admin_mensual_upsert', { p_sess: t, p_id: v, p_nombre: null, p_placa: null, p_modelo: null, p_telefono: null, p_activo: el.getAttribute('data-on') !== '1' }).then(done()).catch(fail); return;
      case 'a:generar': { var gd = Number(val('g_desde')), gh = Number(val('g_hasta')); if (!gd || !gh || gh < gd || gh - gd > 500) { PE_toast('Rango inválido', true); return; } PE.rpc('admin_tarjetas_generar', { p_sess: t, p_desde: gd, p_hasta: gh }).then(done('Tarjetas generadas')).catch(fail); return; }
      case 'a:imprimir': adm.print = [Number(val('p_desde')), Number(val('p_hasta'))]; renderA(); return;
      case 'a:tarjeta': PE.rpc('admin_tarjeta_estado', { p_sess: t, p_codigo: v, p_estado: el.getAttribute('data-e') }).then(done()).catch(fail); return;
      case 'a:nuevoModelo': { var mon = val('mo_nombre').trim(), mop = Number(val('mo_peso')); if (!mon || !mop) { PE_toast('Modelo y peso', true); return; } PE.rpc('admin_modelo_upsert', { p_sess: t, p_nombre: mon, p_peso: mop }).then(done('Modelo guardado')).catch(fail); return; }
    }
  };
})();
