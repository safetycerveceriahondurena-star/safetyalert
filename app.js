'use strict';
/* SafetyAlert - aplicación (sin dependencias, sin compilar) */
(function () {
  const CFG = globalThis.SA_CONFIG;
  const FB = 'https://www.gstatic.com/firebasejs/10.14.1';
  const SUBTIPOS = ['Incendio', 'Fuga de amoníaco', 'Fuga de CO₂', 'Derrame químico', 'Sismo', 'Lesionado / accidente', 'Evacuación general', 'Otro'];
  const ROL_TXT = { Brigadista: 'Brigadista', Supervisor: 'Supervisor', SeguridadIndustrial: 'Seguridad Industrial', Admin: 'Administrador', Gerente: 'Gerente', Coordinador: 'Coordinador' };
  const PROB_TXT = { Incompleto: 'Incompleto', ConProblema: 'Con problema', NoDisponible: 'No disponible' };
  const EST_CLASE = { Operativo: 'verde', Incompleto: 'amar', ConProblema: 'rojo', NoDisponible: 'rojo' };

  // ---------- utilidades ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } }
  };
  const fh = (d) => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const fd = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const plataforma = () => (/iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : 'Web');
  let toastT;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500); }

  // ---------- estado ----------
  const S = {
    token: ls.get('sa_token'), perfil: null, cat: null, view: 'inicio', params: {}, stack: [], rt: 0,
    alertas: [], descartadas: new Set(), overlayId: null, firma: '', equipos: null, fEq: { f: 'todos', q: '' },
    pushListo: false, alertaUrl: new URLSearchParams(location.search).get('alerta')
  };
  const rol = () => (S.perfil ? S.perfil.rol : '');
  const esGestion = () => ['SeguridadIndustrial', 'Admin'].includes(rol());
  const esSup = () => ['Supervisor', 'SeguridadIndustrial', 'Admin'].includes(rol());

  // ---------- API ----------
  async function api(accion, datos) {
    if (!CFG || /PEGA_AQUI/.test(CFG.API_URL)) throw new Error('La app aún no está configurada (falta la URL en config.js).');
    let r;
    try {
      r = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ accion, token: S.token, datos: datos || {} }) });
    } catch (e) { throw new Error('Sin conexión con el servidor. Revisa tu internet.'); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Respuesta inválida del servidor.'); }
    if (!j.ok) {
      if (j.codigo === 401 && accion !== 'login') { cerrarLocal(); S.mensajeLogin = j.error; render(); }
      throw new Error(j.error || 'Error');
    }
    return j.datos;
  }

  function cerrarLocal() {
    S.token = null; S.perfil = null; ls.del('sa_token'); credGuardar(null); Sirena.stop(); cerrarOverlay();
  }

  // ---------- almacenamiento para el service worker (botones de la notificación) ----------
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open('sa-db', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function credGuardar(v) {
    try { const db = await idb(); const st = db.transaction('kv', 'readwrite').objectStore('kv'); if (v) st.put(v, 'cred'); else st.delete('cred'); } catch (e) { /* opcional */ }
  }

  // ---------- sirena ----------
  const Sirena = {
    ctx: null, osc: null, t1: null, t2: null, lock: null,
    init() {
      try {
        if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) this.ctx = new C(); }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* sin audio */ }
    },
    start(tipo) {
      this.stop(); this.init();
      if (this.ctx) {
        try {
          const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
          o.type = 'square'; g.gain.value = tipo === 'Simulacro' ? 0.4 : 0.9;
          o.connect(g); g.connect(this.ctx.destination); o.start(); this.osc = o;
          let alto = false;
          const tick = () => { if (!this.osc) return; o.frequency.setValueAtTime(alto ? 1000 : 650, this.ctx.currentTime); alto = !alto; };
          tick(); this.t1 = setInterval(tick, 600);
        } catch (e) { /* sin audio */ }
      }
      const vib = () => { if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]); };
      vib(); this.t2 = setInterval(vib, 3000);
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => { this.lock = l; }).catch(() => {}); } catch (e) { /* opcional */ }
    },
    silenciar() { try { if (this.osc) this.osc.stop(); } catch (e) { /* ya parada */ } this.osc = null; clearInterval(this.t1); },
    stop() {
      this.silenciar(); clearInterval(this.t2);
      if (navigator.vibrate) navigator.vibrate(0);
      try { if (this.lock) this.lock.release(); } catch (e) { /* opcional */ } this.lock = null;
    }
  };
  document.addEventListener('pointerdown', () => Sirena.init(), { passive: true });

  // ---------- pantalla completa de alerta ----------
  function mostrarAlerta(a) {
    if (S.overlayId === a.id) return;
    S.overlayId = a.id;
    const sim = a.tipo === 'Simulacro';
    const o = $('#overlay');
    o.className = 'overlay ' + (sim ? 'sim' : 'emer');
    o.innerHTML = `
      <div class="tag">${sim ? 'SIMULACRO' : '¡EMERGENCIA!'}</div>
      <h2>${esc(a.subtipo || a.titulo)}</h2>
      ${a.ubicacion ? `<div class="ubic">📍 ${esc(a.ubicacion)}</div>` : ''}
      ${a.mensaje ? `<div class="msg">${esc(a.mensaje)}</div>` : ''}
      <div class="quien">Avisó: ${esc(a.creadaPorNombre || '—')} · ${esc(fh(a.fecha))}</div>
      <div class="acciones">
        <button class="btn si" data-act="responder" data-id="${esc(a.id)}" data-r="Asiste">✅ ASISTO A LA ${sim ? 'ACTIVIDAD' : 'EMERGENCIA'}</button>
        <button class="btn no" data-act="responder" data-id="${esc(a.id)}" data-r="FueraDePlanta">🚫 ESTOY FUERA DE PLANTA</button>
        <div class="row" style="justify-content:center">
          <button class="link" data-act="silenciar">🔇 Silenciar sirena</button>
          <button class="link" data-act="descartar" data-id="${esc(a.id)}">Responder después</button>
        </div>
      </div>`;
    o.hidden = false;
    Sirena.start(a.tipo);
  }
  function cerrarOverlay() { const o = $('#overlay'); o.hidden = true; o.innerHTML = ''; S.overlayId = null; Sirena.stop(); }

  // ---------- chequeo de alertas ----------
  async function chequear() {
    if (!S.token || !S.perfil || S.perfil.debeCambiarClave) return null;
    const p = await api('pulso');
    S.alertas = p.alertas;
    const pend = p.alertas.find((a) => !a.miRespuesta && !S.descartadas.has(a.id));
    if (pend) mostrarAlerta(pend);
    else if (S.overlayId && !p.alertas.some((a) => a.id === S.overlayId && !a.miRespuesta)) cerrarOverlay();
    if (S.alertaUrl) {
      const id = S.alertaUrl; S.alertaUrl = null;
      history.replaceState(null, '', location.pathname);
      if (!p.alertas.some((a) => a.id === id)) toast('Esa alerta ya no está activa');
    }
    const firma = p.alertas.map((a) => a.id + a.miRespuesta).join('|');
    if (firma !== S.firma) { S.firma = firma; if (S.view === 'inicio') render(); }
    return p;
  }
  setInterval(() => { if (document.visibilityState === 'visible') chequear().catch(() => {}); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') chequear().catch(() => {}); });

  // ---------- notificaciones push ----------
  async function registrarPush() {
    if (S.pushListo || !('serviceWorker' in navigator) || !('Notification' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const { initializeApp } = await import(FB + '/firebase-app.js');
    const { getMessaging, getToken, onMessage } = await import(FB + '/firebase-messaging.js');
    const m = getMessaging(initializeApp(CFG.firebase));
    const tok = await getToken(m, { vapidKey: CFG.vapidKey, serviceWorkerRegistration: reg });
    if (!tok) throw new Error('No se pudo obtener el permiso de notificaciones');
    await api('registrarToken', { tokenFcm: tok, plataforma: plataforma() });
    onMessage(m, () => { chequear().catch(() => {}); });
    S.pushListo = true;
  }
  async function activarPush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { toast('Este navegador no permite notificaciones. En iPhone instala la app primero.'); return; }
    Sirena.init();
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Permiso de notificaciones denegado'); render(); return; }
    try { await registrarPush(); toast('Notificaciones activadas ✔'); } catch (e) { toast('No se pudo activar: ' + e.message); }
    render();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.tipo === 'abrirAlerta') chequear().catch(() => {}); });
  }

  // ---------- catálogos (cliente) ----------
  const idx = (arr) => { const m = {}; (arr || []).forEach((x) => { m[x.id] = x; }); return m; };
  function rutaArea(id) {
    const c = S.cat; const a = idx(c.areas)[id]; if (!a) return '';
    const d = idx(c.deptos)[a.deptoId]; const u = d && idx(c.unidades)[d.unidadId];
    return [u && u.nombre, d && d.nombre, a.nombre].filter(Boolean).join(' › ');
  }
  function rutaDepto(id) { const d = idx(S.cat.deptos)[id]; if (!d) return ''; const u = idx(S.cat.unidades)[d.unidadId]; return [u && u.nombre, d.nombre].filter(Boolean).join(' › '); }
  const opts = (arr, val, lab, sel, vacio) => (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') + arr.map((x) => `<option value="${esc(val(x))}"${String(val(x)) === String(sel) ? ' selected' : ''}>${esc(lab(x))}</option>`).join('');
  const activos = (arr) => (arr || []).filter((x) => x.activo !== false);
  const optsAreas = (sel) => opts(activos(S.cat.areas), (a) => a.id, (a) => rutaArea(a.id), sel, '— Sin especificar —');
  const optsSubareas = (areaId, sel) => opts(activos(S.cat.subareas).filter((s) => s.areaId === areaId), (s) => s.id, (s) => s.nombre, sel, '— Toda el área —');
  function rutaSub(id) { const s = idx(S.cat.subareas)[id]; if (!s) return ''; const r = rutaArea(s.areaId); return r ? r + ' › ' + s.nombre : s.nombre; }
  async function cargarCat() { S.cat = await api('catalogos'); }

  // ---------- navegación ----------
  function go(view, params, reemplazar) {
    if (!reemplazar) S.stack.push({ view: S.view, params: S.params });
    S.view = view; S.params = params || {}; window.scrollTo(0, 0); render();
  }
  function tab(view) { S.stack = []; S.view = view; S.params = {}; window.scrollTo(0, 0); render(); }
  function atras() { const p = S.stack.pop(); if (p) { S.view = p.view; S.params = p.params; } else { S.view = 'inicio'; S.params = {}; } render(); }
  const RAICES = ['inicio', 'alertas', 'equipos', 'gestion', 'perfil'];

  function tabsDe() {
    const t = [{ id: 'inicio', ic: '🏠', n: 'Inicio' }, { id: 'alertas', ic: '🔔', n: 'Alertas' }, { id: 'equipos', ic: '🧯', n: 'Equipos' }];
    if (esSup()) t.push({ id: 'gestion', ic: '⚙️', n: 'Gestión' });
    t.push({ id: 'perfil', ic: '👤', n: 'Perfil' });
    return t;
  }
  function shell(titulo, main, conBack) {
    const raiz = RAICES.includes(S.view);
    const pill = S.perfil ? `<span class="pill">${S.perfil.disponiblePlanta ? '🟢 En planta' : '⚪ Fuera'}</span>` : '';
    return `<div class="top">${conBack && !raiz ? '<button class="back" data-act="atras" aria-label="Atrás">‹</button>' : ''}<h1>${esc(titulo)}</h1>${pill}</div>
      <main id="main">${main}</main>
      <nav class="nav">${tabsDe().map((t) => `<button data-act="tab" data-v="${t.id}" class="${(S.view === t.id || S.padre === t.id) ? 'on' : ''}"><span class="ic">${t.ic}</span>${t.n}</button>`).join('')}</nav>`;
  }

  async function render() {
    const mi = ++S.rt;
    const app = $('#app');
    if (!S.token || !S.perfil) { app.innerHTML = loginHtml(); return; }
    if (S.perfil.debeCambiarClave) { app.innerHTML = `<div class="top"><h1>Cambia tu contraseña</h1></div><main>${claveForm(true)}</main>`; return; }
    const v = VISTAS[S.view] || VISTAS.inicio;
    S.padre = RAICES.includes(S.view) ? S.view : v.padre;
    const titulo = typeof v.titulo === 'function' ? v.titulo(S.params) : v.titulo;
    app.innerHTML = shell(titulo, '<div class="vacio">Cargando…</div>', true);
    try {
      const html = await v.html(S.params);
      if (mi !== S.rt) return;
      app.innerHTML = shell(titulo, html, true);
      if (v.despues) v.despues(S.params);
    } catch (e) {
      if (mi !== S.rt) return;
      app.innerHTML = shell(titulo, `<div class="err">${esc(e.message)}</div><button class="btn gris full" style="margin-top:12px" data-act="reintentar">Reintentar</button>`, true);
    }
  }

  // ---------- vistas ----------
  function loginHtml() {
    const msg = S.mensajeLogin ? `<div class="err">${esc(S.mensajeLogin)}</div>` : '';
    const instalar = !standalone() && plataforma() === 'iOS'
      ? '<div class="info"><b>iPhone:</b> para recibir alertas toca <b>Compartir</b> (□↑) y luego <b>Añadir a pantalla de inicio</b>. Abre Safety Alert desde ese icono.</div>'
      : (!standalone() ? '<div class="info">Para mejor funcionamiento instala la app: menú del navegador (⋮) → <b>Instalar aplicación</b>.</div>' : '');
    return `<div class="login"><img class="logo" src="icons/icon-192.png" alt=""><h1>Safety Alert</h1><p class="muted">${esc(CFG.empresa || '')}</p>
      <form data-form="login"><label>Usuario</label><input name="usuario" autocapitalize="none" autocomplete="username" required>
      <label>Contraseña</label><input name="clave" type="password" autocomplete="current-password" required>
      <div id="msg">${msg}</div><button class="btn full" style="margin-top:16px">Entrar</button></form>${instalar}</div>`;
  }

  function claveForm(obligatorio) {
    return `<form data-form="clave" class="card">
      ${obligatorio ? '<div class="info">Por seguridad debes crear tu propia contraseña (mínimo 8 caracteres).</div>' : ''}
      <label>${obligatorio ? 'Contraseña temporal' : 'Contraseña actual'}</label><input name="actual" type="password" autocomplete="current-password" required>
      <label>Nueva contraseña</label><input name="nueva" type="password" autocomplete="new-password" minlength="8" required>
      <label>Repite la nueva contraseña</label><input name="repite" type="password" autocomplete="new-password" minlength="8" required>
      <div id="msg"></div><button class="btn full" style="margin-top:14px">Guardar contraseña</button>
      ${obligatorio ? '<button type="button" class="btn gris full" style="margin-top:10px" data-act="salir">Cancelar y salir</button>' : ''}</form>`;
  }

  const tarjetaAlerta = (a) => {
    const sim = a.tipo === 'Simulacro';
    return `<div class="card alert-card ${sim ? 'sim' : ''}">
      <div class="row"><span class="badge ${sim ? 'naranja' : 'rojo'}">${esc(a.tipo.toUpperCase())}</span><span class="muted small grow">${esc(fh(a.fecha))}</span></div>
      <h3 style="margin-top:8px">${esc(a.subtipo)}</h3>
      ${a.ubicacion ? `<div class="small">📍 ${esc(a.ubicacion)}</div>` : ''}${a.mensaje ? `<div>${esc(a.mensaje)}</div>` : ''}
      ${a.miRespuesta
        ? `<div class="row" style="margin-top:10px"><span class="badge ${a.miRespuesta === 'Asiste' ? 'verde' : ''}">Tu respuesta: ${a.miRespuesta === 'Asiste' ? 'Asisto' : 'Fuera de planta'}</span><button class="btn chico gris" data-act="verAlerta" data-id="${esc(a.id)}">Ver detalle</button></div>`
        : `<div class="row" style="margin-top:10px"><button class="btn verde grow" data-act="responder" data-id="${esc(a.id)}" data-r="Asiste">✅ Asisto</button><button class="btn gris grow" data-act="responder" data-id="${esc(a.id)}" data-r="FueraDePlanta">🚫 Fuera de planta</button></div>`}
    </div>`;
  };

  const VISTAS = {
    inicio: {
      titulo: 'Safety Alert : Cerveceria Hodnureña',
      async html() {
        const [p, rep] = await Promise.all([chequear(), esGestion() ? api('reportesLista', { estado: 'Abierto' }) : null]);
        const alertas = p ? p.alertas : S.alertas;
        const noti = ('Notification' in window) ? Notification.permission : 'unsupported';
        let h = `<div class="card"><div class="switch"><div><h3>Hola, ${esc(S.perfil.nombre)}</h3><div class="muted small">${esc(ROL_TXT[rol()])}</div></div>
          <label class="tog" style="margin:0"><input type="checkbox" data-chg="disp" ${S.perfil.disponiblePlanta ? 'checked' : ''}><i></i></label></div>
          <div class="muted small" style="margin-top:6px">${S.perfil.disponiblePlanta ? '🟢 Estás marcado como DISPONIBLE EN PLANTA' : '⚪ Estás marcado como FUERA DE PLANTA'}</div></div>`;
        if (noti !== 'granted') {
          h += (plataforma() === 'iOS' && !standalone())
            ? '<div class="info">⚠️ En iPhone debes instalar la app (Compartir → Añadir a pantalla de inicio) para recibir alertas con la app cerrada.</div>'
            : `<div class="info">🔔 Activa las notificaciones para recibir alertas aunque la app esté cerrada.<br><button class="btn chico" style="margin-top:8px" data-act="push">Activar notificaciones</button></div>`;
        } else if (!S.pushListo) { registrarPush().catch(() => {}); }
        h += `<div class="big2"><button class="btn" data-act="crear" data-t="Emergencia"><span>🚨</span>EMERGENCIA</button><button class="btn naranja" data-act="crear" data-t="Simulacro"><span>📣</span>SIMULACRO</button></div>`;
        h += `<h3 style="margin:18px 0 8px">Alertas activas</h3>` + (alertas.length ? alertas.map(tarjetaAlerta).join('') : '<div class="vacio card">✅ No hay alertas activas</div>');
        if (rep && rep.reportes.length) h += `<div class="card" data-act="irReportes" style="cursor:pointer"><div class="row"><span style="font-size:26px">🧯</span><div class="grow"><h3>${rep.reportes.length} reporte(s) de equipos abiertos</h3><div class="muted small">Toca para revisarlos</div></div>›</div></div>`;
        return h;
      }
    },

    crear: {
      titulo: (p) => (p.tipo === 'Simulacro' ? 'Crear simulacro' : 'Crear emergencia'), padre: 'inicio',
      async html(p) {
        if (!S.cat) await cargarCat();
        const sim = p.tipo === 'Simulacro';
        return `<form data-form="crear" class="card"><input type="hidden" name="tipo" value="${esc(p.tipo)}">
          <div class="${sim ? 'info' : 'err'}" style="margin-top:0">${sim ? 'Se enviará un SIMULACRO a todo el personal.' : '⚠️ Se enviará una EMERGENCIA REAL a todo el personal. Úsala solo si es real.'}</div>
          <label>Tipo de evento</label><select name="subtipo">${opts(SUBTIPOS, (x) => x, (x) => x)}</select>
          <label>Área</label><select name="areaId" id="f-area">${optsAreas('')}</select>
          <label>Subárea</label><select name="subareaId" id="f-sub">${optsSubareas('', '')}</select>
          <label>Mensaje / indicaciones (opcional)</label><textarea name="mensaje" maxlength="500" placeholder="Ej.: Humo en bodega, evacuar por puerta 3"></textarea>
          <div id="msg"></div>
          <button class="btn full ${sim ? 'naranja' : ''}" style="margin-top:14px">${sim ? '📣 Enviar simulacro' : '🚨 Enviar emergencia'}</button></form>`;
      }
    },

    alertas: {
      titulo: 'Alertas',
      async html() {
        const d = await api('alertasLista');
        if (!d.alertas.length) return '<div class="vacio card">Aún no hay alertas registradas</div>';
        return d.alertas.map((a) => `<div class="card" data-act="verAlerta" data-id="${esc(a.id)}" style="cursor:pointer">
          <div class="row wrap"><span class="badge ${a.tipo === 'Simulacro' ? 'naranja' : 'rojo'}">${esc(a.tipo)}</span><span class="badge ${a.estado === 'Activa' ? 'verde' : ''}">${esc(a.estado)}</span><span class="muted small grow" style="text-align:right">${esc(fh(a.fecha))}</span></div>
          <h3 style="margin-top:6px">${esc(a.subtipo)}</h3><div class="muted small">${esc(a.ubicacion || 'Sin ubicación')} · por ${esc(a.creadaPorNombre)}</div></div>`).join('');
      }
    },

    alertaDetalle: {
      titulo: 'Detalle de alerta', padre: 'alertas',
      async html(p) {
        const d = await api('alertaDetalle', { id: p.id });
        const a = d.alerta, r = d.resumen, tot = Math.max(r.total, 1);
        const mia = (S.alertas.find((x) => x.id === a.id) || {}).miRespuesta;
        let h = `<div class="card"><div class="row wrap"><span class="badge ${a.tipo === 'Simulacro' ? 'naranja' : 'rojo'}">${esc(a.tipo)}</span><span class="badge ${a.estado === 'Activa' ? 'verde' : ''}">${esc(a.estado)}</span></div>
          <h3 style="margin-top:8px">${esc(a.subtipo)}</h3>${a.ubicacion ? `<div>📍 ${esc(a.ubicacion)}</div>` : ''}${a.mensaje ? `<div>${esc(a.mensaje)}</div>` : ''}
          <div class="muted small" style="margin-top:6px">Creada por ${esc(a.creadaPorNombre)} · ${esc(fh(a.fecha))}${a.cerradaEn ? ' · Cerrada ' + esc(fh(a.cerradaEn)) : ''}</div></div>
          <div class="card"><h3>Respuestas</h3>
          <div class="progreso"><i style="width:${(r.asisten / tot) * 100}%;background:var(--verde)"></i><i style="width:${(r.fuera / tot) * 100}%;background:#444"></i></div>
          <div class="row wrap small"><span class="badge verde">✅ Asisten: ${r.asisten}</span><span class="badge">🚫 Fuera: ${r.fuera}</span><span class="badge amar">⏳ Sin responder: ${r.pendientes}</span></div></div>`;
        if (a.estado === 'Activa' && !mia) h += `<div class="row" style="margin-bottom:12px"><button class="btn verde grow" data-act="responder" data-id="${esc(a.id)}" data-r="Asiste">✅ Asisto</button><button class="btn gris grow" data-act="responder" data-id="${esc(a.id)}" data-r="FueraDePlanta">🚫 Fuera de planta</button></div>`;
        if (d.respuestas) {
          const orden = { SinRespuesta: 0, FueraDePlanta: 1, Asiste: 2 };
          const txt = { SinRespuesta: '<span class="badge amar">Sin responder</span>', FueraDePlanta: '<span class="badge">Fuera de planta</span>', Asiste: '<span class="badge verde">Asiste</span>' };
          h += '<div class="card"><h3>Personal</h3>' + d.respuestas.sort((x, y) => orden[x.respuesta] - orden[y.respuesta] || x.nombre.localeCompare(y.nombre)).map((x) => `<div class="row" style="padding:8px 0;border-top:1px solid var(--borde)"><div class="grow"><b>${esc(x.nombre)}</b><div class="muted small">${esc(ROL_TXT[x.rol] || x.rol)}${x.fecha ? ' · ' + esc(fh(x.fecha)) : ''}${x.telefono ? ` · <a href="tel:${esc(x.telefono)}">${esc(x.telefono)}</a>` : ''}</div></div>${txt[x.respuesta]}</div>`).join('') + '</div>';
        }
        if (d.puedeCerrar) h += `<button class="btn sec full" data-act="cerrarAlerta" data-id="${esc(a.id)}">Cerrar alerta (fin de la emergencia)</button>`;
        return h;
      }
    },

    equipos: {
      titulo: 'Equipos de emergencia',
      async html() {
        if (!S.cat) await cargarCat();
        if (!S.equipos) S.equipos = (await api('equipos')).equipos;
        const filtros = [['todos', 'Todos'], ['prob', 'Con problemas'], ['venc', 'Por vencer']].concat(S.cat.tipos.map((t) => ['t:' + t.id, t.nombre]));
        return `${esGestion() ? '<button class="btn full" data-act="nuevoEquipo" style="margin-bottom:12px">＋ Nuevo equipo</button>' : ''}
          <input id="q" type="search" placeholder="Buscar por código o ubicación" value="${esc(S.fEq.q)}" style="margin-bottom:10px">
          <div class="chips">${filtros.map(([k, n]) => `<button data-act="filtroEq" data-k="${esc(k)}" class="${S.fEq.f === k ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>
          <div id="lista-eq">${listaEquipos()}</div>`;
      }
    },

    reporteForm: {
      titulo: 'Reportar equipo', padre: 'equipos',
      async html(p) {
        if (!S.equipos) S.equipos = (await api('equipos')).equipos;
        const e = S.equipos.find((x) => x.id === p.equipoId);
        if (!e) return '<div class="err">Equipo no encontrado</div>';
        return `<form data-form="reporte" class="card"><input type="hidden" name="equipoId" value="${esc(e.id)}">
          <h3>${esc(e.tipo)} · ${esc(e.codigo)}</h3><div class="muted small">${esc(e.ubicacion)}</div>
          <label>¿Qué pasa con el equipo?</label>
          <select name="problema"><option value="Incompleto">Está incompleto (le faltan cosas)</option><option value="ConProblema">Tiene un problema (dañado, vencido, sin sello...)</option><option value="NoDisponible">No está disponible (no está en su lugar)</option></select>
          ${e.contenido.length ? `<label>Marca lo que FALTA</label>${e.contenido.map((c) => `<label style="font-weight:400;display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" name="falta" value="${esc(c.item)}" style="width:22px;height:22px">${esc(c.item)} <span class="muted small">(${esc(c.cantidadEsperada)})</span></label>`).join('')}` : ''}
          <label>Detalle</label><textarea name="detalle" maxlength="500" placeholder="Describe brevemente el problema" required></textarea>
          <div id="msg"></div><button class="btn full" style="margin-top:14px">Enviar reporte</button></form>`;
      }
    },

    equipoForm: {
      titulo: (p) => (p.id ? 'Editar equipo' : 'Nuevo equipo'), padre: 'equipos',
      async html(p) {
        if (!S.cat) await cargarCat();
        if (!S.equipos) S.equipos = (await api('equipos')).equipos;
        const e = (p.id && S.equipos.find((x) => x.id === p.id)) || { estado: 'Operativo', activo: true, contenido: [] };
        const sub = idx(S.cat.subareas)[e.subareaId];
        const areaSel = sub ? sub.areaId : '';
        const contenido = (e.contenido || []).map((c) => c.item + ' | ' + c.cantidadEsperada).join('\n');
        return `<form data-form="equipo" class="card"><input type="hidden" name="id" value="${esc(e.id || '')}">
          <label>Tipo de equipo</label><select name="tipoId" required>${opts(S.cat.tipos, (t) => t.id, (t) => t.nombre, e.tipoId, 'Selecciona...')}</select>
          <label>Código / número</label><input name="codigo" value="${esc(e.codigo || '')}" required maxlength="40" placeholder="EXT-001">
          <label>Área</label><select id="f-area">${optsAreas(areaSel)}</select>
          <label>Subárea</label><select name="subareaId" id="f-sub">${optsSubareas(areaSel, e.subareaId)}</select>
          <label>Ubicación exacta</label><input name="ubicacionDetalle" value="${esc(e.ubicacionDetalle || '')}" maxlength="150" placeholder="Junto a la puerta 2">
          <label>Estado</label><select name="estado">${['Operativo', 'Incompleto', 'ConProblema', 'NoDisponible'].map((s) => `<option value="${s}"${e.estado === s ? ' selected' : ''}>${s === 'ConProblema' ? 'Con problema' : s === 'NoDisponible' ? 'No disponible' : s}</option>`).join('')}</select>
          <div class="row"><div class="grow"><label>Capacidad</label><input name="capacidad" value="${esc(e.capacidad || '')}" placeholder="20 lb"></div><div class="grow"><label>Clase / agente</label><input name="claseAgente" value="${esc(e.claseAgente || '')}" placeholder="ABC, CO2..."></div></div>
          <div class="row"><div class="grow"><label>Última recarga</label><input name="fechaRecarga" type="date" value="${esc(e.fechaRecarga || '')}"></div><div class="grow"><label>Vencimiento</label><input name="fechaVencimiento" type="date" value="${esc(e.fechaVencimiento || '')}"></div></div>
          <label>Última inspección</label><input name="ultimaInspeccion" type="date" value="${esc(e.ultimaInspeccion || '')}">
          <label>Contenido esperado (botiquín / gabinete)</label><textarea name="contenido" placeholder="Un ítem por línea:&#10;Gasas estériles | 10&#10;Alcohol | 1">${esc(contenido)}</textarea>
          <label>Observaciones</label><textarea name="observaciones" maxlength="500">${esc(e.observaciones || '')}</textarea>
          <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="activo" ${e.activo !== false ? 'checked' : ''} style="width:22px;height:22px">Equipo activo</label>
          <div id="msg"></div><button class="btn full" style="margin-top:14px">Guardar equipo</button></form>`;
      }
    },

    gestion: {
      titulo: 'Gestión',
      async html() {
        const b = (act, ic, t, d) => `<div class="card" data-act="${act}" style="cursor:pointer"><div class="row"><span style="font-size:28px">${ic}</span><div class="grow"><h3>${t}</h3><div class="muted small">${d}</div></div>›</div></div>`;
        let h = b('irPersonal', '👷', 'Personal en planta', 'Quién está disponible y quién no');
        if (esGestion()) h += b('irReportes', '🧯', 'Reportes de equipos', 'Incompletos, con problemas o no disponibles') + b('irUsuarios', '👥', 'Usuarios', 'Crear brigadistas, supervisores y personal de seguridad') + b('irCatalogos', '🏭', 'Unidades y áreas', 'Unidad, departamento, área y subárea') ;
        return h;
      }
    },

    personal: {
      titulo: 'Personal en planta', padre: 'gestion',
      async html() {
        const d = await api('personal');
        const en = d.personal.filter((x) => x.disponiblePlanta).length;
        let h = `<div class="card row wrap"><span class="badge verde">🟢 En planta: ${en}</span><span class="badge">⚪ Fuera: ${d.personal.length - en}</span></div>`;
        h += d.personal.sort((a, b) => Number(b.disponiblePlanta) - Number(a.disponiblePlanta) || a.nombre.localeCompare(b.nombre)).map((x) => `<div class="card row"><div class="grow"><b>${esc(x.nombre)}</b><div class="muted small">${esc(ROL_TXT[x.rol])}${x.area ? ' · ' + esc(x.area) : ''}${x.telefono ? ` · <a href="tel:${esc(x.telefono)}">${esc(x.telefono)}</a>` : ''}</div></div><span class="badge ${x.disponiblePlanta ? 'verde' : ''}">${x.disponiblePlanta ? 'En planta' : 'Fuera'}</span></div>`).join('');
        return h;
      }
    },

    reportes: {
      titulo: 'Reportes de equipos', padre: 'gestion',
      async html(p) {
        const estado = p.estado || 'Abierto';
        const d = await api('reportesLista', { estado });
        let h = `<div class="chips"><button data-act="repEstado" data-e="Abierto" class="${estado === 'Abierto' ? 'on' : ''}">Abiertos</button><button data-act="repEstado" data-e="Resuelto" class="${estado === 'Resuelto' ? 'on' : ''}">Resueltos</button></div>`;
        if (!d.reportes.length) return h + '<div class="vacio card">✅ Sin reportes</div>';
        return h + d.reportes.map((r) => `<div class="card"><div class="row wrap"><span class="badge rojo">${esc(PROB_TXT[r.problema] || r.problema)}</span><span class="muted small grow" style="text-align:right">${esc(fh(r.fecha))}</span></div>
          <h3 style="margin-top:6px">${esc(r.tipo)} · ${esc(r.codigo)}</h3><div class="muted small">${esc(r.ubicacion)}</div><div style="margin:6px 0">${esc(r.detalle).replace(/\n/g, '<br>')}</div>
          <div class="muted small">Reportó: ${esc(r.reportadoPorNombre)}${r.estado === 'Resuelto' ? ' · Resuelto por ' + esc(r.resueltoPorNombre) + ' ' + esc(fh(r.resueltoEn)) : ''}</div>
          ${r.estado === 'Abierto' ? `<button class="btn verde chico" style="margin-top:8px" data-act="resolver" data-id="${esc(r.id)}">Marcar como resuelto</button>` : ''}</div>`).join('');
      }
    },

    usuarios: {
      titulo: 'Usuarios', padre: 'gestion',
      async html() {
        const d = await api('usuarios');
        return `<button class="btn full" data-act="nuevoUsuario" style="margin-bottom:12px">＋ Nuevo usuario</button>` + d.usuarios.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((u) => `<div class="card row" data-act="editarUsuario" data-id="${esc(u.id)}" style="cursor:pointer;${u.activo ? '' : 'opacity:.55'}"><div class="grow"><b>${esc(u.nombre)}</b><div class="muted small">@${esc(u.usuario)} · ${esc(ROL_TXT[u.rol])}${u.activo ? '' : ' · INACTIVO'}</div></div>›</div>`).join('');
      },
    },

    usuarioForm: {
      titulo: (p) => (p.id ? 'Editar usuario' : 'Nuevo usuario'), padre: 'gestion',
      async html(p) {
        if (!S.cat) await cargarCat();
        const lista = p.id ? (await api('usuarios')).usuarios : [];
        const u = lista.find((x) => x.id === p.id) || { rol: 'Brigadista', activo: true };
        const roles = ['Brigadista', 'Supervisor', 'SeguridadIndustrial', 'Gerente', 'Coordinador' ].concat(rol() === 'Admin' ? ['Admin'] : []);
        return `<form data-form="usuario" class="card"><input type="hidden" name="id" value="${esc(u.id || '')}">
          <label>Nombre completo</label><input name="nombre" value="${esc(u.nombre || '')}" required maxlength="80">
          <label>Usuario para entrar</label><input name="usuario" value="${esc(u.usuario || '')}" required autocapitalize="none" maxlength="40" placeholder="jperez">
          <label>Rol</label><select name="rol">${roles.map((r) => `<option value="${r}"${u.rol === r ? ' selected' : ''}>${ROL_TXT[r]}</option>`).join('')}</select>
          <label>Teléfono</label><input name="telefono" type="tel" value="${esc(u.telefono || '')}" maxlength="30">
          <label>Área de trabajo</label><select name="areaId">${optsAreas(u.areaId)}</select>
          ${u.id ? `<label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="activo" ${u.activo ? 'checked' : ''} style="width:22px;height:22px">Usuario activo</label>` : '<div class="info">Se generará una contraseña temporal que verás una sola vez.</div>'}
          <div id="msg"></div><button class="btn full" style="margin-top:14px">Guardar</button>
          ${u.id ? `<button type="button" class="btn sec full" style="margin-top:10px" data-act="resetClave" data-id="${esc(u.id)}">Restablecer contraseña</button>` : ''}</form>`;
      }
    },

    claveResultado: {
      titulo: 'Contraseña temporal', padre: 'gestion',
      async html(p) {
        return `<div class="card"><h3>${esc(p.nombre)}</h3><div class="muted">Usuario: <b>${esc(p.usuario)}</b></div><div class="clave">${esc(p.clave)}</div>
          <div class="info">Anótala y entrégala a la persona. <b>No se volverá a mostrar.</b> Al entrar tendrá que crear su propia contraseña.</div>
          <button class="btn full" data-act="irUsuarios">Listo</button></div>`;
      }
    },

    catalogos: {
      titulo: 'Unidades y áreas', padre: 'gestion',
      async html(p) {
        await cargarCat();
        const t = p.tabla || 'Unidades';
        const defs = {
          Unidades: { n: 'Unidades', arr: S.cat.unidades, padre: () => '' },
          Departamentos: { n: 'Departamentos', arr: S.cat.deptos, padre: (x) => (idx(S.cat.unidades)[x.unidadId] || {}).nombre },
          Areas: { n: 'Áreas', arr: S.cat.areas, padre: (x) => rutaDepto(x.deptoId) },
          Subareas: { n: 'Subáreas', arr: S.cat.subareas, padre: (x) => rutaArea(x.areaId) },
          TiposEquipo: { n: 'Tipos de equipo', arr: S.cat.tipos, padre: () => '' }
        };
        const d = defs[t];
        return `<div class="chips">${Object.keys(defs).map((k) => `<button data-act="catTabla" data-t="${k}" class="${k === t ? 'on' : ''}">${defs[k].n}</button>`).join('')}</div>
          <button class="btn full" data-act="nuevoCat" data-t="${t}" style="margin-bottom:12px">＋ Agregar a ${d.n}</button>` +
          (d.arr.length ? d.arr.map((x) => `<div class="card row" data-act="editarCat" data-t="${t}" data-id="${esc(x.id)}" style="cursor:pointer;${x.activo === false ? 'opacity:.55' : ''}"><div class="grow"><b>${esc(x.nombre)}</b>${d.padre(x) ? `<div class="muted small">${esc(d.padre(x))}</div>` : ''}${x.activo === false ? '<div class="muted small">INACTIVO</div>' : ''}</div>›</div>`).join('') : '<div class="vacio card">Aún no hay registros. Empieza por las Unidades.</div>');
      }
    },

    catalogoForm: {
      titulo: 'Unidad / área', padre: 'gestion',
      async html(p) {
        await cargarCat();
        const t = p.tabla;
        const lista = { Unidades: S.cat.unidades, Departamentos: S.cat.deptos, Areas: S.cat.areas, Subareas: S.cat.subareas, TiposEquipo: S.cat.tipos }[t];
        const x = (p.id && lista.find((i) => i.id === p.id)) || { activo: true };
        const nivel = { Departamentos: ['unidadId', 'Unidad', S.cat.unidades, (u) => u.nombre], Areas: ['deptoId', 'Departamento', S.cat.deptos, (d) => rutaDepto(d.id)], Subareas: ['areaId', 'Área', S.cat.areas, (a) => rutaArea(a.id)] }[t];
        return `<form data-form="catalogo" class="card"><input type="hidden" name="tabla" value="${esc(t)}"><input type="hidden" name="id" value="${esc(x.id || '')}">
          <h3>${{ Unidades: 'Unidad', Departamentos: 'Departamento', Areas: 'Área', Subareas: 'Subárea', TiposEquipo: 'Tipo de equipo' }[t]}</h3>
          ${nivel ? `<label>Pertenece a (${nivel[1]})</label><select name="padreId" required>${opts(nivel[2], (i) => i.id, nivel[3], x[nivel[0]], 'Selecciona...')}</select>` : ''}
          <label>Nombre</label><input name="nombre" value="${esc(x.nombre || '')}" required maxlength="80">
          ${t !== 'TiposEquipo' && x.id ? `<label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="activo" ${x.activo !== false ? 'checked' : ''} style="width:22px;height:22px">Activo</label>` : ''}
          <div id="msg"></div><button class="btn full" style="margin-top:14px">Guardar</button></form>`;
      }
    },

    perfil: {
      titulo: 'Mi perfil',
      async html() {
        const noti = ('Notification' in window) ? Notification.permission : 'no disponible';
        return `<div class="card"><h3>${esc(S.perfil.nombre)}</h3><div class="muted">@${esc(S.perfil.usuario)} · ${esc(ROL_TXT[rol()])}</div></div>
          <div class="card"><h3>Sonido y notificaciones</h3>
          <div class="small muted" style="margin-bottom:8px">Notificaciones: <b>${noti === 'granted' ? 'activadas ✔' : noti === 'denied' ? 'bloqueadas (actívalas en los ajustes del teléfono)' : 'sin activar'}</b></div>
          ${noti !== 'granted' ? '<button class="btn chico" data-act="push">Activar notificaciones</button> ' : ''}
          <button class="btn chico gris" data-act="probarSirena">🔊 Probar sirena (3 s)</button>
          <div class="info" style="margin-top:10px">Para que suene aunque el teléfono esté en silencio, sigue la guía de configuración del teléfono (Android: importancia “Urgente” y excepción de No molestar).</div></div>
          <div class="card"><h3>Cambiar contraseña</h3>${claveForm(false).replace('class="card"', '')}</div>
          <button class="btn sec full" data-act="salir">Cerrar sesión</button>
          <p class="muted small" style="text-align:center">Safety Alert · ${esc(CFG.empresa || '')}</p>`;
      }
    }
  };

  // ---------- equipos: lista filtrada ----------
  function diasPara(f) { if (!f) return null; return Math.round((new Date(f + 'T12:00:00') - new Date()) / 86400000); }
  function listaEquipos() {
    const q = S.fEq.q.trim().toLowerCase(); const f = S.fEq.f;
    let l = (S.equipos || []).filter((e) => e.activo || esGestion());
    if (f === 'prob') l = l.filter((e) => e.estado !== 'Operativo');
    else if (f === 'venc') l = l.filter((e) => { const d = diasPara(e.fechaVencimiento); return d !== null && d <= 30; });
    else if (f.startsWith('t:')) l = l.filter((e) => e.tipoId === f.slice(2));
    if (q) l = l.filter((e) => (e.codigo + ' ' + e.ubicacion + ' ' + e.tipo).toLowerCase().includes(q));
    if (!l.length) return '<div class="vacio card">No hay equipos con ese filtro</div>';
    return l.map((e) => {
      const d = diasPara(e.fechaVencimiento);
      const venc = d === null ? '' : d < 0 ? '<span class="badge rojo">Vencido</span>' : d <= 30 ? `<span class="badge amar">Vence en ${d} día(s)</span>` : '';
      return `<div class="card"><div class="row wrap"><span class="badge">${esc(e.tipo)}</span><span class="badge ${EST_CLASE[e.estado] || ''}">${esc(PROB_TXT[e.estado] || e.estado)}</span>${venc}${e.activo ? '' : '<span class="badge">Inactivo</span>'}</div>
        <h3 style="margin-top:6px">${esc(e.codigo)}</h3><div class="muted small">${esc(e.ubicacion || 'Sin ubicación')}</div>
        ${e.capacidad || e.claseAgente ? `<div class="small">${esc([e.capacidad, e.claseAgente].filter(Boolean).join(' · '))}</div>` : ''}
        ${e.fechaVencimiento ? `<div class="small muted">Vence: ${esc(fd(e.fechaVencimiento))}${e.fechaRecarga ? ' · Recarga: ' + esc(fd(e.fechaRecarga)) : ''}</div>` : ''}
        <div class="row" style="margin-top:10px"><button class="btn chico sec" data-act="reportar" data-id="${esc(e.id)}">⚠️ Reportar problema</button>${esGestion() ? `<button class="btn chico gris" data-act="editarEquipo" data-id="${esc(e.id)}">Editar</button>` : ''}</div></div>`;
    }).join('');
  }

  // ---------- acciones (clics) ----------
  const ACC = {
    atras: () => atras(),
    reintentar: () => render(),
    tab: (d) => tab(d.v),
    salir: async () => { try { await api('logout'); } catch (e) { /* ya cerrada */ } cerrarLocal(); S.mensajeLogin = ''; render(); },
    push: () => activarPush(),
    crear: (d) => go('crear', { tipo: d.t }),
    verAlerta: (d) => go('alertaDetalle', { id: d.id }),
    irReportes: () => go('reportes', {}),
    irPersonal: () => go('personal', {}),
    irUsuarios: () => { S.stack = [{ view: 'gestion', params: {} }]; S.view = 'usuarios'; S.params = {}; render(); },
    irCatalogos: () => go('catalogos', {}),
    silenciar: () => Sirena.silenciar(),
    descartar: (d) => { S.descartadas.add(d.id); cerrarOverlay(); toast('Recuerda responder desde Inicio'); },
    probarSirena: () => { Sirena.start('Emergencia'); setTimeout(() => Sirena.stop(), 3000); },
    responder: async (d, el) => {
      el.disabled = true;
      try {
        await api('alertaResponder', { alertaId: d.id, respuesta: d.r });
        S.perfil.disponiblePlanta = d.r === 'Asiste';
        if (S.overlayId === d.id) cerrarOverlay();
        toast(d.r === 'Asiste' ? '✅ Registrado: ASISTES' : '🚫 Registrado: FUERA DE PLANTA');
        await chequear().catch(() => {}); render();
      } catch (e) { el.disabled = false; toast(e.message); }
    },
    cerrarAlerta: async (d) => {
      if (!confirm('¿Cerrar esta alerta? Se considerará terminada la emergencia.')) return;
      try { await api('alertaCerrar', { id: d.id }); toast('Alerta cerrada'); await chequear().catch(() => {}); render(); } catch (e) { toast(e.message); }
    },
    filtroEq: (d) => { S.fEq.f = d.k; render(); },
    nuevoEquipo: () => go('equipoForm', {}),
    editarEquipo: (d) => go('equipoForm', { id: d.id }),
    reportar: (d) => go('reporteForm', { equipoId: d.id }),
    repEstado: (d) => go('reportes', { estado: d.e }, true),
    resolver: async (d) => {
      if (!confirm('¿Marcar este reporte como resuelto?')) return;
      try { await api('reporteResolver', { id: d.id }); S.equipos = null; toast('Reporte resuelto'); render(); } catch (e) { toast(e.message); }
    },
    nuevoUsuario: () => go('usuarioForm', {}),
    editarUsuario: (d) => go('usuarioForm', { id: d.id }),
    resetClave: async (d) => {
      if (!confirm('¿Generar una nueva contraseña temporal? La actual dejará de funcionar y se cerrará su sesión.')) return;
      try {
        const r = await api('usuarioResetClave', { id: d.id });
        const u = (await api('usuarios')).usuarios.find((x) => x.id === d.id);
        go('claveResultado', { nombre: u.nombre, usuario: u.usuario, clave: r.claveTemporal }, true);
      } catch (e) { toast(e.message); }
    },
    catTabla: (d) => go('catalogos', { tabla: d.t }, true),
    nuevoCat: (d) => go('catalogoForm', { tabla: d.t }),
    editarCat: (d) => go('catalogoForm', { tabla: d.t, id: d.id })
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const f = ACC[el.dataset.act];
    if (f) { Sirena.init(); f(el.dataset, el); }
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'f-area') { const s = $('#f-sub'); if (s) s.innerHTML = optsSubareas(t.value, ''); }
    if (t.dataset && t.dataset.chg === 'disp') {
      try { await api('setDisponible', { disponible: t.checked }); S.perfil.disponiblePlanta = t.checked; toast(t.checked ? '🟢 Disponible en planta' : '⚪ Fuera de planta'); render(); }
      catch (err) { t.checked = !t.checked; toast(err.message); }
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { S.fEq.q = e.target.value; const l = $('#lista-eq'); if (l) l.innerHTML = listaEquipos(); }
  });

  // ---------- formularios ----------
  const FORMS = {
    async login(f) {
      Sirena.init();
      const d = await api('login', { usuario: f.usuario.value, clave: f.clave.value });
      S.token = d.token; S.perfil = d.perfil; S.mensajeLogin = ''; ls.set('sa_token', d.token);
      await iniciarSesion();
    },
    async clave(f) {
      if (f.nueva.value !== f.repite.value) throw new Error('Las contraseñas nuevas no coinciden');
      await api('cambiarClave', { claveActual: f.actual.value, claveNueva: f.nueva.value });
      S.perfil.debeCambiarClave = false; toast('Contraseña actualizada ✔');
      if (!S.cat) await iniciarSesion(); else render();
    },
    async crear(f) {
      const tipo = f.tipo.value;
      if (!confirm(tipo === 'Emergencia' ? '¿Enviar una EMERGENCIA REAL a todo el personal?' : '¿Enviar el SIMULACRO a todo el personal?')) return;
      const r = await api('alertaCrear', { tipo, subtipo: f.subtipo.value, areaId: f.areaId.value, subareaId: f.subareaId.value, mensaje: f.mensaje.value });
      const p = r.push || {};
      toast(p.error ? 'Alerta creada, pero falló el aviso push: revisa la configuración' : `Alerta enviada${p.enviados != null ? ' a ' + p.enviados + ' dispositivo(s)' : ''}`);
      S.stack = []; S.view = 'inicio'; S.params = {};
      await chequear().catch(() => {}); render();
    },
    async reporte(f) {
      const faltan = Array.from(f.querySelectorAll('input[name=falta]:checked')).map((x) => x.value);
      const detalle = (f.detalle.value + (faltan.length ? '\nFalta: ' + faltan.join(', ') : '')).trim();
      await api('reporteCrear', { equipoId: f.equipoId.value, problema: f.problema.value, detalle });
      S.equipos = null; toast('Reporte enviado a Seguridad Industrial ✔'); atras();
    },
    async equipo(f) {
      const contenido = f.contenido.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [item, n] = l.split('|'); return { item: item.trim(), cantidadEsperada: parseInt(n, 10) || 1 }; });
      const e = { id: f.id.value || undefined, tipoId: f.tipoId.value, codigo: f.codigo.value, subareaId: f.subareaId.value, ubicacionDetalle: f.ubicacionDetalle.value, estado: f.estado.value, capacidad: f.capacidad.value, claseAgente: f.claseAgente.value, fechaRecarga: f.fechaRecarga.value, fechaVencimiento: f.fechaVencimiento.value, ultimaInspeccion: f.ultimaInspeccion.value, observaciones: f.observaciones.value, activo: f.activo.checked, contenido };
      await api('equipoGuardar', { equipo: e });
      S.equipos = null; toast('Equipo guardado ✔'); atras();
    },
    async usuario(f) {
      const u = { id: f.id.value || undefined, nombre: f.nombre.value, usuario: f.usuario.value, rol: f.rol.value, telefono: f.telefono.value, areaId: f.areaId.value };
      if (f.activo) u.activo = f.activo.checked;
      const r = await api('usuarioGuardar', { usuario: u });
      if (r.claveTemporal) go('claveResultado', { nombre: u.nombre, usuario: u.usuario.toLowerCase(), clave: r.claveTemporal }, true);
      else { toast('Usuario guardado ✔'); atras(); }
    },
    async catalogo(f) {
      await api('catalogoGuardar', { tabla: f.tabla.value, id: f.id.value || undefined, nombre: f.nombre.value, padreId: f.padreId ? f.padreId.value : undefined, activo: f.activo ? f.activo.checked : undefined });
      await cargarCat(); toast('Guardado ✔'); atras();
    }
  };

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const fn = FORMS[f.dataset.form];
    const btn = f.querySelector('button:not([type=button])');
    const msg = f.querySelector('#msg');
    if (btn) btn.disabled = true;
    if (msg) msg.innerHTML = '';
    try { await fn(f); }
    catch (err) { if (msg) msg.innerHTML = `<div class="err">${esc(err.message)}</div>`; else toast(err.message); }
    finally { if (btn && btn.isConnected) btn.disabled = false; }
  });

  // ---------- arranque ----------
  async function iniciarSesion() {
    credGuardar({ api: CFG.API_URL, token: S.token });
    if (S.perfil.debeCambiarClave) { render(); return; }
    await cargarCat();
    S.stack = []; S.view = 'inicio'; S.params = {};
    render();
  }

  (async function boot() {
    if (S.token) {
      try { S.perfil = (await api('yo')).perfil; await iniciarSesion(); return; }
      catch (e) { if (S.token) { S.mensajeLogin = e.message; } cerrarLocal(); }
    }
    render();
  })();
})();
