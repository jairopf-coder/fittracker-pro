// ═══════════════════════════════════════════════════════════
//  FITTRACKER PRO  — app.js  v2
// ═══════════════════════════════════════════════════════════

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc,
         addDoc, setDoc, updateDoc, deleteDoc,
         onSnapshot, query, where, orderBy, Timestamp }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Init Firebase ───────────────────────────────────────
const app = initializeApp(firebaseConfig);   // firebaseConfig viene de firebase-config.js
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── State ───────────────────────────────────────────────
let clients   = [];
let slots     = [];
let payments  = [];
let currentPage    = 'dashboard';
let clientFilter   = 'all';
let currentWeek    = new Date();
let currentMonth   = new Date();
let editingClient  = null;
let editingSlot    = null;
let editingPayment = null;

const unsubs = {};

// ─── Data-loaded flags (para skeleton loaders) ───────────
const dataLoaded = { clients: false, slots: false, payments: false };

// ─── Theme ───────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('fittracker-theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f0f2f7');
  }
})();

window.toggleTheme = function () {
  const root = document.documentElement;
  const isLight = root.getAttribute('data-theme') === 'light';
  if (isLight) {
    root.removeAttribute('data-theme');
    localStorage.setItem('fittracker-theme', 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0d0f14');
  } else {
    root.setAttribute('data-theme', 'light');
    localStorage.setItem('fittracker-theme', 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f0f2f7');
  }
  _updateThemeUI();
};

function _updateThemeUI() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon)  icon.textContent  = isLight ? '🌙' : '☀️';
  if (label) label.textContent = isLight ? 'Modo oscuro' : 'Modo claro';
}
// Run once on load to sync icon
document.addEventListener('DOMContentLoaded', _updateThemeUI);

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if (user) {
    show('app'); hide('page-login');
    startListeners();
    navigate('dashboard');
  } else {
    hide('app'); show('page-login');
    stopListeners();
  }
});

window.doLogin = async function () {
  const email = val('login-email');
  const pass  = val('login-password');
  hide('login-error');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    showError('login-error', 'Email o contraseña incorrectos.');
  }
};

window.doLogout = async function () {
  await signOut(auth);
};

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ═══════════════════════════════════════════════════════════
//  FIRESTORE LISTENERS
// ═══════════════════════════════════════════════════════════
function startListeners() {
  // Mostrar skeletons antes del primer snapshot
  showSkeletons();

  unsubs.clients = onSnapshot(
    query(collection(db, 'clients'), orderBy('name')),
    snap => {
      clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dataLoaded.clients = true;
      refreshAll();
    }
  );
  unsubs.slots = onSnapshot(
    query(collection(db, 'slots'), orderBy('date')),
    snap => {
      slots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dataLoaded.slots = true;
      refreshAll();
    }
  );
  unsubs.payments = onSnapshot(
    query(collection(db, 'payments'), orderBy('date', 'desc')),
    snap => {
      payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      dataLoaded.payments = true;
      refreshAll();
    }
  );
}

function stopListeners() {
  Object.values(unsubs).forEach(u => u && u());
  dataLoaded.clients = false;
  dataLoaded.slots   = false;
  dataLoaded.payments = false;
}

// ─── Skeleton loaders ────────────────────────────────────
function skeletonGrid(cls, count) {
  return Array(count).fill(`<div class="skeleton ${cls}"></div>`).join('');
}

function showSkeletons() {
  // Dashboard
  $('dash-stats').innerHTML   = skeletonGrid('skeleton-stat', 4);
  $('dash-today').innerHTML   = skeletonGrid('skeleton-session', 3);
  $('dash-bonos').innerHTML   = skeletonGrid('skeleton-bono', 4);
  // Clientes
  $('clients-grid').innerHTML = skeletonGrid('skeleton-client', 6);
  // Calendario
  $('calendar-grid').innerHTML = skeletonGrid('skeleton-cal-row', 5);
  // Pagos
  $('payments-list').innerHTML = skeletonGrid('skeleton-payment', 5);
  if ($('payments-summary')) $('payments-summary').innerHTML = skeletonGrid('skeleton-stat', 3);
}

function refreshAll() {
  renderDashboard();
  renderClientes();
  renderCalendario();
  renderPagos();
  updateBadges();
}

// ═══════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════
window.navigate = function (page) {
  const pages = ['dashboard','clientes','calendario','pagos','client-detail'];
  const prevPage = currentPage;
  const prevEl   = document.getElementById(`page-${prevPage}`);

  currentPage = page;
  const navPage = ['dashboard','clientes','calendario','pagos'].includes(page) ? page : null;
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', navPage ? el.dataset.page === navPage : false);
  });
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', navPage ? el.dataset.page === navPage : false);
  });
  closeSidebar();

  const doSwitch = () => {
    pages.forEach(p => {
      const el = document.getElementById(`page-${p}`);
      if (!el) return;
      if (p === page) {
        el.classList.remove('hidden', 'page-fade-out');
        el.classList.add('page-fade-in');
        el.addEventListener('animationend', () => el.classList.remove('page-fade-in'), { once: true });
      } else {
        el.classList.add('hidden');
        el.classList.remove('page-fade-out', 'page-fade-in');
      }
    });
  };

  if (prevEl && !prevEl.classList.contains('hidden') && prevPage !== page) {
    prevEl.classList.add('page-fade-out');
    setTimeout(doSwitch, 75);
  } else {
    doSwitch();
  }
};

window.toggleSidebar = function () {
  const sb = $('sidebar');
  const ov = $('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('visible');
};

window.closeSidebar = function () {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('visible');
};

// ═══════════════════════════════════════════════════════════
//  UI HELPERS — avatar color, toast, detalle cliente
// ═══════════════════════════════════════════════════════════
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h},65%,55%)`;
}

function showToast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('hiding');
    t.addEventListener('animationend', () => t.remove());
  }, 2600);
}

window.openClientDetail = function (id) {
  const c = clients.find(x => x.id === id);
  if (!c) return;

  const color = avatarColor(c.name);
  const initials = c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const clientSlots = slots
    .filter(s => s.clientId === id)
    .sort((a, b) => toDate(b.date) - toDate(a.date))
    .slice(0, 6);

  const clientPayments = payments
    .filter(p => p.clientId === id)
    .sort((a, b) => toDate(b.date) - toDate(a.date))
    .slice(0, 5);

  const totalPaid = payments.filter(p => p.clientId === id).reduce((s, p) => s + (p.amount || 0), 0);

  const statusTag = c.active
    ? `<span class="tag tag-active">Activo</span>`
    : `<span class="tag tag-inactive">Inactivo</span>`;
  const payTag = `<span class="tag tag-${c.paymentType || 'bono'}">${payLabel(c.paymentType)}</span>`;

  let bonoHtml = '';
  if (c.paymentType === 'bono') {
    const pct   = Math.min(100, ((c.sessionsLeft || 0) / (c.bonoSize || 10)) * 100);
    const color2 = (c.sessionsLeft || 0) <= 2 ? 'var(--red)' : (c.sessionsLeft || 0) <= 4 ? 'var(--orange)' : 'var(--green)';
    bonoHtml = `<div class="detail-bono">
      <h3>Bono de sesiones</h3>
      <div class="detail-bono-bar-wrap">
        <div class="detail-bono-bar" style="width:${pct}%;background:${color2}"></div>
      </div>
      <div class="detail-bono-label">${c.sessionsLeft || 0} de ${c.bonoSize || 10} sesiones restantes</div>
    </div>`;
  }

  const sessionsHtml = clientSlots.length === 0
    ? `<div class="detail-empty">Sin sesiones registradas</div>`
    : clientSlots.map(s => {
        const d = toDate(s.date);
        return `<div class="detail-session-item">
          <span>${statusIcon(s.status)}</span>
          <span style="flex:1">${d.toLocaleDateString('es-ES',{day:'numeric',month:'short'})}</span>
          <span style="color:var(--text2);font-size:11px">${formatTime(d)}</span>
        </div>`;
      }).join('');

  const paymentsHtml = clientPayments.length === 0
    ? `<div class="detail-empty">Sin pagos registrados</div>`
    : clientPayments.map(p => {
        const d = toDate(p.date);
        return `<div class="detail-payment-item">
          <div>
            <div style="font-weight:700">${conceptLabel(p.concept)}</div>
            <div style="font-size:11px;color:var(--text2)">${d.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</div>
          </div>
          <div class="detail-payment-amount">+${(p.amount||0).toFixed(0)}€</div>
        </div>`;
      }).join('');

  const page = $('page-client-detail');
  page.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-outline btn-sm" onclick="navigate('clientes')">← Volver</button>
        <h1>${esc(c.name)}</h1>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openClientModal('${c.id}')">✏️ Editar</button>
    </div>

    <div class="detail-hero">
      <div class="detail-avatar" style="background:${color}">${initials}</div>
      <div class="detail-info">
        <h2>${esc(c.name)}</h2>
        <p>${esc(c.phone || c.email || '—')}${c.notes ? ' · ' + esc(c.notes) : ''}</p>
        <div class="detail-tags">${statusTag}${payTag}
          <span class="tag" style="background:rgba(255,255,255,.06);color:var(--text2)">Total pagado: ${totalPaid.toFixed(0)}€</span>
        </div>
      </div>
    </div>

    ${bonoHtml}

    <div class="detail-grid">
      <div class="detail-section">
        <h3>Últimas sesiones</h3>
        ${sessionsHtml}
      </div>
      <div class="detail-section">
        <h3>Últimos pagos</h3>
        ${paymentsHtml}
      </div>
    </div>
  `;
  navigate('client-detail');
};

// ═══════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  if (currentPage !== 'dashboard') return;
  if (!dataLoaded.clients || !dataLoaded.slots || !dataLoaded.payments) return;

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const dateStr = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  if ($('dash-greeting')) $('dash-greeting').textContent = greeting;
  if ($('dash-date'))     $('dash-date').textContent = dateStr;

  const activeClients = clients.filter(c => c.active);
  const totalRevenue  = payments.reduce((s, p) => s + (p.amount || 0), 0);

  // Alerts: bonos con ≤2 sesiones
  const alerts = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= 2);
  updateBadges(alerts.length);

  // Hero: sesiones de hoy (excluye canceladas)
  const todaySlots = slots.filter(s => isToday(toDate(s.date)) && s.status !== 'cancelled');
  if ($('dash-hero-sessions')) $('dash-hero-sessions').textContent = todaySlots.length;

  // Alert pill en hero
  const alertsEl = $('dash-alerts');
  if (alerts.length === 0) {
    alertsEl.innerHTML = '';
  } else {
    alertsEl.innerHTML = `<button class="dash-alert-pill" onclick="navigate('clientes')">
      <span class="dash-alert-dot"></span>
      ${alerts.length} bono${alerts.length !== 1 ? 's' : ''} bajo
    </button>`;
  }

  // Semana actual vs anterior
  const weekSlots = slots.filter(s => isThisWeek(toDate(s.date)) && s.status !== 'cancelled');
  const prevWeekStart = getWeekStart(new Date()); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd   = new Date(prevWeekStart); prevWeekEnd.setDate(prevWeekEnd.getDate() + 6);
  const prevWeekSlots = slots.filter(s => { const d = toDate(s.date); return d >= prevWeekStart && d <= prevWeekEnd && s.status !== 'cancelled'; });

  function kpiTrend(curr, prev) {
    if (prev === 0 && curr === 0) return `<span class="dash-kpi-trend flat">sin datos</span>`;
    if (prev === 0) return `<span class="dash-kpi-trend up">▲ nuevo</span>`;
    const diff = curr - prev;
    const pct  = Math.round(Math.abs(diff / prev) * 100);
    if (diff > 0) return `<span class="dash-kpi-trend up">▲ +${pct}%</span>`;
    if (diff < 0) return `<span class="dash-kpi-trend down">▼ ${pct}%</span>`;
    return `<span class="dash-kpi-trend flat">= igual</span>`;
  }

  $('dash-stats').innerHTML = `
    <div class="dash-kpi">
      <span class="dash-kpi-label">Clientes activos</span>
      <span class="dash-kpi-value">${activeClients.length}</span>
    </div>
    <div class="dash-kpi">
      <span class="dash-kpi-label">Sesiones semana</span>
      <span class="dash-kpi-value">${weekSlots.length}</span>
      ${kpiTrend(weekSlots.length, prevWeekSlots.length)}
    </div>
    <div class="dash-kpi">
      <span class="dash-kpi-label">Tendencia</span>
      <span class="dash-kpi-value" style="font-size:20px;letter-spacing:0">${weekSlots.length >= prevWeekSlots.length ? '▲' : '▼'}</span>
      ${kpiTrend(weekSlots.length, prevWeekSlots.length)}
    </div>
    <div class="dash-kpi">
      <span class="dash-kpi-label">Ingresos totales</span>
      <span class="dash-kpi-value">${totalRevenue.toFixed(0)}€</span>
    </div>
  `;

  // Timeline sesiones hoy
  const todayAll = slots.filter(s => isToday(toDate(s.date)));
  const todayEl = $('dash-today');
  if (todayAll.length === 0) {
    todayEl.innerHTML = `<p class="dash-empty">Sin sesiones programadas para hoy</p>`;
  } else {
    const statusCls = st => st === 'completed' ? 'completed' : st === 'pending' ? 'pending' : st === 'cancelled' ? 'cancelled' : 'scheduled';
    const statusTxt = st => st === 'completed' ? 'Completada' : st === 'pending' ? 'Pendiente' : st === 'cancelled' ? 'Cancelada' : 'Programada';
    todayEl.innerHTML = `<div class="dash-timeline">
      ${todayAll.sort((a,b) => toDate(a.date)-toDate(b.date)).map(s => {
        const client = clients.find(c => c.id === s.clientId);
        const name   = client ? client.name : (s.title || 'Bloqueado');
        const cls    = statusCls(s.status);
        return `<div class="dash-tl-item">
          <span class="dash-tl-dot ${cls}"></span>
          <span class="dash-tl-time">${formatTime(toDate(s.date))}</span>
          <span class="dash-tl-name">${esc(name)}</span>
          <span class="dash-tl-status ${cls}">${statusTxt(s.status)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Charts
  // — Sesiones por día (últimos 7 días)
  const sesLabels = [];
  const sesCounts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    sesLabels.push(d.toLocaleDateString('es-ES', { weekday: 'short' }));
    sesCounts.push(slots.filter(s => { const sd = toDate(s.date); return sd >= d && sd < next && s.status !== 'cancelled'; }).length);
  }

  if (window._chartSesiones) { window._chartSesiones.destroy(); window._chartSesiones = null; }
  const ctxSes = $('chart-sesiones');
  if (ctxSes) {
    window._chartSesiones = new Chart(ctxSes, {
      type: 'bar',
      data: {
        labels: sesLabels,
        datasets: [{ data: sesCounts, backgroundColor: '#e8ff47', borderRadius: 6, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} ses.` } } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(122,131,148,0.7)', font: { size: 10, family: 'Syne' } } },
          y: { display: false, grid: { display: false } }
        }
      }
    });
  }

  // — Ingresos por mes (últimos 6 meses)
  const ingLabels = [];
  const ingTotals = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    ingLabels.push(d.toLocaleDateString('es-ES', { month: 'short' }));
    ingTotals.push(payments.filter(p => { const pd = toDate(p.date); return pd.getFullYear() === d.getFullYear() && pd.getMonth() === d.getMonth(); }).reduce((s, p) => s + (p.amount || 0), 0));
  }

  if (window._chartIngresos) { window._chartIngresos.destroy(); window._chartIngresos = null; }
  const ctxIng = $('chart-ingresos');
  if (ctxIng) {
    window._chartIngresos = new Chart(ctxIng, {
      type: 'line',
      data: {
        labels: ingLabels,
        datasets: [{
          data: ingTotals,
          borderColor: '#47b8ff',
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: true,
          backgroundColor: 'rgba(71,184,255,0.10)'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(0)}€` } } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: 'rgba(122,131,148,0.7)', font: { size: 10, family: 'Syne' } } },
          y: { display: false, grid: { display: false }, border: { display: false } }
        }
      }
    });
  }

  // Bono rings SVG
  const bonosEl = $('dash-bonos');
  const bonoClients = activeClients.filter(c => c.paymentType === 'bono').slice(0, 6);
  if (bonoClients.length === 0) {
    bonosEl.innerHTML = `<p class="dash-empty">Sin clientes con bono activo</p>`;
  } else {
    const R = 26; // radio del ring
    const CIRC = 2 * Math.PI * R;
    bonosEl.innerHTML = bonoClients.map(c => {
      const left    = c.sessionsLeft || 0;
      const total   = c.bonoSize    || 10;
      const pct     = Math.min(1, left / total);
      const offset  = CIRC * (1 - pct);
      const color   = left <= 2 ? 'var(--red)' : left <= 4 ? 'var(--orange)' : 'var(--green)';
      const pctTxt  = Math.round(pct * 100);
      const firstName = esc(c.name).split(' ')[0];
      return `<div class="dash-ring-item" onclick="openClientDetail('${c.id}')">
        <div style="position:relative;width:64px;height:64px">
          <svg class="dash-ring-svg" width="64" height="64" viewBox="0 0 64 64">
            <circle class="dash-ring-track" cx="32" cy="32" r="${R}"/>
            <circle class="dash-ring-fill"
              cx="32" cy="32" r="${R}"
              stroke="${color}"
              stroke-dasharray="${CIRC}"
              stroke-dashoffset="${offset}"
            />
          </svg>
          <div class="dash-ring-pct" style="color:${color}">${pctTxt}%</div>
        </div>
        <span class="dash-ring-name">${firstName}</span>
        <span class="dash-ring-sessions">${left}/${total}</span>
      </div>`;
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════
//  CLIENTES
// ═══════════════════════════════════════════════════════════
window.setClientFilter = function (f) {
  clientFilter = f;
  document.querySelectorAll('.filter-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === f);
  });
  renderClientes();
};

window.renderClientes = function () {
  if (!dataLoaded.clients) return;
  const search = (val('client-search') || '').toLowerCase();
  let list = clients.filter(c => {
    const match = c.name.toLowerCase().includes(search) ||
      (c.phone || '').includes(search) ||
      (c.email || '').toLowerCase().includes(search);
    if (clientFilter === 'active') return match && c.active;
    if (clientFilter === 'alert')  return match && c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= 2;
    return match;
  });

  const el = $('clients-grid');
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span>👥</span><p>No hay clientes todavía</p><button class="btn btn-primary btn-sm" onclick="openClientModal()">+ Añadir primer cliente</button></div>`;
    return;
  }
  el.innerHTML = list.map(c => {
    const statusTag = c.active
      ? `<span class="tag tag-active">Activo</span>`
      : `<span class="tag tag-inactive">Inactivo</span>`;
    const payTag = `<span class="tag tag-${c.paymentType || 'bono'}">${payLabel(c.paymentType)}</span>`;
    let bonoTag = '';
    if (c.paymentType === 'bono') {
      const level = (c.sessionsLeft || 0) <= 2 ? 'danger' : (c.sessionsLeft || 0) <= 4 ? 'warning' : 'ok';
      bonoTag = `<span class="tag tag-${level}">${c.sessionsLeft || 0} ses.</span>`;
    }
    const color = avatarColor(c.name);
    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    return `<div class="client-card" onclick="openClientDetail('${c.id}')">
      <div class="client-avatar" style="background:${color}">${initials}</div>
      <div class="client-info">
        <h3>${esc(c.name)}</h3>
        <p>${esc(c.phone || c.email || '—')}</p>
        <div class="client-tags">${statusTag}${payTag}${bonoTag}</div>
      </div>
    </div>`;
  }).join('');
};

// ── Client Modal ──────────────────────────────────────────
window.openClientModal = function (id) {
  editingClient = id ? clients.find(c => c.id === id) : null;
  $('modal-client-title').textContent = editingClient ? editingClient.name : 'Nuevo Cliente';
  $('client-id').value     = editingClient?.id || '';
  $('c-name').value        = editingClient?.name || '';
  $('c-phone').value       = editingClient?.phone || '';
  $('c-email').value       = editingClient?.email || '';
  $('c-payment-type').value = editingClient?.paymentType || 'bono';
  $('c-bono-size').value   = editingClient?.bonoSize || 10;
  $('c-sessions-left').value = editingClient?.sessionsLeft ?? 10;
  $('c-notes').value       = editingClient?.notes || '';
  $('c-active').checked    = editingClient ? editingClient.active !== false : true;
  toggleClass('btn-delete-client', 'hidden', !editingClient);
  toggleBonoFields();
  show('modal-client');
};

window.toggleBonoFields = function () {
  const isBono = $('c-payment-type').value === 'bono';
  toggleClass('bono-size-group',     'hidden', !isBono);
  toggleClass('sessions-left-group', 'hidden', !isBono);
};

window.saveClient = async function () {
  const name = $('c-name').value.trim();
  if (!name) { alert('El nombre es obligatorio'); return; }
  const data = {
    name,
    phone:       $('c-phone').value.trim(),
    email:       $('c-email').value.trim(),
    paymentType: $('c-payment-type').value,
    bonoSize:    parseInt($('c-bono-size').value) || 10,
    sessionsLeft: parseInt($('c-sessions-left').value) || 0,
    notes:       $('c-notes').value.trim(),
    active:      $('c-active').checked,
    updatedAt:   Timestamp.now(),
  };
  if (editingClient) {
    await updateDoc(doc(db, 'clients', editingClient.id), data);
  } else {
    data.createdAt = Timestamp.now();
    data.totalPaid = 0;
    await addDoc(collection(db, 'clients'), data);
  }
  closeModalClient();
  showToast(editingClient ? '✅ Cliente actualizado' : '✅ Cliente creado');
};

window.deleteClient = async function () {
  if (!editingClient) return;
  if (!confirm(`¿Eliminar a ${editingClient.name}? Se borrarán todos sus datos.`)) return;
  await deleteDoc(doc(db, 'clients', editingClient.id));
  closeModalClient();
  showToast('🗑️ Cliente eliminado', 'info');
};

window.closeModalClient = function (e) {
  if (e && e.target !== $('modal-client')) return;
  hide('modal-client');
  editingClient = null;
};

// ═══════════════════════════════════════════════════════════
//  CALENDARIO
// ═══════════════════════════════════════════════════════════
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7–20

window.changeWeek = function (dir) {
  currentWeek = new Date(currentWeek);
  currentWeek.setDate(currentWeek.getDate() + dir * 7);
  renderCalendario();
};

window.goToday = function () {
  currentWeek = new Date();
  renderCalendario();
};

function getWeekStart(d) {
  const date = new Date(d);
  const day  = date.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}


// ── px per minute constant (52px per hour) ───────────────
const PX_PER_MIN = 52 / 60;
const CAL_START_H = 7; // first visible hour

function minutesToPx(minutes) { return minutes * PX_PER_MIN; }
function timeToTopPx(h, m) { return minutesToPx((h - CAL_START_H) * 60 + m); }

// ── Drag state ────────────────────────────────────────────
let dragSlotId   = null;
let dragOffsetMin = 0; // minutes from event top where user grabbed

function renderCalendario() {
  if (!dataLoaded.clients || !dataLoaded.slots) return;

  const weekStart = getWeekStart(currentWeek);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const opts = { day:'numeric', month:'short' };
  $('week-label').textContent =
    `${days[0].toLocaleDateString('es-ES', opts)} – ${days[6].toLocaleDateString('es-ES', { ...opts, year:'numeric' })}`;

  const today = new Date(); today.setHours(0,0,0,0);
  const DAYS_ES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const calendarEl = $('calendar-grid');
  const totalHours = HOURS.length; // 14 hours (7-20)
  const colHeight  = totalHours * 52; // px

  // ── Build HTML ────────────────────────────────────────
  // Header row
  let html = `<div class="cal-header-row">
    <div class="cal-corner"></div>`;
  days.forEach((d, i) => {
    const isT = d.getTime() === today.getTime();
    html += `<div class="cal-day-header ${isT ? 'today' : ''}">
      <span class="day-name">${DAYS_ES[i]}</span>
      <span class="day-number">${d.getDate()}</span>
    </div>`;
  });
  html += `</div>`;

  // Body
  html += `<div class="cal-body">`;

  // Time gutter
  html += `<div class="cal-time-col">`;
  HOURS.forEach(h => {
    html += `<div class="cal-time">${h}:00</div>`;
  });
  html += `</div>`;

  // Day columns
  days.forEach((day, dayIdx) => {
    const isT = day.getTime() === today.getTime();
    const dateKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;

    // Events for this day
    const daySlots = slots.filter(s => {
      const sd = toDate(s.date);
      return sd.getFullYear() === day.getFullYear()
          && sd.getMonth()    === day.getMonth()
          && sd.getDate()     === day.getDate();
    });

    // Build hour grid lines (non-interactive, just visual)
    let gridLines = '';
    HOURS.forEach(() => { gridLines += `<div class="cal-hour-slot half-mark"></div>`; });

    // Build event chips
    let evHtml = '';
    daySlots.forEach(s => {
      const sd = toDate(s.date);
      const h  = sd.getHours();
      const m  = sd.getMinutes();
      const dur = s.duration || 60;
      const top  = timeToTopPx(h, m);
      const height = Math.max(22, minutesToPx(dur) - 3);

      if (top < 0 || top > colHeight) return; // outside visible range

      const client = clients.find(c => c.id === s.clientId);
      const label  = client ? client.name : (s.title || 'Bloqueado');
      const status = s.status || 'scheduled';
      const statusCls = status === 'completed' ? 'status-completed'
                      : status === 'pending'   ? 'status-pending'
                      : status === 'cancelled' ? 'status-cancelled' : '';
      const startTime = formatTime(sd);
      const endDate   = new Date(sd.getTime() + dur * 60000);
      const endTime   = formatTime(endDate);
      const showTime  = height >= 36;

      evHtml += `<div class="cal-event type-${s.type || 'client'} ${statusCls}"
        style="top:${top}px;height:${height}px"
        data-slot-id="${s.id}"
        draggable="true"
        onclick="openSlotModal('${s.id}',event)"
        data-tooltip-name="${esc(label)}"
        data-tooltip-time="${startTime} – ${endTime}"
        data-tooltip-dur="${dur} min"
        data-tooltip-status="${esc(statusLabel(status))}">
        <span class="ev-label">${esc(label)}</span>
        ${showTime ? `<span class="ev-time">${startTime} – ${endTime}</span>` : ''}
      </div>`;
    });

    // Now line (only on today's column)
    let nowLine = '';
    if (isT) {
      const now = new Date();
      const nowTop = timeToTopPx(now.getHours(), now.getMinutes());
      if (nowTop >= 0 && nowTop <= colHeight) {
        nowLine = `<div class="cal-now-line" style="top:${nowTop}px"></div>`;
      }
    }

    html += `<div class="cal-day-col ${isT ? 'today-col' : ''}"
      data-day-idx="${dayIdx}"
      data-date="${dateKey}"
      onclick="handleColClick(event,${dayIdx})"
      ondragover="handleDragOver(event)"
      ondragleave="handleDragLeave(event)"
      ondrop="handleDrop(event,${dayIdx})">
      ${gridLines}
      ${nowLine}
      ${evHtml}
    </div>`;
  });

  html += `</div>`; // .cal-body

  calendarEl.innerHTML = html;

  // Attach drag listeners imperatively (draggable=true alone needs ondragstart)
  calendarEl.querySelectorAll('.cal-event[data-slot-id]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragSlotId = el.dataset.slotId;
      const s  = slots.find(x => x.id === dragSlotId);
      if (!s) return;
      const sd = toDate(s.date);
      const eventTopPx = parseFloat(el.style.top);
      const colRect    = el.closest('.cal-day-col').getBoundingClientRect();
      const grabOffsetPx = e.clientY - colRect.top - eventTopPx;
      dragOffsetMin = Math.round(grabOffsetPx / PX_PER_MIN);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSlotId);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      calendarEl.querySelectorAll('.cal-day-col.drag-over').forEach(c => c.classList.remove('drag-over'));
    });
  });

  // ── Week summary ─────────────────────────────────────
  const weekEnd   = new Date(days[6]); weekEnd.setHours(23,59,59,999);
  const weekBeg   = new Date(days[0]); weekBeg.setHours(0,0,0,0);
  const weekSlots = slots.filter(s => { const d = toDate(s.date); return d >= weekBeg && d <= weekEnd; });
  const countByStatus = { scheduled:0, completed:0, pending:0, cancelled:0 };
  weekSlots.forEach(s => { const st = s.status || 'scheduled'; if (st in countByStatus) countByStatus[st]++; });
  const total = weekSlots.length;
  const summaryEl = document.getElementById('week-summary');
  if (summaryEl) {
    summaryEl.innerHTML = total === 0
      ? `<span class="ws-empty">Sin sesiones esta semana</span>`
      : `<span class="ws-title">Resumen semanal</span>
        <div class="ws-stats">
          <div class="ws-stat ws-scheduled"><span class="ws-count">${countByStatus.scheduled}</span><span class="ws-label">Programadas</span></div>
          <div class="ws-stat ws-completed"><span class="ws-count">${countByStatus.completed}</span><span class="ws-label">Completadas</span></div>
          <div class="ws-stat ws-pending"><span class="ws-count">${countByStatus.pending}</span><span class="ws-label">Pendientes</span></div>
          <div class="ws-stat ws-cancelled"><span class="ws-count">${countByStatus.cancelled}</span><span class="ws-label">Canceladas</span></div>
          <div class="ws-stat ws-total"><span class="ws-count">${total}</span><span class="ws-label">Total</span></div>
        </div>`;
  }

  // Tick now-line every minute
  clearInterval(window._nowLineTick);
  window._nowLineTick = setInterval(() => {
    const nowLine = calendarEl.querySelector('.cal-now-line');
    if (!nowLine) { clearInterval(window._nowLineTick); return; }
    const now = new Date();
    nowLine.style.top = timeToTopPx(now.getHours(), now.getMinutes()) + 'px';
  }, 60000);
}

// ── Drag-and-drop handlers ────────────────────────────────
window.handleColClick = function (e, dayIdx) {
  // Only fire on bare column click, not on child events
  if (e.target.closest('.cal-event')) return;
  const col     = e.currentTarget;
  const rect    = col.getBoundingClientRect();
  const offsetPx = e.clientY - rect.top;
  const totalMin = offsetPx / PX_PER_MIN;
  const absMin   = CAL_START_H * 60 + totalMin;
  const h = Math.floor(absMin / 60);
  const m = Math.round((absMin % 60) / 15) * 15; // snap to 15 min
  const weekStart = getWeekStart(currentWeek);
  const day = new Date(weekStart);
  day.setDate(day.getDate() + dayIdx);
  const dateStr = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  openSlotModal(null, null, dateStr, h, m);
};

window.handleDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
};

window.handleDragLeave = function (e) {
  e.currentTarget.classList.remove('drag-over');
};

window.handleDrop = async function (e, dayIdx) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragSlotId) return;

  const s = slots.find(x => x.id === dragSlotId);
  if (!s) return;

  const col      = e.currentTarget;
  const rect     = col.getBoundingClientRect();
  const offsetPx = e.clientY - rect.top;
  // Subtract the grab offset so the event stays under the cursor where you grabbed it
  const rawMin   = offsetPx / PX_PER_MIN - dragOffsetMin;
  const absMin   = CAL_START_H * 60 + rawMin;
  // Snap to 15 min grid
  const snappedMin = Math.round(absMin / 15) * 15;
  const newH = Math.max(CAL_START_H, Math.min(20, Math.floor(snappedMin / 60)));
  const newM = snappedMin % 60;

  const weekStart = getWeekStart(currentWeek);
  const day = new Date(weekStart);
  day.setDate(day.getDate() + dayIdx);
  const newDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), newH, newM, 0);

  await updateDoc(doc(db, 'slots', s.id), {
    date: Timestamp.fromDate(newDate),
    updatedAt: Timestamp.now(),
  });
  dragSlotId = null;
  showToast('📅 Sesión movida');
};

// ── Slot Modall ────────────────────────────────────────────
window.openSlotModal = function (id, e, prefillDate, prefillHour, prefillMin) {
  if (e) e.stopPropagation();
  editingSlot = id ? slots.find(s => s.id === id) : null;

  $('modal-slot-title').textContent = editingSlot ? 'Editar Sesión' : 'Nueva Sesión';
  $('slot-id').value = editingSlot?.id || '';

  // Populate client select
  const clientSel = $('s-client');
  clientSel.innerHTML = '<option value="">— Selecciona cliente —</option>' +
    clients.filter(c => c.active).map(c =>
      `<option value="${c.id}" ${editingSlot?.clientId === c.id ? 'selected' : ''}>
        ${esc(c.name)} ${c.paymentType === 'bono' ? `(${c.sessionsLeft || 0} ses.)` : ''}
      </option>`
    ).join('');

  // Populate hour + minute selects
  const hourSel = $('s-hour');
  const minSel  = $('s-min');
  const editH = editingSlot ? toDate(editingSlot.date).getHours()   : (prefillHour ?? 9);
  const editM = editingSlot ? toDate(editingSlot.date).getMinutes() : (prefillMin  ?? 0);
  hourSel.innerHTML = HOURS.map(h =>
    `<option value="${h}" ${editH === h ? 'selected' : ''}>${String(h).padStart(2,'0')}</option>`
  ).join('');
  minSel.innerHTML = [0,15,30,45].map(m =>
    `<option value="${m}" ${editM === m || (editM > 0 && editM < 15 && m === 0) ? 'selected' : ''}>${String(m).padStart(2,'0')}</option>`
  ).join('');

  if (editingSlot) {
    const d = toDate(editingSlot.date);
    $('s-type').value     = editingSlot.type || 'client';
    $('s-date').value     = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    $('s-duration').value = editingSlot.duration || 60;
    $('s-notes').value    = editingSlot.notes || '';
    $('s-status').value   = editingSlot.status || 'scheduled';
    $('s-title').value    = editingSlot.title || '';
    $('slot-status-group').style.display = 'block';
    $('repeat-section').style.display = 'none';
    show('btn-delete-slot');
    if (editingSlot.clientId && editingSlot.status !== 'completed') show('btn-complete-slot');
    else hide('btn-complete-slot');
  } else {
    $('s-type').value     = 'client';
    $('s-date').value     = prefillDate || '';
    $('s-duration').value = 60;
    $('s-notes').value    = '';
    $('s-status').value   = 'scheduled';
    $('s-title').value    = '';
    $('slot-status-group').style.display = 'none';
    $('repeat-section').style.display = 'block';
    hide('btn-delete-slot');
    hide('btn-complete-slot');
    // Reset repetición
    $('s-repeat').checked = false;
    hide('repeat-box');
    // Desmarcar todos los días
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected'));
    // Pre-seleccionar el día de la fecha elegida
    if (prefillDate) {
      const [y, m, d] = prefillDate.split('-').map(Number);
      const wd = new Date(y, m-1, d).getDay();
      const btn = document.querySelector(`.day-btn[data-day="${wd}"]`);
      if (btn) btn.classList.add('selected');
    }
  }
  toggleSlotFields();
  show('modal-slot');
};

window.toggleSlotFields = function () {
  const type = $('s-type').value;
  toggleClass('slot-client-group', 'hidden', type !== 'client');
  toggleClass('slot-title-group',  'hidden', type === 'client');
};

window.toggleRepeatBox = function () {
  const checked = $('s-repeat').checked;
  toggleClass('repeat-box', 'hidden', !checked);
};

window.toggleDayBtn = function (btn) {
  btn.classList.toggle('selected');
};

// Bind day buttons + preview update
document.getElementById('days-picker').addEventListener('click', e => {
  const btn = e.target.closest('.day-btn');
  if (btn) { btn.classList.toggle('selected'); updateRepeatPreview(); }
});

window.updateRepeatPreview = function () {
  const preview = document.getElementById('repeat-preview');
  if (!preview) return;
  const total = parseInt($('s-weeks')?.value || 12);
  const nDays = document.querySelectorAll('.day-btn.selected').length;
  if (nDays === 0) { preview.textContent = ''; return; }
  const perDay   = Math.floor(total / nDays);
  const rem      = total % nDays;
  const weekSpan = Math.ceil(total / nDays);
  const NAMES = { 0:'Dom',1:'Lun',2:'Mar',3:'Mié',4:'Jue',5:'Vie',6:'Sáb' };
  const dayNames = Array.from(document.querySelectorAll('.day-btn.selected'))
    .map(b => NAMES[b.dataset.day]).join(' + ');
  if (nDays === 1) {
    preview.textContent = `→ ${total} ${dayNames} · ~${weekSpan} semanas`;
  } else {
    if (rem === 0) {
      preview.textContent = `→ ${perDay} × ${dayNames} = ${total} sesiones · ~${weekSpan} semanas`;
    } else {
      preview.textContent = `→ ${total} sesiones entre ${dayNames} · ~${weekSpan} semanas`;
    }
  }
};

// ── Save Slot ─────────────────────────────────────────────
window.saveSlot = async function () {
  const type    = $('s-type').value;
  const dateStr = $('s-date').value;
  const hour    = parseInt($('s-hour').value);
  const min     = parseInt($('s-min')?.value || 0);
  if (!dateStr) { alert('Selecciona una fecha'); return; }

  const [y, m, d] = dateStr.split('-').map(Number);
  const baseDate  = new Date(y, m-1, d, hour, min, 0);

  const baseData = {
    type,
    clientId:  type === 'client' ? ($('s-client').value || null) : null,
    title:     type !== 'client' ? $('s-title').value.trim() : '',
    duration:  parseInt($('s-duration').value),
    notes:     $('s-notes').value.trim(),
    status:    editingSlot ? $('s-status').value : 'scheduled',
    updatedAt: Timestamp.now(),
  };

  if (editingSlot) {
    baseData.date = Timestamp.fromDate(new Date(y, m-1, d, hour, min, 0));
    await updateDoc(doc(db, 'slots', editingSlot.id), baseData);
    closeModalSlot();
    showToast('✅ Sesión actualizada');
    return;
  }

  // ── Nueva sesión ──────────────────────────────────────
  const isRepeat = $('s-repeat').checked;

  if (!isRepeat) {
    await addDoc(collection(db, 'slots'), {
      ...baseData,
      date: Timestamp.fromDate(baseDate),
      createdAt: Timestamp.now(),
    });
  } else {
    // ── Repetición: N ocurrencias totales entre los días seleccionados ──
    // Ejemplo: 12 ocurrencias con Mar+Jue → 6 martes + 6 jueves = 12 sesiones
    const totalOccurrences = parseInt($('s-weeks').value) || 12;
    const selectedDays = Array.from(document.querySelectorAll('.day-btn.selected'))
      .map(b => parseInt(b.dataset.day)); // JS: 0=Dom,1=Lun,...,6=Sáb

    if (selectedDays.length === 0) {
      alert('Selecciona al menos un día de la semana para repetir.');
      return;
    }

    // Ordenar días lunes→domingo para recorrerlos en orden dentro de cada semana
    const sortedDays = [...selectedDays].sort((a, b) => {
      const toMon = x => x === 0 ? 7 : x; // Dom=0 → 7 (al final)
      return toMon(a) - toMon(b);
    });

    const dates = [];
    const monday = getWeekStart(baseDate); // Lunes de la semana inicial
    let week = 0;

    while (dates.length < totalOccurrences && week < 500) {
      for (const wd of sortedDays) {
        if (dates.length >= totalOccurrences) break;
        // Offset desde el lunes: Lun=1→0, Mar=2→1,…, Dom=0→6
        const offset = wd === 0 ? 6 : wd - 1;
        const target = new Date(monday);
        target.setDate(target.getDate() + week * 7 + offset);
        target.setHours(hour, min, 0, 0);
        // No incluir fechas anteriores a la fecha base
        if (target < baseDate) continue;
        dates.push(new Date(target));
      }
      week++;
    }

    const groupId = `group_${Date.now()}`;
    for (const dt of dates) {
      await addDoc(collection(db, 'slots'), {
        ...baseData,
        date: Timestamp.fromDate(dt),
        createdAt: Timestamp.now(),
        repeatGroupId: groupId,
        repeatTotal: dates.length,
      });
    }
    showToast(`✅ ${dates.length} sesiones creadas`);
    closeModalSlot();
    return;
  }

  closeModalSlot();
  showToast('✅ Sesión guardada');
};

window.deleteSlot = async function () {
  if (!editingSlot) return;
  if (!confirm('¿Eliminar esta sesión?')) return;
  await deleteDoc(doc(db, 'slots', editingSlot.id));
  closeModalSlot();
  showToast('🗑️ Sesión eliminada', 'info');
};

window.completeSlot = async function () {
  if (!editingSlot) return;
  if (!confirm('¿Marcar como completada? Se descontará una sesión del bono.')) return;
  await updateDoc(doc(db, 'slots', editingSlot.id), { status: 'completed', updatedAt: Timestamp.now() });
  const client = clients.find(c => c.id === editingSlot.clientId);
  if (client && client.paymentType === 'bono' && (client.sessionsLeft || 0) > 0) {
    await updateDoc(doc(db, 'clients', client.id), { sessionsLeft: client.sessionsLeft - 1 });
  }
  closeModalSlot();
  showToast('☑️ Sesión completada');
};

window.closeModalSlot = function (e) {
  if (e && e.target !== $('modal-slot')) return;
  hide('modal-slot');
  editingSlot = null;
};

// ═══════════════════════════════════════════════════════════
//  PAGOS
// ═══════════════════════════════════════════════════════════
window.changeMonth = function (dir) {
  currentMonth = new Date(currentMonth);
  currentMonth.setMonth(currentMonth.getMonth() + dir);
  renderPagos();
};

// ── Payment selection state ───────────────────────────────
let selectedPaymentIds = new Set();

function updateSelectionBadge() {
  const badge = document.getElementById('selection-badge');
  if (!badge) return;
  const n = selectedPaymentIds.size;
  if (n > 0) {
    badge.textContent = `${n} seleccionado${n > 1 ? 's' : ''}`;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function togglePaymentSelection(e, id) {
  e.stopPropagation();
  if (selectedPaymentIds.has(id)) {
    selectedPaymentIds.delete(id);
  } else {
    selectedPaymentIds.add(id);
  }
  const row = document.querySelector(`.payment-row[data-id="${id}"]`);
  if (row) row.classList.toggle('selected', selectedPaymentIds.has(id));
  updateSelectionBadge();
}

window.exportPaymentsCSV = function () {
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  const monthPayments = payments.filter(p => {
    const d = toDate(p.date);
    return d.getFullYear() === y && d.getMonth() === m;
  });

  // Export selected rows if any, otherwise export all visible
  const toExport = selectedPaymentIds.size > 0
    ? monthPayments.filter(p => selectedPaymentIds.has(p.id))
    : monthPayments;

  if (toExport.length === 0) { alert('No hay pagos para exportar'); return; }

  const headers = ['Fecha', 'Cliente', 'Concepto', 'Importe (€)', 'Sesiones', 'Notas'];
  const rows = toExport.map(p => {
    const client = clients.find(c => c.id === p.clientId);
    const name   = client ? client.name : 'Cliente desconocido';
    const d      = toDate(p.date).toLocaleDateString('es-ES');
    const concept = conceptLabel(p.concept);
    const amount  = (p.amount || 0).toFixed(2);
    const sessions = p.concept === 'bono' ? (p.sessions || 0) : '';
    const notes   = (p.notes || '').replace(/"/g, '""');
    return `"${d}","${name}","${concept}","${amount}","${sessions}","${notes}"`;
  });

  const monthStr = currentMonth.toLocaleDateString('es-ES', { month:'long', year:'numeric' });
  const csvContent = [headers.join(','), ...rows].join('\n');
  const bom = '\uFEFF'; // UTF-8 BOM for Excel
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `pagos_${monthStr.replace(/ /g, '_')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

function renderPagos() {
  if (!dataLoaded.clients || !dataLoaded.payments) return;
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  $('month-label').textContent = currentMonth.toLocaleDateString('es-ES', { month:'long', year:'numeric' });

  // Reset selection on month change
  selectedPaymentIds.clear();

  const monthPayments = payments.filter(p => {
    const d = toDate(p.date);
    return d.getFullYear() === y && d.getMonth() === m;
  });

  const total     = monthPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const numBonos  = monthPayments.filter(p => p.concept === 'bono').length;
  const numOthers = monthPayments.filter(p => p.concept !== 'bono').length;

  $('payments-summary').innerHTML = `
    <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">${total.toFixed(0)}€</div><div class="stat-label">Total del mes</div></div>
    <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-value">${numBonos}</div><div class="stat-label">Bonos renovados</div></div>
    <div class="stat-card"><div class="stat-icon">🧾</div><div class="stat-value">${monthPayments.length}</div><div class="stat-label">Pagos totales</div></div>
    <div class="stat-card"><div class="stat-icon">📋</div><div class="stat-value">${numOthers}</div><div class="stat-label">Otros pagos</div></div>
  `;

  const listEl = $('payments-list');
  let html = `<div class="payments-toolbar">
    <div class="payments-toolbar-left">
      <button class="btn btn-primary btn-sm" onclick="openPaymentModal()">+ Registrar pago</button>
      <span class="selection-badge" id="selection-badge"></span>
    </div>
    <div class="payments-toolbar-right">
      <button class="btn btn-outline btn-sm btn-export" onclick="exportPaymentsCSV()" title="Exportar CSV del mes">
        ⬇️ Exportar CSV
      </button>
    </div>
  </div>`;

  if (monthPayments.length === 0) {
    html += `<div class="empty-state"><span>💳</span><p>Sin pagos este mes</p></div>`;
  } else {
    html += monthPayments.map(p => {
      const client = clients.find(c => c.id === p.clientId);
      const name   = client ? client.name : 'Cliente desconocido';
      const d      = toDate(p.date);
      const isSelected = selectedPaymentIds.has(p.id);
      return `<div class="payment-row${isSelected ? ' selected' : ''}" data-id="${p.id}" onclick="openPaymentModal('${p.id}')">
        <div class="payment-checkbox-wrap" onclick="togglePaymentSelection(event, '${p.id}')">
          <input type="checkbox" class="payment-checkbox" ${isSelected ? 'checked' : ''} tabindex="-1" />
        </div>
        <div class="payment-icon">💳</div>
        <div class="payment-info">
          <strong>${esc(name)}</strong>
          <span>${conceptLabel(p.concept)}${p.notes ? ' — ' + esc(p.notes) : ''}</span>
        </div>
        <div class="payment-date">${d.toLocaleDateString('es-ES', { day:'numeric', month:'short' })}</div>
        <div class="payment-amount">+${(p.amount || 0).toFixed(0)}€</div>
      </div>`;
    }).join('');
  }
  listEl.innerHTML = html;
}

// ── Payment Modal ─────────────────────────────────────────
window.openPaymentModal = function (id) {
  editingPayment = id ? payments.find(p => p.id === id) : null;

  const clientSel = $('p-client');
  clientSel.innerHTML = '<option value="">— Selecciona cliente —</option>' +
    clients.map(c => `<option value="${c.id}" ${editingPayment?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  $('payment-id').value = editingPayment?.id || '';
  $('p-amount').value   = editingPayment?.amount || '';
  $('p-date').value     = editingPayment
    ? toDateInput(toDate(editingPayment.date))
    : toDateInput(new Date());
  $('p-concept').value  = editingPayment?.concept || 'bono';
  $('p-sessions').value = editingPayment?.sessions || 10;
  $('p-notes').value    = editingPayment?.notes || '';

  toggleClass('btn-delete-payment', 'hidden', !editingPayment);
  togglePBonoGroup();
  show('modal-payment');
};

function togglePBonoGroup() {
  const isBono = $('p-concept').value === 'bono';
  toggleClass('p-bono-group', 'hidden', !isBono);
}
document.getElementById('p-concept').addEventListener('change', togglePBonoGroup);

window.savePayment = async function () {
  const clientId = $('p-client').value;
  const amount   = parseFloat($('p-amount').value);
  const dateStr  = $('p-date').value;
  if (!clientId) { alert('Selecciona un cliente'); return; }
  if (!amount || isNaN(amount)) { alert('Introduce un importe'); return; }
  if (!dateStr) { alert('Selecciona una fecha'); return; }

  const [y, m, d] = dateStr.split('-').map(Number);
  const concept  = $('p-concept').value;
  const sessions = parseInt($('p-sessions').value) || 10;

  const data = {
    clientId,
    amount,
    date:      Timestamp.fromDate(new Date(y, m-1, d)),
    concept,
    sessions:  concept === 'bono' ? sessions : 0,
    notes:     $('p-notes').value.trim(),
    updatedAt: Timestamp.now(),
  };

  if (editingPayment) {
    await updateDoc(doc(db, 'payments', editingPayment.id), data);
  } else {
    data.createdAt = Timestamp.now();
    await addDoc(collection(db, 'payments'), data);
    if (concept === 'bono') {
      const client = clients.find(c => c.id === clientId);
      if (client) {
        await updateDoc(doc(db, 'clients', clientId), {
          sessionsLeft: (client.sessionsLeft || 0) + sessions,
          bonoSize: sessions,
          totalPaid: (client.totalPaid || 0) + amount,
        });
      }
    } else {
      const client = clients.find(c => c.id === clientId);
      if (client) {
        await updateDoc(doc(db, 'clients', clientId), {
          totalPaid: (client.totalPaid || 0) + amount,
        });
      }
    }
  }
  closeModalPayment();
  showToast('✅ Pago registrado');
};

window.deletePayment = async function () {
  if (!editingPayment) return;
  if (!confirm('¿Eliminar este pago?')) return;
  await deleteDoc(doc(db, 'payments', editingPayment.id));
  closeModalPayment();
  showToast('🗑️ Pago eliminado', 'info');
};

window.closeModalPayment = function (e) {
  if (e && e.target !== $('modal-payment')) return;
  hide('modal-payment');
  editingPayment = null;
};

// ═══════════════════════════════════════════════════════════
//  BADGES
// ═══════════════════════════════════════════════════════════
function updateBadges(count) {
  if (count === undefined) {
    count = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= 2).length;
  }
  const els = [$('nav-badge'), $('topbar-badge'), $('bottom-badge')];
  els.forEach(el => {
    if (!el) return;
    if (count > 0) { el.textContent = count; el.classList.remove('hidden'); }
    else { el.classList.add('hidden'); }
  });
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
function $ (id)         { return document.getElementById(id); }
function val (id)       { return $(id)?.value || ''; }
function show (id)      { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide (id)      { const el = $(id); if (el) el.classList.add('hidden'); }
function toggleClass(id, cls, force) { const el = $(id); if (el) el.classList.toggle(cls, force); }
function esc (str)      { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toDate (v)     { return v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v)); }
function isToday (d)    { const t = new Date(); return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth()&&d.getDate()===t.getDate(); }
function isThisWeek(d)  { const ws = getWeekStart(new Date()); const we = new Date(ws); we.setDate(we.getDate()+6); return d >= ws && d <= we; }
function formatTime(d)  { return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function toDateInput(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function payLabel(t)    { return { bono:'Bono', mensual:'Mensual', individual:'Individual' }[t] || t || 'Bono'; }
function conceptLabel(t){ return { bono:'Renovación de bono', mensual:'Mensualidad', individual:'Sesión individual', otro:'Otro' }[t] || t || '—'; }
function showError(id, msg) { const el=$(id); if(el){el.textContent=msg; el.classList.remove('hidden');} }

function statusIcon(status) {
  return { scheduled:'⏳', completed:'✅', pending:'🔶', cancelled:'❌' }[status] || '⏳';
}
function statusLabel(status) {
  return { scheduled:'Programada', completed:'Completada', pending:'Pendiente confirmación', cancelled:'Cancelada' }[status] || 'Programada';
}
