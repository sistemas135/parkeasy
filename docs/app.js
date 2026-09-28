/* ParkEasy · app principal (cliente + valet) · vanilla JS */
(function () {
  'use strict';
  var CFG = window.PE_CONFIG;
  var app = document.getElementById('app');

  /* ---------------- utilidades ---------------- */
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return '$' + Number(n || 0).toFixed(2); };
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var hora = function (iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleTimeString('es-PA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Panama' }); };
  var fecha = function (iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Panama' }); };
  var secsSince = function (iso) { return iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)) : 0; };
  var mmss = function (s) { return Math.floor(s / 60) + ':' + pad2(s % 60); };
  var ubic = function (v) { return v && v.plaza ? pad2(v.plaza) + '-' + v.nivel : '—'; };
  var carro = function (v) { return [v.modelo, v.color].filter(Boolean).join(' · ') || 'Vehículo sin datos'; };
  var metodoNombre = { efectivo: 'Efectivo', yappy: 'Yappy', tarjeta: 'Tarjeta', mensual: 'Mensual', cortesia: 'Cortesía', aliado: 'Comercio aliado' };
  var estadoNombre = { recibido: 'Recibido', estacionado: 'Estacionado', solicitado: 'Solicitado', en_camino: 'En camino', en_puerta: 'En la puerta', entregado: 'Entregado', cancelado: 'Cancelado' };

  var I = {
    check: function (c, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="' + (c || '#fff') + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'; },
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6E6E73" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    clock: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#04387C" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    card: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6E6E73" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/></svg>',
    qr: function (s) { return '<svg width="' + (s || 22) + '" height="' + (s || 22) + '" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="4" height="4"/><rect x="13" y="7" width="4" height="4"/><rect x="7" y="13" width="4" height="4"/><path d="M13 13h4v4"/></svg>'; },
    star: function (c) { return '<svg width="28" height="28" viewBox="0 0 24 24" fill="' + c + '" stroke="' + c + '" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4L2.8 9.7l6.4-.8z"/></svg>'; },
    cam: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6E6E73" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    car: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.5-5.5A2 2 0 0 1 8.4 6h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M3 13h18v4a1 1 0 0 1-1 1h-1a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H4a1 1 0 0 1-1-1v-4z"/></svg>'
  };

  var toastEl = null, toastT = null;
  function toast(msg, bad) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement('div'); toastEl.className = 'toast' + (bad ? ' bad' : ''); toastEl.textContent = msg;
    document.body.appendChild(toastEl); clearTimeout(toastT);
    toastT = setTimeout(function () { if (toastEl) toastEl.remove(); toastEl = null; }, 3000);
  }
  window.PE_toast = toast;

  /* ---------------- API ---------------- */
  function rpc(fn, params) {
    return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) { d = { message: t }; }
        if (!r.ok) {
          var msg = (d && d.message) || ('HTTP ' + r.status);
          if (/SESION_INVALIDA/.test(msg)) { if (/^#\/aliado/.test(location.hash)) ASess.clear(); else Sess.clear(); location.reload(); }
          var err = new Error(msg); err.code = msg; throw err;
        }
        return d;
      });
    });
  }
  function uploadFoto(path, blob) {
    return fetch(CFG.SUPABASE_URL + '/storage/v1/object/fotos/' + path, {
      method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob
    }).then(function (r) { if (!r.ok) throw new Error('No se pudo subir la foto'); return CFG.SUPABASE_URL + '/storage/v1/object/public/fotos/' + path; });
  }
  window.PE = { rpc: rpc, esc: esc, money: money, hora: hora, fecha: fecha, secsSince: secsSince, mmss: mmss, ubic: ubic, carro: carro, metodoNombre: metodoNombre, estadoNombre: estadoNombre, I: I, pad2: pad2 };

  /* ---------------- sesión de personal ---------------- */
  var Sess = {
    get: function () { try { return JSON.parse(localStorage.getItem('pe_sess') || 'null'); } catch (e) { return null; } },
    set: function (s) { try { localStorage.setItem('pe_sess', JSON.stringify(s)); } catch (e) {} },
    clear: function () { try { localStorage.removeItem('pe_sess'); } catch (e) {} }
  };
  window.PE.Sess = Sess;
  var ASess = {
    get: function () { try { return JSON.parse(localStorage.getItem('pe_aliado') || 'null'); } catch (e) { return null; } },
    set: function (s) { try { localStorage.setItem('pe_aliado', JSON.stringify(s)); } catch (e) {} },
    clear: function () { try { localStorage.removeItem('pe_aliado'); } catch (e) {} }
  };

  /* ---------------- imágenes ---------------- */
  function comprimir(file, max) {
    return new Promise(function (res, rej) {
      var img = new Image(); var url = URL.createObjectURL(file);
      img.onload = function () {
        var w = img.width, h = img.height, k = Math.min(1, (max || 1280) / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error('img')); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('img')); };
      img.src = url;
    });
  }

  /* ---------------- escáner QR ---------------- */
  var Scanner = { stream: null, raf: null, active: false };
  function scanStart(videoEl, onCode) {
    scanStop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('Sin cámara'));
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (stream) {
      Scanner.stream = stream; Scanner.active = true;
      videoEl.srcObject = stream; videoEl.setAttribute('playsinline', ''); videoEl.muted = true;
      return videoEl.play().then(function () {
        var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
        var det = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        var busy = false, last = 0;
        function tick(ts) {
          if (!Scanner.active) return;
          if (videoEl.readyState >= 2 && !busy && ts - last > 120) {
            last = ts; busy = true;
            if (det) {
              det.detect(videoEl).then(function (codes) { busy = false; if (codes && codes[0] && Scanner.active) { onCode(codes[0].rawValue); } }).catch(function () { busy = false; });
            } else if (window.jsQR) {
              canvas.width = videoEl.videoWidth; canvas.height = videoEl.videoHeight;
              ctx.drawImage(videoEl, 0, 0);
              var d = ctx.getImageData(0, 0, canvas.width, canvas.height);
              var q = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
              busy = false;
              if (q && q.data && Scanner.active) onCode(q.data);
            } else busy = false;
          }
          Scanner.raf = requestAnimationFrame(tick);
        }
        Scanner.raf = requestAnimationFrame(tick);
      });
    });
  }
  function scanStop() {
    Scanner.active = false;
    if (Scanner.raf) cancelAnimationFrame(Scanner.raf);
    if (Scanner.stream) { Scanner.stream.getTracks().forEach(function (t) { t.stop(); }); Scanner.stream = null; }
  }
  // extrae el token o código de tarjeta de lo que lea el QR
  function parseCard(raw) {
    raw = String(raw || '').trim();
    var m = raw.match(/[#?&\/]t[=\/]([a-z0-9]{10,})/i) || raw.match(/^([a-f0-9]{16,20})$/i);
    if (m) return m[1];
    if (/^\d{3,6}$/.test(raw)) return raw;
    return null;
  }

  /* ---------------- header común ---------------- */
  function header(sub, right) {
    return '<div class="hdr"><div class="brand"><img class="logo" alt="ParkEasy" src="logo.png"><div><div class="brand-name">' + esc(CFG.APP_NAME) + '</div><div class="brand-sub">' + esc(sub || CFG.SITIO_SUB) + '</div></div></div>' + (right || '') + '</div>';
  }

  /* =====================================================================
     CLIENTE
     ===================================================================== */
  var C = { token: null, data: null, screen: 'auto', when: 'ahora', tip: 2, method: 'yappy', rating: 0, sending: false, timer: null, seenPuerta: false };
  function clienteStart(token) {
    C.token = token; C.screen = 'auto';
    clienteLoad();
    clearInterval(C.timer); C.timer = setInterval(clienteLoad, 5000);
  }
  function clienteLoad() {
    return rpc('cliente_estado', { p_token: C.token }).then(function (d) {
      if (!d.ok) { C.data = { error: d.error }; renderC(); return; }
      var prev = C.data && C.data.visita;
      C.data = d;
      if (!d.visita) {
        // tarjeta libre: ¿acaba de entregarse un carro?
        return rpc('cliente_ultima', { p_token: C.token }).then(function (u) { C.data.ultima = u.ok ? u.visita : null; renderC(); });
      }
      renderC();
    }).catch(function (e) { if (!C.data) { C.data = { error: 'RED' }; renderC(); } });
  }
  function tarifarioHtml(t) {
    if (!t || !t.tramos) return '';
    var rows = '', prev = 0;
    t.tramos.forEach(function (tr) { var h = tr.hasta_min / 60; rows += '<div class="kv"><span class="k">' + (prev ? 'De ' + prev + ' a ' + h : 'Hasta ' + h) + ' horas</span><b>' + money(tr.precio) + '</b></div>'; prev = h; });
    if (t.por_24h_adicional) rows += '<div class="kv"><span class="k">Cada 24 horas adicionales</span><b>+' + money(t.por_24h_adicional) + '</b></div>';
    return '<div class="card sm" style="gap:8px"><div class="label">Tarifario · por tiempo</div>' + rows + '<div class="small" style="text-align:left">El tiempo cuenta desde que recibimos tu carro hasta que lo pides' + (t.gracia_min ? ' · ' + t.gracia_min + ' min de tolerancia en cada corte' : '') + (t.itbms_incluido ? ' · ITBMS incluido' : '') + (t.tarjeta_perdida ? ' · tarjeta perdida ' + money(t.tarjeta_perdida) : '') + '.</div></div>';
  }
  function precioVivo(v) {
    var c = v.cotizacion || {};
    if (v.tipo === 'mensual') {
      if (Number(c.precio) > 0) return '<div class="note warn" style="text-align:left;justify-content:space-between"><span>Fuera del horario del contrato' + (c.horario_hasta ? ' (desde ' + String(c.horario_hasta).slice(0, 5) + ')' : '') + '</span><b>' + money(c.precio) + '</b></div>';
      return '<div class="note ok">Contrato · sin cargo</div>';
    }
    var cub = Number(v.cubierto || 0), dif = Math.max(0, Number(c.precio || 0) - cub);
    if (v.comercio_id) {
      var h2 = '<div class="note ok" style="text-align:left;justify-content:space-between"><span>Cortesía de ' + esc(v.comercio || 'tu restaurante') + '</span><b>' + money(cub) + '</b></div>';
      if (dif > 0) h2 += '<div class="card sm" style="gap:6px"><div class="row-between"><span style="font-size:14px;color:var(--muted)">Tiempo adicional · ' + Math.floor((c.minutos || 0) / 60) + ' h ' + pad2((c.minutos || 0) % 60) + ' min</span><b style="font-size:20px;font-weight:800">' + money(dif) + '</b></div><div class="small" style="text-align:left">Tu restaurante cubrió ' + money(cub) + '; la tarifa actual es ' + money(c.precio) + '. Pagas solo la diferencia.</div>' + (v.extra > 0 ? '<div class="kv"><span class="k">Tarjeta perdida</span><b>' + money(v.extra) + '</b></div>' : '') + '</div>';
      else if (c.sube_en && c.sube_a != null) h2 += '<div class="small">Cubre hasta las ' + esc(hora(c.sube_en)) + '; después pagas solo la diferencia.</div>';
      return h2;
    }
    var h = '<div class="card sm" style="gap:6px"><div class="row-between"><span style="font-size:14px;color:var(--muted)">Tarifa actual · ' + Math.floor((c.minutos || 0) / 60) + ' h ' + pad2((c.minutos || 0) % 60) + ' min</span><b style="font-size:20px;font-weight:800">' + money(c.precio) + '</b></div>';
    if (c.sube_en && c.sube_a != null) h += '<div class="small" style="text-align:left">Sube a ' + money(c.sube_a) + ' a las ' + esc(hora(c.sube_en)) + '</div>';
    if (v.extra > 0) h += '<div class="kv"><span class="k">Tarjeta perdida</span><b>' + money(v.extra) + '</b></div>';
    return h + '<button class="back" style="padding:4px 0" data-a="c:tarifario">Ver tarifario completo</button></div>';
  }
  // ¿la visita no tiene nada que cobrar al cliente (contrato o cortesía del comercio que cubre todo)?
  function sinCargoCliente(v) {
    var c = v.cotizacion || {};
    if (v.extra > 0) return false;
    if (v.tipo === 'mensual') return !(Number(c.precio) > 0);
    if (v.comercio_id) return Math.max(0, Number(c.precio || 0) - Number(v.cubierto || 0)) === 0;
    return false;
  }
  function clienteScreen() {
    var d = C.data; if (!d) return 'loading';
    if (d.error) return 'error';
    if (!d.visita) return d.ultima ? 'gracias' : 'libre';
    var v = d.visita;
    if (v.estado === 'recibido' || v.estado === 'estacionado') return (C.screen === 'pedir' || C.screen === 'pago') ? C.screen : 'ticket';
    if (v.estado === 'solicitado' || v.estado === 'en_camino') return 'estado';
    if (v.estado === 'en_puerta') return 'puerta';
    if (v.estado === 'cancelado') return 'libre';
    return 'ticket';
  }
  function renderC() {
    var s = clienteScreen(), d = C.data, v = d && d.visita, h = '';
    var right = v ? '<div class="pill">TARJETA ' + esc(d.tarjeta) + '</div>' : (d && d.tarjeta ? '<div class="pill">TARJETA ' + esc(d.tarjeta) + '</div>' : '');
    h += header(null, right);
    if (s === 'loading') { h += '<div class="screen"><div class="empty"><div class="spin" style="margin:0 auto 10px"></div>Cargando…</div></div>'; }
    else if (s === 'error') {
      h += '<div class="screen"><h1>No encontramos esta tarjeta</h1><p>' + (d.error === 'RED' ? 'Revisa tu conexión e intenta de nuevo.' : 'Acércate al stand de ParkEasy y te ayudamos.') + '</p><div class="grow"></div><button class="btn2" data-a="c:reload">Reintentar</button></div>';
    } else if (s === 'libre') {
      h += '<div class="screen"><h1>Tarjeta lista</h1><p>Esta tarjeta no tiene ningún carro asignado en este momento. Entrégasela al valet al llegar y él la activará con tu carro.</p>'
        + '<div class="card sm"><div class="label">Cómo funciona</div><div class="list"><div class="li"><span class="num">1</span>Entrega tu carro y recibe esta tarjeta</div><div class="li"><span class="num">2</span>Escanea el QR cuando quieras tu carro</div><div class="li"><span class="num">3</span>Paga en el celular y lo llevamos a la puerta</div></div></div>'
        + (d.tipo_tarjeta === 'contrato' ? '' : tarifarioHtml(d.tarifario))
        + '<div class="grow"></div><div class="small">' + esc((d.sitio && d.sitio.nombre) || '') + '</div><button class="tlink" data-a="c:terminos">Términos y condiciones</button></div>';
    } else if (s === 'ticket') {
      var n = (v.fotos || []).length;
      h += '<div class="screen"><h1>Tu carro está con nosotros</h1>'
        + '<div class="card">'
        + (n ? '<div><div class="label" style="margin-bottom:8px">Fotos al recibir · ' + n + '</div><div class="thumbs">' + v.fotos.slice(0, 4).map(function (u) { return '<a class="thumb" href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="foto"></a>'; }).join('') + '</div></div>' : '')
        + '<div class="row-between"><div><div style="font-size:17px;font-weight:800">' + esc(carro(v)) + '</div><div style="font-size:13px;color:var(--muted);margin-top:4px">Recibido ' + esc(hora(v.recibido_en)) + (v.runner_recibe ? ' · por ' + esc(v.runner_recibe) : '') + '</div></div>' + (v.placa ? '<span class="plate">' + esc(v.placa) + '</span>' : '') + '</div>'
        + '</div>'
        + precioVivo(v)
        + '<div class="grow"></div><div class="small">Conserva tu tarjeta con QR: la pediremos al entregarte el carro.</div>'
        + '<button class="btn" data-a="c:pedir">Pedir mi carro</button><button class="tlink" data-a="c:terminos">Términos y condiciones</button></div>';
    } else if (s === 'pedir') {
      var opts = [['ahora', 'Ahora mismo', 'Ya voy saliendo'], ['5', 'En 5 minutos', 'Estoy pidiendo la cuenta'], ['10', 'En 10 minutos', 'Termino y salgo']];
      h += '<div class="screen"><button class="back" data-a="c:ticket">' + I.back + 'Volver</button><h1>¿Cuándo lo quieres?</h1><p>Lo tendremos en la puerta a tiempo. Traer tu carro toma unos minutos.</p><div style="display:flex;flex-direction:column;gap:10px">';
      opts.forEach(function (o) { var on = o[0] === C.when; h += '<button class="opt' + (on ? ' on' : '') + '" data-a="c:when" data-v="' + o[0] + '"><span><span class="t">' + o[1] + '</span><span class="s">' + o[2] + '</span></span>' + (on ? I.check('#0A0A0A', 22) : '') + '</button>'; });
      var sinCargo = sinCargoCliente(v);
      h += '</div><div class="grow"></div>' + (sinCargo ? '<div class="note ok">' + (v.comercio_id ? 'Cortesía de ' + esc(v.comercio || 'tu restaurante') + ' · sin cargo' : 'Contrato · sin cargo') + '</div><button class="btn" data-a="c:pay"' + (C.sending ? ' disabled' : '') + '>Pedir mi carro</button>' + (v.comercio_id ? '<button class="back" style="align-self:center" data-a="c:pago">Quiero dejar propina</button>' : '') : '<button class="btn" data-a="c:pago">Continuar</button>') + '</div>';
    } else if (s === 'pago') {
      var cot = v.cotizacion || {}, cubierto = Number(v.cubierto || 0), precioAhora = Number(cot.precio != null ? cot.precio : v.tarifa), base = Math.max(0, precioAhora - cubierto) + Number(v.extra), total = base + C.tip, mensual = v.tipo !== 'abierto';
      h += '<div class="screen"><button class="back" data-a="c:pedir">' + I.back + 'Volver</button><h1>' + (mensual || (v.comercio_id && base === 0) ? 'Propina' : 'Pago') + '</h1>'
        + '<div class="card sm">' + (mensual ? (Number(cot.precio) > 0 ? '<div class="kv"><span class="k">Fuera del horario del contrato · ' + Math.floor((cot.fuera_horario_min || 0) / 60) + ' h ' + pad2((cot.fuera_horario_min || 0) % 60) + ' min</span><b>' + money(cot.precio) + '</b></div>' : '<div class="kv"><span class="k">Servicio</span><b>Contrato · $0.00</b></div>') : '<div class="kv"><span class="k">Tarifa valet · ' + Math.floor((cot.minutos || 0) / 60) + ' h ' + pad2((cot.minutos || 0) % 60) + ' min</span><b>' + money(precioAhora) + '</b></div>' + (v.comercio_id ? '<div class="kv"><span class="k">Cortesía de ' + esc(v.comercio || 'tu restaurante') + '</span><b>−' + money(Math.min(cubierto, precioAhora)) + '</b></div>' : '')) + (v.extra > 0 ? '<div class="kv"><span class="k">Tarjeta perdida</span><b>' + money(v.extra) + '</b></div>' : '')
        + '<div class="kv"><span class="k">Propina para el equipo</span><b>' + money(C.tip) + '</b></div><div class="line"></div><div class="kv" style="font-size:17px"><b style="font-weight:800">Total</b><b style="font-weight:800">' + money(total) + '</b></div></div>'
        + '<div><div class="label" style="margin-bottom:8px">Propina · opcional</div><div class="chips">';
      [[0, 'Sin propina'], [1, '$1'], [2, '$2'], [3, '$3'], [5, '$5']].forEach(function (t) { h += '<button class="chip' + (t[0] === C.tip ? ' on' : '') + '" data-a="c:tip" data-v="' + t[0] + '">' + t[1] + '</button>'; });
      h += '</div></div>';
      if (base > 0 && !mensual) h += '<div class="small">' + (v.comercio_id ? 'Pagas solo la diferencia sobre lo que cubrió tu restaurante.' : 'El precio queda fijo al pedir tu carro.') + '</div>';
      if (total > 0) {
        h += '<div><div class="label" style="margin-bottom:8px">Método de pago</div><div style="display:flex;flex-direction:column;gap:8px">';
        [['yappy', 'Yappy', 'Lo confirmamos en el stand'], ['tarjeta', 'Tarjeta', 'Datáfono en el stand'], ['efectivo', 'Efectivo', 'Pagas al recibir el carro']].forEach(function (m) { var on = m[0] === C.method; h += '<button class="opt' + (on ? ' on' : '') + '" style="padding:13px 16px;border-radius:14px" data-a="c:method" data-v="' + m[0] + '"><span><span class="t" style="font-size:16px">' + m[1] + '</span><span class="s" style="font-size:12px">' + m[2] + '</span></span>' + (on ? I.check('#0A0A0A', 22) : '') + '</button>'; });
        h += '</div></div>';
      }
      h += '<div class="grow"></div><button class="btn" data-a="c:pay"' + (C.sending ? ' disabled' : '') + '>' + (total === 0 ? 'Pedir mi carro' : (C.method === 'efectivo' ? 'Confirmar · pago en efectivo' : 'Pedir y pagar ' + money(total))) + '</button><div class="small">Al pedir tu carro aceptas los <button class="tlink inline" data-a="c:terminos">términos y condiciones</button>.</div></div>';
    } else if (s === 'estado') {
      var fase = v.estado === 'en_camino' ? 1 : 0;
      var etaMin = v.cuando === '10' ? 10 : (v.cuando === '5' ? 5 : 4), rest = Math.max(1, etaMin - Math.floor(secsSince(v.solicitado_en) / 60));
      var steps = [['Solicitado', hora(v.solicitado_en)], ['En camino', fase >= 1 ? (v.runner_entrega || 'Un valet') + ' va por tu carro' : 'Un valet irá por tu carro'], ['En la puerta', 'Te avisamos aquí']];
      h += '<div class="screen"><div><h1>' + (fase === 0 ? 'Pedimos tu carro' : 'Tu carro va en camino') + '</h1><p style="margin-top:6px">' + (fase === 0 ? 'Estás en la fila. Un valet lo trae en un momento.' : 'Acércate a la puerta.') + '</p></div>'
        + '<div class="eta"><div><div class="label">Llega en</div><div class="n">' + (fase === 1 ? '2' : rest) + ' min</div></div>' + I.clock + '</div><div>';
      steps.forEach(function (st, i) { var done = i < fase, act = i === fase; h += '<div class="step"><div class="col"><div class="dot' + (done ? ' done' : (act ? ' active' : '')) + '">' + (done ? I.check('#fff', 14) : '') + '</div>' + (i < 2 ? '<div class="vline' + (done ? ' done' : '') + '"></div>' : '') + '</div><div class="txt"><b' + ((done || act) ? '' : ' class="dim"') + '>' + st[0] + '</b><span>' + esc(st[1]) + '</span></div></div>'; });
      h += '</div>' + pagoRow(v) + '<div class="grow"></div><div class="small">Puedes cerrar esta página. Tu tarjeta con QR te trae de vuelta.</div></div>';
    } else if (s === 'puerta') {
      h += '<div class="screen" style="gap:18px"><div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:8px"><div class="big-check">' + I.check('#fff', 42) + '</div><h1 style="text-align:center">Tu carro está en la puerta</h1><p style="text-align:center">Busca al valet' + (v.runner_entrega ? ' · ' + esc(v.runner_entrega) : '') + ' y entrégale tu tarjeta</p></div>'
        + '<div class="codecard"><div class="label" style="color:var(--muted2)">Muestra este número al valet</div><div class="c">' + esc(d.tarjeta) + '</div><div style="font-size:14px;font-weight:800;letter-spacing:.08em;color:#D1D1D6">' + esc((v.placa || '') + (v.modelo ? ' · ' + v.modelo : '')) + '</div></div>'
        + pagoRow(v) + '<div class="grow"></div></div>';
    } else if (s === 'gracias') {
      var u = d.ultima;
      h += '<div class="screen" style="gap:18px"><h1 style="font-size:30px">¡Buen viaje!</h1><p>¿Cómo estuvo el servicio?</p><div class="stars">';
      for (var k = 1; k <= 5; k++) h += '<button class="star" data-a="c:star" data-v="' + k + '" aria-label="' + k + ' estrellas">' + I.star(k <= (C.rating || u.calificacion || 0) ? '#0A0A0A' : '#D1D1D6') + '</button>';
      h += '</div><div class="card sm" style="gap:10px"><div class="row-between"><span class="label">Recibo</span><span style="font-size:12px;color:var(--muted)">' + esc(fecha(u.entregado_en)) + ' · ' + esc(hora(u.entregado_en)) + '</span></div><div style="font-size:14px;color:var(--muted)">' + esc(CFG.APP_NAME) + ' · Tarjeta ' + esc(d.tarjeta) + (u.placa ? ' · ' + esc(u.placa) : '') + '</div>'
        + (u.tipo === 'mensual' ? '<div class="kv"><span class="k">Contrato' + (u.tarifa > 0 ? ' · fuera de horario' : '') + '</span><b>' + money(u.tarifa) + '</b></div>' : '<div class="kv"><span class="k">Tarifa valet · ' + Math.floor((u.minutos || 0) / 60) + ' h ' + pad2((u.minutos || 0) % 60) + ' min</span><b>' + money(Number(u.tarifa) + Number(u.cubierto || 0)) + '</b></div>' + (u.comercio_id ? '<div class="kv"><span class="k">Cortesía de ' + esc(u.comercio || 'tu restaurante') + '</span><b>−' + money(u.cubierto) + '</b></div>' : '')) + (u.extra > 0 ? '<div class="kv"><span class="k">Tarjeta perdida</span><b>' + money(u.extra) + '</b></div>' : '') + '<div class="kv"><span class="k">Propina</span><b>' + money(u.propina) + '</b></div><div class="line"></div><div class="kv" style="font-size:16px"><b style="font-weight:800">Total · ' + esc(metodoNombre[u.pago_metodo] || '') + '</b><b style="font-weight:800">' + money(u.total) + '</b></div></div>'
        + '<div class="grow"></div><div class="small">Gracias por usar ' + esc(CFG.APP_NAME) + '.</div><button class="tlink" data-a="c:terminos">Términos y condiciones</button></div>';
    }
    app.innerHTML = '<div class="phone">' + h + '</div>';
  }
  function pagoRow(v) {
    var txt;
    if (v.tipo === 'mensual' && !(Number(v.total) > 0)) txt = 'Contrato · sin cargo';
    else if (v.comercio_id && !(Number(v.total) > 0)) txt = 'Cortesía de ' + (v.comercio || 'tu restaurante') + ' · sin cargo';
    else if (v.pago_estado === 'pagado') txt = 'Pagado con ' + (metodoNombre[v.pago_metodo] || '') + ' · ' + money(v.total);
    else if (v.pago_metodo === 'efectivo') txt = 'Pagas ' + money(v.total) + ' en efectivo al recibir el carro';
    else if (v.pago_metodo === 'yappy') txt = 'Yappy · ' + money(v.total) + ' · muestra tu comprobante en el stand';
    else txt = 'Tarjeta · ' + money(v.total) + ' · pagas en el datáfono del stand';
    return '<div class="payrow">' + I.card + '<span>' + esc(txt) + '</span></div>';
  }
  function actC(a, v) {
    switch (a) {
      case 'c:reload': C.data = null; renderC(); clienteLoad(); return;
      case 'c:ticket': C.screen = 'ticket'; break;
      case 'c:pedir': C.screen = 'pedir'; break;
      case 'c:pago': C.screen = 'pago'; break;
      case 'c:when': C.when = v; break;
      case 'c:tip': C.tip = Number(v); break;
      case 'c:method': C.method = v; break;
      case 'c:tarifario': { var t = (C.data && C.data.tarifario) || null; document.body.insertAdjacentHTML('beforeend', '<div class="overlay" data-a="c:cerrarSheet"><div class="sheet"><div class="handle"></div>' + tarifarioHtml(t) + '<button class="btn2 md" data-a="c:cerrarSheet">Cerrar</button></div></div>'); return; }
      case 'c:terminos': { document.body.insertAdjacentHTML('beforeend', '<div class="overlay" data-a="c:cerrarSheet"><div class="sheet"><div class="handle"></div><h1 class="sm">Términos y condiciones</h1>' + terminosHtml() + '<button class="btn2 md" data-a="c:cerrarSheet">Cerrar</button></div></div>'); return; }
      case 'c:cerrarSheet': { var o = document.querySelector('.overlay'); if (o) o.remove(); return; }
      case 'c:pay':
        if (C.sending) return; C.sending = true; renderC();
        var vis = C.data && C.data.visita, gratis = vis && sinCargoCliente(vis) && C.screen !== 'pago';
        rpc('cliente_pedir', { p_token: C.token, p_cuando: C.when, p_propina: gratis ? 0 : C.tip, p_metodo: gratis ? null : C.method }).then(function (r) {
          C.sending = false; C.screen = 'auto';
          if (!r.ok) { toast(r.error === 'YA_SOLICITADO' ? 'Ya habías pedido tu carro' : 'No se pudo enviar', true); }
          clienteLoad();
        }).catch(function () { C.sending = false; toast('Sin conexión. Intenta de nuevo.', true); renderC(); });
        return;
      case 'c:star': C.rating = Number(v); rpc('cliente_calificar', { p_token: C.token, p_estrellas: C.rating }).then(function () { toast('¡Gracias por calificar!'); }); break;
    }
    renderC();
  }

  /* =====================================================================
     VALET (runner / capitán)
     ===================================================================== */
  var V = { sess: null, data: null, tab: 'cola', flow: null, timer: null, tick: null, busy: false, pin: '', pinErr: false,
    // flujo de recepción
    rec: null, q: '', res: [], searching: false, searchT: null, entrega: null };
  function valetStart() {
    V.sess = Sess.get();
    renderV();
    if (V.sess) { valetLoad(); clearInterval(V.timer); V.timer = setInterval(valetLoad, 4000); }
    clearInterval(V.tick); V.tick = setInterval(function () { if (V.sess && !V.flow && !V.entrega) renderV(); }, 1000);
  }
  function valetLoad() {
    if (!V.sess) return Promise.resolve();
    return rpc('runner_estado', { p_sess: V.sess.token }).then(function (d) { V.data = d; if (!V.flow && !V.entrega) renderV(); }).catch(function () {});
  }
  function pinScreen(titulo) {
    var h = header(titulo || 'Acceso del personal', '');
    h += '<div class="screen"><h1 class="sm">Ingresa tu PIN</h1><div class="boxes">';
    for (var i = 0; i < 6; i++) h += '<div class="box' + (V.pinErr ? ' err' : (i < V.pin.length ? ' filled' : (i === V.pin.length ? ' next' : ''))) + '">' + (i < V.pin.length ? '•' : '') + '</div>';
    h += '</div>' + (V.pinErr ? '<div class="err">PIN incorrecto</div>' : '<div class="small">4 a 6 dígitos · toca ✓ para entrar</div>') + '<div class="keys">';
    '123456789'.split('').forEach(function (k) { h += '<button class="key" data-a="v:key" data-v="' + k + '">' + k + '</button>'; });
    h += '<button class="key del" data-a="v:del">⌫</button><button class="key" data-a="v:key" data-v="0">0</button><button class="key" data-a="v:enter" style="background:var(--ink);color:#fff">✓</button></div></div>';
    return h;
  }
  function renderV() {
    if (A.active) { renderAl(); return; }
    if (!V.sess) { app.innerHTML = '<div class="phone">' + pinScreen(V._title || 'App del valet') + '</div>'; return; }
    if (V.flow) { app.innerHTML = '<div class="phone">' + renderFlow() + '</div>'; afterRenderFlow(); return; }
    if (V.entrega) { app.innerHTML = '<div class="phone">' + renderEntrega() + '</div>'; afterRenderEntrega(); return; }
    var d = V.data, h = header(V.sess.nombre + ' · ' + (V.sess.rol === 'runner' ? 'Runner' : (V.sess.rol === 'capitan' ? 'Capitán' : 'Admin')), '<button class="avatar" data-a="v:logout" title="Salir">Salir</button>');
    var cola = d ? d.cola : [], pend = d ? d.pendientes : [], cupos = d ? d.cupos : null;
    h += '<div class="screen" style="gap:12px">';
    h += '<div class="kpis"><div class="kpi dark"><div class="n">' + (d ? d.custodia : '–') + '</div><div class="l">En custodia</div></div><div class="kpi' + (cola.length ? ' blue' : '') + '"><div class="n">' + cola.length + '</div><div class="l">Por entregar</div></div><div class="kpi"><div class="n" style="font-size:16px;line-height:1.5">' + (cupos ? ['A', 'B', 'C'].map(function (k) { return k + ' ' + (cupos[k] ? cupos[k].libres : '–'); }).join('<br>') : '–') + '</div><div class="l">Cupos libres</div></div></div>';
    h += '<button class="btn xl" data-a="v:recibir">' + I.qr(26) + 'Recibir carro</button>';
    h += '<div class="tabs"><button class="' + (V.tab === 'cola' ? 'on' : '') + '" data-a="v:tab" data-v="cola">Entregas' + (cola.length ? '<span class="badge">' + cola.length + '</span>' : '') + '</button><button class="' + (V.tab === 'pend' ? 'on' : '') + '" data-a="v:tab" data-v="pend">Sin ubicar' + (pend.length ? '<span class="badge">' + pend.length + '</span>' : '') + '</button></div>';
    if (!d) h += '<div class="empty"><div class="spin" style="margin:0 auto 10px"></div>Cargando…</div>';
    else if (V.tab === 'cola') {
      if (!cola.length) h += '<div class="empty">No hay carros solicitados.<br>Cuando un cliente pida su carro aparece aquí.</div>';
      cola.forEach(function (v) {
        var s = secsSince(v.solicitado_en), late = v.estado === 'solicitado' && s > 240;
        var pago = v.pago_estado === 'pagado' ? '<span class="tag ok">' + (v.tipo === 'mensual' && !(Number(v.total) > 0) ? 'Contrato · sin cargo' : (v.comercio_id && !(Number(v.total) > 0) ? 'Cortesía · ' + esc(v.comercio || 'aliado') : 'Pagado' + (v.pago_metodo ? ' · ' + metodoNombre[v.pago_metodo] : ''))) + '</span>' : (v.pago_metodo === 'efectivo' ? '<span class="tag warn">Cobrar ' + money(v.total) + ' efectivo</span>' : '<span class="tag bad">Pago ' + (metodoNombre[v.pago_metodo] || '') + ' por confirmar</span>');
        var est = v.estado === 'en_puerta' ? '<span class="tag dark">En la puerta</span>' : (v.estado === 'en_camino' ? '<span class="tag blue">En camino' + (v.runner_entrega ? ' · ' + esc(v.runner_entrega) : '') + '</span>' : '<span class="tag">' + (v.cuando === 'ahora' || !v.cuando ? 'Ahora' : 'En ' + v.cuando + ' min') + '</span>');
        var btn = v.estado === 'solicitado' ? '<button class="take" data-a="v:tomar" data-v="' + v.id + '">Tomar</button>' : (v.estado === 'en_camino' ? '<button class="take" data-a="v:puerta" data-v="' + v.id + '">En la puerta</button>' : '<button class="take" data-a="v:entregar" data-v="' + v.id + '">Entregar</button>');
        h += '<div class="req' + (late ? ' alert' : '') + '" data-a="v:ver" data-v="' + v.id + '"><div class="info"><div class="row-between"><span class="code">' + esc(v.tarjeta) + ' · <span style="font-weight:700">' + esc(ubic(v)) + '</span></span><span class="timer' + (late ? ' late' : '') + '">' + mmss(s) + '</span></div><div class="sub">' + esc(carro(v)) + (v.placa ? ' · ' + esc(v.placa) : '') + '</div><div class="tags">' + est + pago + '</div></div>' + btn + '</div>';
      });
    } else {
      if (!pend.length) h += '<div class="empty">Todos los carros recibidos ya tienen ubicación.</div>';
      pend.forEach(function (v) {
        var s = secsSince(v.recibido_en), late = s > 300;
        h += '<div class="req' + (late ? ' alert' : '') + '"><div class="info"><div class="row-between"><span class="code">Tarjeta ' + esc(v.tarjeta) + '</span><span class="timer' + (late ? ' late' : '') + '">' + mmss(s) + '</span></div><div class="sub">' + esc(v.modelo ? carro(v) : 'Sin datos del vehículo') + (v.runner_recibe ? ' · ' + esc(v.runner_recibe) : '') + '</div></div><button class="take" data-a="v:continuar" data-v="' + v.id + '">Continuar</button></div>';
      });
    }
    h += '</div>';
    app.innerHTML = '<div class="phone">' + h + '</div>';
  }

  /* ----- flujo de recepción: escanear → fotos → datos → estacionar → ubicación ----- */
  function startRec(visita) {
    V.flow = { step: visita ? (visita.fotos && visita.fotos.length ? (visita.modelo ? 'ubicar' : 'datos') : 'fotos') : 'scan', v: visita || null, fotos: (visita && visita.fotos) || [], placa: (visita && visita.placa) || '', color: (visita && visita.color) || '', modelo: null, nivel: (visita && visita.nivel_sugerido) || null, sug: null, plaza: (visita && visita.plaza) || null, niv: (visita && visita.nivel) || null, manual: false, code: '', err: '' };
    V.q = ''; V.res = [];
    renderV();
  }
  function renderFlow() {
    var f = V.flow, h = header('Recibir carro', '<button class="avatar" data-a="v:cancelflow">Cerrar</button>');
    var barra = '<div class="bars">' + ['scan', 'fotos', 'datos', 'estacionar', 'ubicar'].map(function (s, i) { var idx = ['scan', 'fotos', 'datos', 'estacionar', 'ubicar'].indexOf(f.step); return '<i class="' + (i < idx ? 'done' : (i === idx ? 'cur' : '')) + '"></i>'; }).join('') + '</div>';
    if (f.step === 'scan') {
      h += '<div class="screen">' + barra + '<h1 class="sm">Escanea la tarjeta</h1><p>Apunta al QR de la tarjeta que le entregas al cliente.</p>'
        + (f.manual ? '' : '<div class="viewfinder"><video id="vid" playsinline muted></video><div class="frame"></div><div class="cap">BUSCANDO QR…</div></div>')
        + (f.err ? '<div class="err">' + esc(f.err) + '</div>' : '')
        + '<div class="field"><div class="label">O escribe el número de la tarjeta</div><div class="row"><input class="input" id="codeInput" inputmode="numeric" pattern="[0-9]*" placeholder="Ej. 1042" value="' + esc(f.code) + '"><button class="btn sm" style="height:50px" data-a="f:code">Buscar</button></div></div>'
        + '<div class="grow"></div></div>';
    } else if (f.step === 'fotos') {
      var labels = ['Frente', 'Lado izq.', 'Lado der.', 'Atrás'];
      h += '<div class="screen">' + barra + '<div class="row-between"><h1 class="sm">Fotos del carro</h1><span class="pill">TARJETA ' + esc(f.v.tarjeta) + '</span></div><p>Toma las 4 fotos antes de moverlo. Son tu respaldo ante cualquier reclamo.</p><div class="fotos">';
      for (var i = 0; i < 4; i++) { var u = f.fotos[i]; h += '<label class="foto"><span class="b' + (!u && i === f.fotos.length ? ' next' : '') + '">' + (u ? '<img src="' + esc(u) + '" alt="">' : I.cam) + '</span><span>' + labels[i] + '</span><input type="file" accept="image/*" capture="environment" hidden data-foto="' + i + '"></label>'; }
      h += '</div>' + (f.err ? '<div class="err">' + esc(f.err) + '</div>' : '') + (f.subiendo ? '<div class="note"><span class="spin"></span>Subiendo foto…</div>' : '')
        + '<div class="grow"></div><button class="btn" data-a="f:fotosOk"' + (f.fotos.length ? '' : ' disabled') + '>' + (f.fotos.length >= 4 ? 'Continuar' : 'Continuar con ' + f.fotos.length + ' foto' + (f.fotos.length === 1 ? '' : 's')) + '</button></div>';
    } else if (f.step === 'datos') {
      var m = f.modelo, lvl = f.nivel;
      h += '<div class="screen">' + barra + '<div class="row-between"><h1 class="sm">Datos del carro</h1><span class="pill">TARJETA ' + esc(f.v.tarjeta) + '</span></div>'
        + '<div class="field"><div class="label">Placa</div><input class="input plate" id="placa" autocapitalize="characters" autocomplete="off" placeholder="AB 1234" value="' + esc(f.placa) + '"></div>'
        + '<div class="field"><div class="label">Marca y modelo</div>';
      if (m) h += '<div class="picked"><b>' + esc(m.nombre) + (m.peso_lb ? ' · ' + m.peso_lb.toLocaleString('en-US') + ' lb' : '') + '</b><button data-a="f:unpick">Cambiar</button></div>';
      else {
        h += '<input class="input" id="q" autocomplete="off" placeholder="Ej. Toyota Fortuner" value="' + esc(V.q) + '"><div class="res">';
        if (V.searching) h += '<div class="info"><span class="spin"></span>Buscando…</div>';
        V.res.forEach(function (r) { h += '<button data-a="f:pick" data-v="' + esc(r.nombre) + '" data-lb="' + r.peso_lb + '"><span><b>' + esc(r.nombre) + '</b><span>' + r.peso_lb.toLocaleString('en-US') + ' lb</span></span><span class="lvl' + (r.nivel === 'X' ? ' x' : (r.nivel === 'B' ? ' b' : '')) + '">' + r.nivel + '</span></button>'; });
        if (V.q.length >= 2 && !V.searching && !V.res.length) h += '<div class="info">No está en el catálogo. Elige la categoría:</div>';
        if (V.q.length >= 2 && !V.searching) { h += '<div class="chips">' + [['sedan', 'Sedán'], ['suv_mediano', 'SUV mediano'], ['suv_grande', 'SUV grande / pick-up']].map(function (c) { return '<button class="chip" data-a="f:cat" data-v="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>'; }
        h += '</div>';
      }
      h += '</div><div class="field"><div class="label">Color</div><div class="chips">' + ['Blanco', 'Negro', 'Gris', 'Plata', 'Azul', 'Rojo', 'Otro'].map(function (c) { return '<button class="chip pillc' + (f.color === c ? ' on' : '') + '" data-a="f:color" data-v="' + c + '">' + c + '</button>'; }).join('') + '</div></div>';
      if (m) {
        h += lvl === 'X' ? '<div class="nivel bad"><div class="nrow"><div class="n">No cabe</div><div class="why"><b>Muy pesado para los triplicadores</b>Avísale al capitán.</div></div></div>'
          : '<div class="nivel"><div class="nrow"><div class="n">Nivel ' + lvl + '</div><div class="why"><b>' + esc(m.nombre) + '</b>' + (m.peso_lb ? m.peso_lb.toLocaleString('en-US') + ' lb' : '') + '</div></div></div>';
      }
      h += (f.err ? '<div class="err">' + esc(f.err) + '</div>' : '') + '<div class="grow"></div><button class="btn" data-a="f:datosOk"' + (m && f.placa.trim() && lvl !== 'X' && !V.busy ? '' : ' disabled') + '>Guardar y estacionar</button></div>';
    } else if (f.step === 'estacionar') {
      h += '<div class="screen">' + barra + '<div class="hero-dark grow"><div class="k">TARJETA ' + esc(f.v.tarjeta) + (f.mensual ? ' · CONTRATO' : '') + '</div><div class="t">Ve y estaciona<br>en nivel ' + esc(f.nivel) + '</div><div class="s">' + esc(f.v.modelo || '') + (f.v.placa ? ' · ' + esc(f.v.placa) : '') + '<br>Plaza sugerida: <b style="color:#fff">' + (f.sug ? pad2(f.sug) + '-' + f.nivel : 'la que esté libre') + '</b></div></div>'
        + '<button class="btn" data-a="f:estacionado">Ya lo estacioné</button></div>';
    } else if (f.step === 'ubicar') {
      var plaza = f.plaza || f.sug || 1, niv = f.niv || f.nivel || 'A';
      h += '<div class="screen">' + barra + '<div class="row-between"><h1 class="sm">¿Dónde quedó?</h1><span class="pill">TARJETA ' + esc(f.v.tarjeta) + '</span></div><p>Confirma la plaza y la altura donde lo dejaste.</p>'
        + '<div class="grid2"><div class="field"><div class="label">Plaza</div><select class="sel" id="selPlaza">';
      for (var p = 1; p <= 23; p++) h += '<option value="' + p + '"' + (p === Number(plaza) ? ' selected' : '') + '>' + pad2(p) + '</option>';
      h += '</select></div><div class="field"><div class="label">Altura</div><select class="sel" id="selNivel">' + ['A', 'B', 'C'].map(function (n) { return '<option value="' + n + '"' + (n === niv ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div></div>'
        + (f.nivel && niv !== f.nivel ? '<div class="note warn">El sistema sugirió nivel ' + esc(f.nivel) + '. Confirma solo si el capitán lo autorizó.</div>' : '')
        + '<div class="spot"><span class="label" style="color:var(--muted2)">Ubicación</span><span class="n" id="spotTxt">' + pad2(plaza) + '-' + niv + '</span></div>'
        + (f.err ? '<div class="err">' + esc(f.err) + '</div>' : '') + '<div class="grow"></div><button class="btn" data-a="f:ubicar"' + (V.busy ? ' disabled' : '') + '>Confirmar ubicación</button></div>';
    } else if (f.step === 'listo') {
      h += '<div class="screen" style="gap:18px"><div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:30px"><div class="big-check">' + I.check('#fff', 42) + '</div><h1 style="text-align:center">Listo · ' + esc(ubic(f.v)) + '</h1><p style="text-align:center">Tarjeta ' + esc(f.v.tarjeta) + ' · ' + esc(carro(f.v)) + '</p></div><div class="grow"></div><button class="btn" data-a="v:cancelflow">Volver</button><button class="btn2" data-a="v:recibir">Recibir otro carro</button></div>';
    }
    return h;
  }
  function afterRenderFlow() {
    var f = V.flow; if (!f) return;
    if (f.step === 'scan' && !f.manual) {
      var vid = document.getElementById('vid');
      scanStart(vid, function (raw) { var code = parseCard(raw); if (code) { scanStop(); recibirCodigo(code); } })
        .catch(function () { if (V.flow !== f || f.step !== 'scan') return; var ci = document.getElementById('codeInput'); if (ci) f.code = ci.value; f.manual = true; f.err = 'No hay acceso a la cámara. Escribe el número de la tarjeta.'; renderV(); });
      var inp = document.getElementById('codeInput'); if (inp) { inp.addEventListener('input', function () { f.code = inp.value; }); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') act('f:code'); }); }
    } else { scanStop(); var inp2 = document.getElementById('codeInput'); if (inp2) { inp2.addEventListener('input', function () { f.code = inp2.value; }); inp2.addEventListener('keydown', function (e) { if (e.key === 'Enter') act('f:code'); }); } }
    if (f.step === 'fotos') {
      app.querySelectorAll('input[data-foto]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var file = inp.files && inp.files[0]; if (!file) return;
          var idx = Number(inp.getAttribute('data-foto')); f.subiendo = true; f.err = ''; renderV();
          comprimir(file, 1280).then(function (blob) { return uploadFoto(f.v.id + '/' + (idx + 1) + '-' + Date.now() + '.jpg', blob); })
            .then(function (url) { f.fotos[idx] = url; f.fotos = f.fotos.filter(Boolean); f.subiendo = false; return rpc('runner_fotos', { p_sess: V.sess.token, p_visita: f.v.id, p_fotos: f.fotos }); })
            .then(function () { renderV(); })
            .catch(function (e) { f.subiendo = false; f.err = 'No se pudo subir la foto. Intenta de nuevo.'; renderV(); });
        });
      });
    }
    if (f.step === 'datos') {
      var q = document.getElementById('q');
      if (q) { q.focus(); q.addEventListener('input', function () { V.q = q.value; clearTimeout(V.searchT); if (V.q.trim().length < 2) { V.res = []; renderResultados(); return; } V.searching = true; renderResultados(); V.searchT = setTimeout(buscar, 250); }); }
      var pl = document.getElementById('placa'); if (pl) pl.addEventListener('input', function () { f.placa = pl.value.toUpperCase(); var b = app.querySelector('[data-a="f:datosOk"]'); if (b) b.disabled = !(f.modelo && f.placa.trim() && f.nivel !== 'X'); });
    }
    if (f.step === 'ubicar') {
      var sp = document.getElementById('selPlaza'), sn = document.getElementById('selNivel');
      var upd = function () { f.plaza = Number(sp.value); f.niv = sn.value; document.getElementById('spotTxt').textContent = pad2(f.plaza) + '-' + f.niv; };
      sp.addEventListener('change', upd); sn.addEventListener('change', upd); upd();
    }
  }
  function renderResultados() { var f = V.flow; if (f && f.step === 'datos') { var cur = document.getElementById('q'), pos = cur ? cur.selectionStart : null; renderV(); var n = document.getElementById('q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } } }
  function buscar() { var q = V.q; rpc('buscar_modelo', { p_q: q }).then(function (r) { if (V.q !== q) return; V.res = r || []; V.searching = false; renderResultados(); }).catch(function () { V.searching = false; renderResultados(); }); }
  function recibirCodigo(code) {
    var f = V.flow; f.err = '';
    rpc('runner_recibir', { p_sess: V.sess.token, p_codigo: code }).then(function (r) {
      if (!r.ok) {
        if (r.error === 'TARJETA_EN_USO') {
          // ¿es la tarjeta de un carro que ya está aquí? abrir esa visita
          return rpc('runner_visita', { p_sess: V.sess.token, p_visita: r.visita }).then(function (x) {
            if (x.ok && x.visita && x.visita.estado !== 'entregado') { V.flow = null; abrirVisita(x.visita); }
            else { f.err = 'Esta tarjeta ya está en uso.'; f.manual = true; renderV(); }
          });
        }
        f.err = r.error === 'TARJETA_NO_EXISTE' ? 'Esa tarjeta no existe.' : 'No se pudo activar la tarjeta.'; f.manual = true; renderV(); return;
      }
      f.v = r.visita; f.step = 'fotos'; f.contrato = r.contrato || null; if (r.visita.placa) f.placa = r.visita.placa;
      if (r.aviso === 'CONTRATO_SUSPENDIDO') toast('Contrato SUSPENDIDO · cobrar tarifa normal', true);
      else if (r.contrato) toast('Contrato: ' + r.contrato.nombre + ' · sin cargo');
      renderV();
    }).catch(function () { f.err = 'Sin conexión.'; f.manual = true; renderV(); });
  }
  function abrirVisita(v) {
    // carro ya recibido: si falta ubicación seguir el flujo; si está en cola, ir a entrega
    if (v.estado === 'recibido') startRec(v);
    else if (v.estado === 'solicitado' || v.estado === 'en_camino' || v.estado === 'en_puerta') { V.entrega = { v: v, step: 'info', code: '', err: '' }; renderV(); }
    else { toast('Tarjeta ' + v.tarjeta + ' · ' + carro(v) + ' · ' + ubic(v)); }
  }

  /* ----- entrega ----- */
  function renderEntrega() {
    var e = V.entrega, v = e.v, h = header('Entregar carro', '<button class="avatar" data-a="e:cerrar">Cerrar</button>');
    var pagado = v.pago_estado === 'pagado';
    h += '<div class="screen"><div class="row-between"><h1 class="sm">Tarjeta ' + esc(v.tarjeta) + '</h1><span class="pill blue">' + esc(ubic(v)) + '</span></div>'
      + '<div class="card sm"><div class="row-between"><div><div style="font-size:16px;font-weight:800">' + esc(carro(v)) + '</div><div style="font-size:13px;color:var(--muted)">' + esc(estadoNombre[v.estado] || v.estado) + (v.solicitado_en ? ' · pedido ' + hora(v.solicitado_en) : '') + '</div></div>' + (v.placa ? '<span class="plate">' + esc(v.placa) + '</span>' : '') + '</div></div>';
    if (v.tipo === 'mensual' && pagado && !(Number(v.total) > 0)) h += '<div class="paybox ok">' + I.check('#fff', 18) + '<div class="txt"><b>Contrato</b><span>Sin cargo</span></div></div>';
    else if (v.comercio_id && pagado && !(Number(v.total) > 0)) h += '<div class="paybox ok">' + I.check('#fff', 18) + '<div class="txt"><b>Cortesía · ' + esc(v.comercio || 'comercio aliado') + '</b><span>Sin cargo al cliente</span></div></div>';
    else if (pagado) h += '<div class="paybox ok">' + I.check('#fff', 18) + '<div class="txt"><b>Pagado · ' + esc(metodoNombre[v.pago_metodo] || '') + '</b><span>' + money(v.total) + (v.propina > 0 ? ' · incluye propina ' + money(v.propina) : '') + '</span></div></div>';
    else if (v.pago_metodo === 'efectivo') h += '<div class="paybox cash"><div class="txt"><b>Cobrar en efectivo</b><span>Total ' + money(v.total) + (v.propina > 0 ? ' (propina ' + money(v.propina) + ')' : '') + '</span></div><button class="mini" data-a="e:cobrar"' + (V.busy ? ' disabled' : '') + '>Recibí ' + money(v.total) + '</button></div>';
    else h += '<div class="paybox pend"><div class="txt"><b>' + esc(metodoNombre[v.pago_metodo] || 'Pago') + ' por confirmar · ' + money(v.total) + '</b><span>El capitán lo confirma en el tablero al ver el comprobante.</span></div><button class="mini bad" data-a="e:efectivo">Cambiar a efectivo</button></div>';
    if (v.tarjeta_perdida) h += '<div class="note warn">Tarjeta reportada como perdida · cargo ' + money(v.extra) + ' incluido</div>';
    if (v.estado !== 'en_puerta') h += '<button class="btn2 md" data-a="e:puerta">Marcar “en la puerta”</button>';
    if (pagado) {
      if (v.tarjeta_perdida) h += '<div class="grow"></div><button class="btn" data-a="e:entregarSin"' + (V.busy ? ' disabled' : '') + '>Entregar sin tarjeta</button>';
      else {
        h += '<div class="field"><div class="label">Escanea o escribe la tarjeta que devuelve el cliente</div>' + (e.scan ? '<div class="viewfinder" style="max-height:34vh"><video id="vid2" playsinline muted></video><div class="frame"></div><div class="cap">BUSCANDO QR…</div></div>' : '<button class="scanbig" style="min-height:90px" data-a="e:scan">' + I.qr(26) + '<b>Escanear tarjeta</b></button>')
          + '<div class="row"><input class="input" id="codeBack" inputmode="numeric" pattern="[0-9]*" placeholder="Número de tarjeta" value="' + esc(e.code) + '"><button class="btn sm" style="height:50px" data-a="e:entregar">Entregar</button></div></div>';
      }
    } else h += '<div class="grow"></div><button class="btn off" disabled>Entregar · falta el pago</button>';
    if (e.err) h += '<div class="err">' + esc(e.err) + '</div>';
    h += '</div>';
    return h;
  }
  function afterRenderEntrega() {
    var e = V.entrega; if (!e) return;
    if (e.scan) { var vid = document.getElementById('vid2'); scanStart(vid, function (raw) { var c = parseCard(raw); if (c) { scanStop(); e.code = c; entregarCon(c); } }).catch(function () { e.scan = false; e.err = 'Sin acceso a la cámara; escribe el número.'; renderV(); }); }
    else scanStop();
    var inp = document.getElementById('codeBack'); if (inp) { inp.addEventListener('input', function () { e.code = inp.value; }); inp.addEventListener('keydown', function (k) { if (k.key === 'Enter') act('e:entregar'); }); }
  }
  function refreshEntrega() { var e = V.entrega; if (!e) return Promise.resolve(); return rpc('runner_visita', { p_sess: V.sess.token, p_visita: e.v.id }).then(function (r) { if (r.ok) { e.v = r.visita; if (e.v.estado === 'entregado') { V.entrega = null; toast('Carro entregado · tarjeta ' + r.visita.tarjeta + ' liberada'); valetLoad(); } } renderV(); }); }
  function entregarCon(code) {
    var e = V.entrega; e.err = ''; V.busy = true;
    rpc('runner_entregar', { p_sess: V.sess.token, p_visita: e.v.id, p_codigo_tarjeta: code || null }).then(function (r) {
      V.busy = false;
      if (!r.ok) { e.err = { PAGO_PENDIENTE: 'Falta confirmar el pago.', TARJETA_NO_COINCIDE: 'Esa no es la tarjeta de este carro.', YA_ENTREGADO: 'Este carro ya fue entregado.' }[r.error] || 'No se pudo entregar.'; return refreshEntrega(); }
      V.entrega = null; toast('Entregado · tarjeta ' + r.visita.tarjeta + ' lista para reusar'); valetLoad(); renderV();
    }).catch(function () { V.busy = false; e.err = 'Sin conexión.'; renderV(); });
  }

  /* ----- acciones del valet ----- */
  function act(a, v, el) {
    var f = V.flow, e = V.entrega;
    switch (a) {
      case 'v:key': if (V.pin.length < 6) { V.pin += v; V.pinErr = false; } renderV(); if (V.pin.length === 6) act('v:enter'); return;
      case 'v:del': V.pin = V.pin.slice(0, -1); V.pinErr = false; renderV(); return;
      case 'v:enter':
        if (V.pin.length < 4) return;
        if (A.active) { aliadoLogin(V.pin); return; }
        rpc('staff_login', { p_pin: V.pin }).then(function (r) {
          if (!r.ok) { V.pin = ''; V.pinErr = true; renderV(); return; }
          if (window.PE_onLogin) { window.PE_onLogin(r); return; }
          V.sess = { token: r.token, nombre: r.nombre, rol: r.rol, id: r.id }; Sess.set(V.sess); V.pin = ''; valetStart();
        }).catch(function () { toast('Sin conexión', true); });
        return;
      case 'v:logout': if (!confirm('¿Cerrar sesión?')) return; rpc('staff_logout', { p_sess: V.sess.token }).catch(function () {}); Sess.clear(); V.sess = null; V.data = null; clearInterval(V.timer); renderV(); return;
      case 'v:tab': V.tab = v; renderV(); return;
      case 'v:recibir': startRec(null); return;
      case 'v:cancelflow': scanStop(); V.flow = null; valetLoad(); renderV(); return;
      case 'v:continuar': { var vis = (V.data.pendientes || []).filter(function (x) { return x.id === v; })[0]; if (vis) startRec(vis); return; }
      case 'v:tomar': V.busy = true; rpc('runner_tomar', { p_sess: V.sess.token, p_visita: v }).then(function (r) { V.busy = false; if (!r.ok) toast('Otro runner ya lo tomó', true); valetLoad(); }); return;
      case 'v:puerta': rpc('runner_en_puerta', { p_sess: V.sess.token, p_visita: v }).then(valetLoad); return;
      case 'v:entregar': case 'v:ver': { var vv = (V.data.cola || []).filter(function (x) { return x.id === v; })[0]; if (vv) { V.entrega = { v: vv, step: 'info', code: '', err: '' }; renderV(); } return; }
      // flujo
      case 'f:code': { var inp = document.getElementById('codeInput'); var c = (inp && inp.value.trim()) || ''; if (!c) return; f.code = c; scanStop(); recibirCodigo(c); return; }
      case 'f:fotosOk': f.step = 'datos'; f.err = ''; renderV(); return;
      case 'f:pick': f.modelo = { nombre: v, peso_lb: Number(el.getAttribute('data-lb')) }; f.nivel = nivelLocal(f.modelo.peso_lb); f.categoria = null; renderV(); return;
      case 'f:cat': f.modelo = { nombre: V.q.trim(), peso_lb: { sedan: 2600, suv_mediano: 4000, suv_grande: 5300 }[v], cat: v }; f.categoria = v; f.nivel = nivelLocal(f.modelo.peso_lb); renderV(); return;
      case 'f:unpick': f.modelo = null; f.nivel = null; renderV(); setTimeout(function () { var q = document.getElementById('q'); if (q) q.focus(); }, 50); return;
      case 'f:color': f.color = v; renderV(); return;
      case 'f:datosOk':
        V.busy = true; f.err = ''; renderV();
        rpc('runner_datos', { p_sess: V.sess.token, p_visita: f.v.id, p_placa: f.placa.trim(), p_modelo: f.modelo.nombre, p_peso: f.categoria ? null : f.modelo.peso_lb, p_categoria: f.categoria || null, p_color: f.color || null })
          .then(function (r) { V.busy = false; if (!r.ok) { f.err = 'No se pudo guardar.'; renderV(); return; } f.v = r.visita; f.nivel = r.nivel; f.sug = r.plaza_sugerida; f.mensual = r.mensual; f.step = 'estacionar'; renderV(); })
          .catch(function () { V.busy = false; f.err = 'Sin conexión.'; renderV(); });
        return;
      case 'f:estacionado': f.step = 'ubicar'; f.plaza = f.sug; f.niv = f.nivel; renderV(); return;
      case 'f:ubicar':
        V.busy = true; f.err = ''; renderV();
        rpc('runner_ubicar', { p_sess: V.sess.token, p_visita: f.v.id, p_plaza: f.plaza, p_nivel: f.niv }).then(function (r) {
          V.busy = false; if (!r.ok) { f.err = r.error === 'PLAZA_OCUPADA' ? 'Esa plaza ya tiene un carro. Elige otra.' : 'No se pudo guardar.'; renderV(); return; }
          f.v = r.visita; f.step = 'listo'; renderV(); valetLoad();
        }).catch(function () { V.busy = false; f.err = 'Sin conexión.'; renderV(); });
        return;
      // entrega
      case 'e:cerrar': scanStop(); V.entrega = null; valetLoad(); renderV(); return;
      case 'e:scan': e.scan = true; e.err = ''; renderV(); return;
      case 'e:puerta': rpc('runner_en_puerta', { p_sess: V.sess.token, p_visita: e.v.id }).then(refreshEntrega); return;
      case 'e:cobrar': V.busy = true; renderV(); rpc('runner_cobrar_efectivo', { p_sess: V.sess.token, p_visita: e.v.id }).then(function (r) { V.busy = false; if (!r.ok) e.err = 'No se pudo registrar el cobro.'; return refreshEntrega(); }).catch(function () { V.busy = false; e.err = 'Sin conexión.'; renderV(); }); return;
      case 'e:efectivo': if (!confirm('¿Cambiar el pago a efectivo?')) return; rpc('ops_cambiar_metodo', { p_sess: V.sess.token, p_visita: e.v.id, p_metodo: 'efectivo' }).then(refreshEntrega); return;
      case 'e:entregar': { var code = (document.getElementById('codeBack') || {}).value || e.code; if (!String(code || '').trim()) { e.err = 'Escanea o escribe la tarjeta.'; renderV(); return; } entregarCon(String(code).trim()); return; }
      case 'e:entregarSin': entregarCon(null); return;
    }
  }
  function nivelLocal(lb) { if (!lb) return null; if (lb + 200 <= 3000) return 'C'; if (lb + 200 <= 4500) return 'B'; if (lb <= 6000) return 'A'; return 'X'; }

  /* =====================================================================
     COMERCIO ALIADO (restaurante que cubre el valet de sus clientes)
     ===================================================================== */
  var A = { active: false, sess: null, data: null, screen: 'home', code: '', err: '', res: null, busy: false, timer: null, manual: false };
  var ALI_ERR = { TARJETA_NO_EXISTE: 'Esa tarjeta no existe.', SIN_CARRO: 'Esta tarjeta no tiene un carro en el valet ahora mismo.', YA_VALIDADA: 'Esta tarjeta ya fue validada.', CONTRATO: 'Este cliente tiene contrato mensual; no necesita validación.', YA_PAGADA: 'El cliente ya pagó su valet.', COMERCIO_SUSPENDIDO: 'Tu cuenta está suspendida. Comunícate con ParkEasy.' };
  function aliadoStart() {
    A.active = true; A.sess = ASess.get(); A.screen = 'home'; A.res = null; A.err = '';
    V.pin = ''; V.pinErr = false;
    renderAl();
    if (A.sess) { aliadoLoad(); clearInterval(A.timer); A.timer = setInterval(function () { if (A.screen === 'home') aliadoLoad(); }, 15000); }
  }
  function aliadoLoad() {
    if (!A.sess) return Promise.resolve();
    return rpc('aliado_estado', { p_sess: A.sess.token }).then(function (d) { A.data = d; if (A.screen === 'home') renderAl(); }).catch(function () {});
  }
  function aliadoLogin(pin) {
    rpc('aliado_login', { p_pin: pin }).then(function (r) {
      if (!r.ok) { V.pin = ''; V.pinErr = true; renderAl(); return; }
      A.sess = { token: r.token, nombre: r.nombre, id: r.id }; ASess.set(A.sess); V.pin = ''; aliadoStart();
    }).catch(function () { toast('Sin conexión', true); });
  }
  function renderAl() {
    if (!A.sess) { app.innerHTML = '<div class="phone">' + pinScreen('Comercios aliados') + '</div>'; return; }
    var d = A.data, co = d && d.comercio, h = header(A.sess.nombre + ' · Aliado', '<button class="avatar" data-a="l:logout" title="Salir">Salir</button>');
    if (A.screen === 'home') {
      var saldo = co ? Number(co.saldo) : null, neg = saldo != null && saldo < 0;
      h += '<div class="screen" style="gap:12px">';
      h += '<div class="kpis"><div class="kpi dark"' + (neg ? ' style="background:var(--bad)"' : '') + '><div class="n" style="font-size:20px">' + (saldo == null ? '–' : money(saldo)) + '</div><div class="l">' + (neg ? 'Saldo · en negativo' : 'Saldo disponible') + '</div></div><div class="kpi"><div class="n">' + (d ? (d.hoy || []).length : '–') + '</div><div class="l">Validados hoy</div></div><div class="kpi"><div class="n">' + (d ? money(d.hoy_total) : '–') + '</div><div class="l">Cubierto hoy</div></div></div>';
      if (co && co.estado !== 'activo') h += '<div class="note warn">Cuenta ' + esc(co.estado) + ' · no se pueden validar tarjetas.</div>';
      else if (neg) h += '<div class="note warn">El excedente se cobra al cierre del mes junto con el prepago de ' + money(co.prepago) + '.</div>';
      h += '<button class="btn xl" data-a="l:scan"' + (co && co.estado !== 'activo' ? ' disabled' : '') + '>' + I.qr(26) + 'Validar tarjeta de un cliente</button>';
      h += '<div class="label">Hoy</div>';
      if (!d) h += '<div class="empty"><div class="spin" style="margin:0 auto 10px"></div>Cargando…</div>';
      else if (!(d.hoy || []).length) h += '<div class="empty">Aún no has validado tarjetas hoy.<br>Escanea el QR de la tarjeta del cliente para cubrir su valet.</div>';
      else (d.hoy || []).forEach(function (x) { h += '<div class="req"><div class="info"><div class="row-between"><span class="code">Tarjeta ' + esc(x.tarjeta) + '</span><span class="timer">' + esc(hora(x.hora)) + '</span></div><div class="sub">' + esc([x.modelo, x.placa].filter(Boolean).join(' · ') || 'Vehículo') + ' · ' + esc(estadoNombre[x.estado] || x.estado) + '</div></div><b style="font-size:16px">' + money(x.monto) + '</b></div>'; });
      if (d) h += '<div class="small">Este mes: ' + d.mes_carros + ' carro' + (d.mes_carros === 1 ? '' : 's') + ' · ' + money(d.mes_total) + '</div>';
      h += '</div>';
    } else if (A.screen === 'scan') {
      h += '<div class="screen"><button class="back" data-a="l:home">' + I.back + 'Volver</button><h1 class="sm">Escanea la tarjeta</h1><p>Apunta al QR de la tarjeta de ParkEasy que tiene el cliente.</p>'
        + (A.manual ? '' : '<div class="viewfinder"><video id="vidA" playsinline muted></video><div class="frame"></div><div class="cap">BUSCANDO QR…</div></div>')
        + (A.err ? '<div class="err">' + esc(A.err) + '</div>' : '')
        + '<div class="field"><div class="label">O escribe el número de la tarjeta</div><div class="row"><input class="input" id="codeAli" inputmode="numeric" pattern="[0-9]*" placeholder="Ej. 1042" value="' + esc(A.code) + '"><button class="btn sm" style="height:50px" data-a="l:code"' + (A.busy ? ' disabled' : '') + '>Buscar</button></div></div><div class="grow"></div></div>';
    } else if (A.screen === 'confirm') {
      var r = A.res, v = r.visita, c = r.cotizacion || {};
      h += '<div class="screen"><button class="back" data-a="l:scan">' + I.back + 'Volver</button><div class="row-between"><h1 class="sm">Cubrir el valet</h1><span class="pill">TARJETA ' + esc(r.tarjeta) + '</span></div>'
        + '<div class="card"><div class="row-between"><div><div style="font-size:17px;font-weight:800">' + esc(carro(v)) + '</div><div style="font-size:13px;color:var(--muted);margin-top:4px">Llegó ' + esc(hora(v.recibido_en)) + ' · ' + Math.floor((c.minutos || 0) / 60) + ' h ' + pad2((c.minutos || 0) % 60) + ' min</div></div>' + (v.placa ? '<span class="plate">' + esc(v.placa) + '</span>' : '') + '</div></div>'
        + '<div class="card sm" style="gap:8px"><div class="kv" style="font-size:18px"><b style="font-weight:800">Cubres</b><b style="font-weight:800">' + money(r.monto) + '</b></div><div class="kv"><span class="k">Saldo después</span><b' + (Number(r.saldo_despues) < 0 ? ' style="color:var(--bad)"' : '') + '>' + money(r.saldo_despues) + '</b></div></div>'
        + '<div class="small" style="text-align:left">Cubres la tarifa vigente en este momento' + (c.sube_en ? ' (sube a ' + money(c.sube_a) + ' a las ' + esc(hora(c.sube_en)) + ')' : '') + '. Si el cliente se queda más tiempo, él paga la diferencia.</div>'
        + (A.err ? '<div class="err">' + esc(A.err) + '</div>' : '') + '<div class="grow"></div><button class="btn" data-a="l:validar"' + (A.busy ? ' disabled' : '') + '>Validar · ' + money(r.monto) + '</button></div>';
    } else if (A.screen === 'done') {
      var rr = A.res;
      h += '<div class="screen" style="gap:18px"><div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:30px"><div class="big-check">' + I.check('#fff', 42) + '</div><h1 style="text-align:center">Validada · ' + money(rr.monto) + '</h1><p style="text-align:center">Tarjeta ' + esc(rr.tarjeta) + ' · ' + esc(carro(rr.visita)) + '<br>El cliente ya puede pedir su carro sin pagar.</p></div>'
        + '<div class="kv" style="justify-content:center;gap:8px"><span class="k">Saldo</span><b' + (Number(rr.saldo) < 0 ? ' style="color:var(--bad)"' : '') + '>' + money(rr.saldo) + '</b></div>'
        + '<div class="grow"></div><button class="btn" data-a="l:scan">Validar otra tarjeta</button><button class="btn2" data-a="l:home">Volver</button></div>';
    }
    app.innerHTML = '<div class="phone">' + h + '</div>';
    if (A.screen === 'scan') {
      if (!A.manual) {
        var vid = document.getElementById('vidA');
        scanStart(vid, function (raw) { var code = parseCard(raw); if (code) { scanStop(); aliadoConsultar(code); } })
          .catch(function () { if (!A.active || A.screen !== 'scan') return; var ci = document.getElementById('codeAli'); if (ci) A.code = ci.value; A.manual = true; A.err = 'No hay acceso a la cámara. Escribe el número de la tarjeta.'; renderAl(); });
      }
      var inp = document.getElementById('codeAli'); if (inp) { inp.addEventListener('input', function () { A.code = inp.value; }); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') actA('l:code'); }); }
    } else scanStop();
  }
  function aliadoConsultar(code) {
    A.busy = true; A.err = ''; A.code = code; renderAl();
    rpc('aliado_consultar', { p_sess: A.sess.token, p_codigo: code }).then(function (r) {
      A.busy = false;
      if (!r.ok) { A.err = (ALI_ERR[r.error] || 'No se pudo consultar la tarjeta.') + (r.error === 'YA_VALIDADA' && r.comercio ? ' (' + r.comercio + ')' : ''); A.manual = true; renderAl(); return; }
      A.res = r; A.screen = 'confirm'; renderAl();
    }).catch(function () { A.busy = false; A.err = 'Sin conexión.'; A.manual = true; renderAl(); });
  }
  function actA(a) {
    switch (a) {
      case 'l:logout': if (!confirm('¿Cerrar sesión?')) return; rpc('aliado_logout', { p_sess: A.sess.token }).catch(function () {}); ASess.clear(); A.sess = null; A.data = null; clearInterval(A.timer); renderAl(); return;
      case 'l:home': scanStop(); A.screen = 'home'; A.err = ''; A.res = null; renderAl(); aliadoLoad(); return;
      case 'l:scan': A.screen = 'scan'; A.err = ''; A.code = ''; A.manual = false; A.res = null; renderAl(); return;
      case 'l:code': { var inp = document.getElementById('codeAli'); var c = (inp && inp.value.trim()) || ''; if (!c) return; scanStop(); aliadoConsultar(c); return; }
      case 'l:validar':
        if (A.busy) return; A.busy = true; A.err = ''; renderAl();
        rpc('aliado_validar', { p_sess: A.sess.token, p_codigo: A.res.tarjeta }).then(function (r) {
          A.busy = false;
          if (!r.ok) { A.err = ALI_ERR[r.error] || 'No se pudo validar.'; renderAl(); return; }
          A.res = r; A.screen = 'done'; renderAl(); aliadoLoad();
        }).catch(function () { A.busy = false; A.err = 'Sin conexión.'; renderAl(); });
        return;
    }
  }

  /* =====================================================================
     ROUTER
     ===================================================================== */
  function landing() {
    app.innerHTML = '<div class="phone">' + header('Sistema de valet') + '<div class="screen"><h1>ParkEasy</h1><p>Elige tu acceso.</p><div class="list">'
      + '<a class="btn" href="#/valet" style="text-decoration:none">App del valet</a>'
      + '<a class="btn2" href="#/tablero" style="text-decoration:none">Tablero del capitán</a>'
      + '<a class="btn2" href="#/admin" style="text-decoration:none">Administración</a>'
      + '<a class="btn2" href="#/aliado" style="text-decoration:none">Comercios aliados</a></div>'
      + '<div class="grow"></div><div class="small">Los clientes entran escaneando el QR de su tarjeta.</div><a class="tlink" href="#/terminos">Términos y condiciones</a></div></div>';
  }
  function terminosHtml() {
    return '<div class="terms"><div class="small" style="text-align:left">Última actualización: ' + esc(window.PE_TERMINOS_FECHA || '') + '</div>' + (window.PE_TERMINOS_HTML || '<p>No se pudieron cargar los términos.</p>') + '</div>';
  }
  function terminosPage() {
    document.body.className = '';
    app.innerHTML = '<div class="phone">' + header('Términos y condiciones') + '<div class="screen"><h1>Términos y condiciones del servicio</h1>' + terminosHtml() + '</div></div>';
    window.scrollTo(0, 0);
  }
  window.PE.terminosHtml = terminosHtml;
  function route() {
    scanStop(); clearInterval(C.timer); clearInterval(V.timer); clearInterval(V.tick); clearInterval(A.timer); A.active = false;
    if (window.PE_deskStop) window.PE_deskStop();
    var hsh = location.hash || '';
    if (/^#\/terminos/.test(hsh)) { terminosPage(); return; }
    var m = hsh.match(/^#\/t\/([A-Za-z0-9]+)/) || (location.search.match(/[?&]t=([A-Za-z0-9]+)/));
    if (m) { document.body.className = ''; clienteStart(m[1]); return; }
    if (/^#\/aliado/.test(hsh)) { document.body.className = ''; window.PE_onLogin = null; aliadoStart(); return; }
    if (/^#\/valet/.test(hsh)) { document.body.className = ''; V._title = null; window.PE_onLogin = null; valetStart(); return; }
    if (/^#\/(tablero|admin)/.test(hsh)) { if (window.PE_desk) { window.PE_desk(hsh.indexOf('admin') > 0 ? 'admin' : 'tablero', pinScreenFor); } else app.innerHTML = '<div class="boot">Cargando…</div>'; return; }
    landing();
  }
  function pinScreenFor(title) { V._title = title; V.pin = ''; V.pinErr = false; app.innerHTML = '<div class="phone">' + pinScreen(title) + '</div>'; }
  window.PE.pinScreen = pinScreenFor;

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-a]'); if (!el || el.disabled) return;
    if (el.classList.contains('overlay') && ev.target !== el) return; // clic dentro de la hoja, no en el fondo
    var a = el.getAttribute('data-a'), v = el.getAttribute('data-v');
    if (a.charAt(0) === 'c' && a.charAt(1) === ':') { ev.preventDefault(); actC(a, v); }
    else if (/^l:/.test(a)) { ev.preventDefault(); actA(a); }
    else if (/^[vfe]:/.test(a)) { ev.preventDefault(); act(a, v, el); }
    else if (window.PE_deskAct) { ev.preventDefault(); window.PE_deskAct(a, v, el); }
  });
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (C.token) clienteLoad(); if (V.sess && !A.active) valetLoad(); if (A.active && A.sess) aliadoLoad(); } });
  setTimeout(route, 0);
})();
