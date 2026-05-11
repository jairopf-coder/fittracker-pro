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

  $('dash-date').textContent = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
  const activeClients = clients.filter(c => c.active);
  const totalRevenue  = payments.reduce((s, p) => s + (p.amount || 0), 0);

  // Alerts: bonos con ≤2 sesiones
  const alerts = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= 2);
  updateBadges(alerts.length);

  const alertsEl = $('dash-alerts');
  if (alerts.length === 0) {
    alertsEl.innerHTML = '';
  } else {
    alertsEl.innerHTML = `
      <div class="alert-section">
        <div class="alert-section-title">🔔 Alertas de renovación</div>
        ${alerts.map(c => `
          <div class="alert-card ${c.sessionsLeft === 0 ? 'alert-danger' : 'alert-warning'}">
            <span class="alert-icon">${c.sessionsLeft === 0 ? '🚨' : '⚠️'}</span>
            <div>
              <strong>${esc(c.name)}</strong>
              ${c.sessionsLeft === 0
                ? ' — Sin sesiones. ¡Necesita renovar!'
                : ` — Solo quedan ${c.sessionsLeft} sesión${c.sessionsLeft !== 1 ? 'es' : ''}`}
            </div>
            <button class="btn btn-sm btn-outline" onclick="openClientModal('${c.id}')">Ver</button>
          </div>
        `).join('')}
      </div>`;
  }

  // Contar sesiones de hoy (excluye canceladas)
  const todaySlots = slots.filter(s => {
    const d = toDate(s.date);
    return isToday(d) && s.status !== 'cancelled';
  });
  const weekSlots = slots.filter(s => {
    const d = toDate(s.date);
    return isThisWeek(d) && s.status !== 'cancelled';
  });

  // Trend: sesiones esta semana vs semana anterior
  const prevWeekStart = getWeekStart(new Date()); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd   = new Date(prevWeekStart); prevWeekEnd.setDate(prevWeekEnd.getDate() + 6);
  const prevWeekSlots = slots.filter(s => { const d = toDate(s.date); return d >= prevWeekStart && d <= prevWeekEnd && s.status !== 'cancelled'; });
  const prevMonthRevenue = payments.filter(p => { const d = toDate(p.date); const n = new Date(); return d.getMonth() === (n.getMonth() === 0 ? 11 : n.getMonth()-1); }).reduce((s,p) => s+(p.amount||0), 0);

  function trendHtml(curr, prev, unit='') {
    if (prev === 0 && curr === 0) return `<span class="stat-trend flat">— sin datos</span>`;
    if (prev === 0) return `<span class="stat-trend up">▲ nuevo</span>`;
    const diff = curr - prev;
    const pct  = Math.round(Math.abs(diff / prev) * 100);
    if (diff > 0) return `<span class="stat-trend up">▲ +${pct}% vs anterior</span>`;
    if (diff < 0) return `<span class="stat-trend down">▼ −${pct}% vs anterior</span>`;
    return `<span class="stat-trend flat">= igual que antes</span>`;
  }

  $('dash-stats').innerHTML = `
    <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-value">${activeClients.length}</div><div class="stat-label">Clientes activos</div></div>
    <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-value">${todaySlots.length}</div><div class="stat-label">Sesiones hoy</div></div>
    <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-value">${weekSlots.length}</div><div class="stat-label">Esta semana</div>${trendHtml(weekSlots.length, prevWeekSlots.length)}</div>
    <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">${totalRevenue.toFixed(0)}€</div><div class="stat-label">Total facturado</div>${trendHtml(totalRevenue, prevMonthRevenue)}</div>
  `;

  // Today sessions (incluye pendientes y canceladas para visibilidad)
  const todayAll = slots.filter(s => isToday(toDate(s.date)));
  const todayEl = $('dash-today');
  if (todayAll.length === 0) {
    todayEl.innerHTML = `<div class="empty-state"><span>🏖️</span><p>Sin sesiones hoy</p></div>`;
  } else {
    todayEl.innerHTML = `<div class="session-list">
      ${todayAll.sort((a,b) => toDate(a.date)-toDate(b.date)).map(s => {
        const client = clients.find(c => c.id === s.clientId);
        const name   = client ? client.name : (s.title || 'Bloqueado');
        const icon   = statusIcon(s.status);
        const cls    = s.status === 'completed' ? 'completed' : s.status === 'pending' ? 'pending' : s.status === 'cancelled' ? 'cancelled' : '';
        return `<div class="session-item ${cls}">
          <div class="session-time">${formatTime(toDate(s.date))}</div>
          <div class="session-info">
            <strong>${esc(name)}</strong>
            <span>${statusLabel(s.status)}${s.notes ? ' · ' + esc(s.notes) : ''}</span>
          </div>
          <div class="session-status">${icon}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  // Bonos
  const bonosEl = $('dash-bonos');
  const bonoClients = activeClients.filter(c => c.paymentType === 'bono').slice(0, 8);
  if (bonoClients.length === 0) {
    bonosEl.innerHTML = `<div class="empty-state"><span>📦</span><p>Sin clientes con bono</p></div>`;
  } else {
    bonosEl.innerHTML = bonoClients.map(c => {
      const pct  = Math.min(100, ((c.sessionsLeft || 0) / (c.bonoSize || 10)) * 100);
      const color = (c.sessionsLeft || 0) <= 2 ? 'var(--red)' : (c.sessionsLeft || 0) <= 4 ? 'var(--orange)' : 'var(--green)';
      return `<div class="bono-card" onclick="openClientDetail('${c.id}')">
        <div class="bono-avatar" style="background:${avatarColor(c.name)}">${c.name.charAt(0).toUpperCase()}</div>
        <div class="bono-info">
          <strong>${esc(c.name)}</strong>
          <div class="bono-bar-wrap"><div class="bono-bar" style="width:${pct}%;background:${color}"></div></div>
          <span class="bono-count">${c.sessionsLeft || 0} / ${c.bonoSize || 10} sesiones</span>
        </div>
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

  const grid = $('calendar-grid');
  const today = new Date(); today.setHours(0,0,0,0);
  const DAYS_ES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

  let html = `<div class="cal-corner"></div>`;
  days.forEach((d, i) => {
    const isT = d.getTime() === today.getTime();
    html += `<div class="cal-day-header ${isT ? 'today' : ''}">
      <span class="day-name">${DAYS_ES[i]}</span>
      <span class="day-number">${d.getDate()}</span>
    </div>`;
  });

  HOURS.forEach(hour => {
    html += `<div class="cal-time">${hour}:00</div>`;
    days.forEach((day, dayIdx) => {
      const cellSlots = slots.filter(s => {
        const sd = toDate(s.date);
        return sd.getFullYear() === day.getFullYear()
            && sd.getMonth()    === day.getMonth()
            && sd.getDate()     === day.getDate()
            && sd.getHours()    === hour;
        // Nota: mostramos TODOS los estados, incluyendo canceladas (con estilo diferente)
      });
      const isT = day.getTime() === today.getTime();
      html += `<div class="cal-cell ${isT ? 'today-col' : ''}" onclick="handleCellClick(${dayIdx},${hour},event)">
        ${cellSlots.map(s => {
          const client = clients.find(c => c.id === s.clientId);
          const label  = client ? client.name : (s.title || 'Bloqueado');
          const status = s.status || 'scheduled';
          const statusCls = status === 'completed' ? 'status-completed'
                          : status === 'pending'   ? 'status-pending'
                          : status === 'cancelled' ? 'status-cancelled'
                          : '';
          const dur = s.duration || 60;
          const startTime = formatTime(toDate(s.date));
          const endDate = new Date(toDate(s.date).getTime() + dur * 60000);
          const endTime = formatTime(endDate);
          return `<div class="cal-event type-${s.type || 'client'} ${statusCls}"
            onclick="openSlotModal('${s.id}',event)"
            data-tooltip-name="${esc(label)}"
            data-tooltip-time="${startTime} – ${endTime}"
            data-tooltip-dur="${dur} min"
            data-tooltip-status="${esc(statusLabel(status))}"
            style="height:${Math.max(20, dur / 60 * 52 - 4)}px">
            <span class="ev-label">${esc(label)}</span>
          </div>`;
        }).join('')}
      </div>`;
    });
  });

  grid.innerHTML = html;

  // ── Week summary ──────────────────────────────────────────
  const weekEnd = new Date(days[6]); weekEnd.setHours(23,59,59,999);
  const weekStart2 = new Date(days[0]); weekStart2.setHours(0,0,0,0);
  const weekSlots = slots.filter(s => {
    const d = toDate(s.date);
    return d >= weekStart2 && d <= weekEnd;
  });
  const countByStatus = { scheduled: 0, completed: 0, pending: 0, cancelled: 0 };
  weekSlots.forEach(s => {
    const st = s.status || 'scheduled';
    if (st in countByStatus) countByStatus[st]++;
  });
  const total = weekSlots.length;
  const summaryEl = document.getElementById('week-summary');
  if (summaryEl) {
    if (total === 0) {
      summaryEl.innerHTML = `<span class="ws-empty">Sin sesiones esta semana</span>`;
    } else {
      summaryEl.innerHTML = `
        <span class="ws-title">Resumen semanal</span>
        <div class="ws-stats">
          <div class="ws-stat ws-scheduled">
            <span class="ws-count">${countByStatus.scheduled}</span>
            <span class="ws-label">Programadas</span>
          </div>
          <div class="ws-stat ws-completed">
            <span class="ws-count">${countByStatus.completed}</span>
            <span class="ws-label">Completadas</span>
          </div>
          <div class="ws-stat ws-pending">
            <span class="ws-count">${countByStatus.pending}</span>
            <span class="ws-label">Pendientes</span>
          </div>
          <div class="ws-stat ws-cancelled">
            <span class="ws-count">${countByStatus.cancelled}</span>
            <span class="ws-label">Canceladas</span>
          </div>
          <div class="ws-stat ws-total">
            <span class="ws-count">${total}</span>
            <span class="ws-label">Total</span>
          </div>
        </div>`;
    }
  }
}

window.handleCellClick = function (dayIdx, hour, e) {
  if (e.target !== e.currentTarget) return;
  const weekStart = getWeekStart(currentWeek);
  const day = new Date(weekStart);
  day.setDate(day.getDate() + dayIdx);
  const dateStr = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  openSlotModal(null, null, dateStr, hour);
};

// ── Slot Modal ────────────────────────────────────────────
window.openSlotModal = function (id, e, prefillDate, prefillHour) {
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

  // Populate hour select
  const hourSel = $('s-hour');
  hourSel.innerHTML = HOURS.map(h =>
    `<option value="${h}" ${(editingSlot ? toDate(editingSlot.date).getHours() : prefillHour) === h ? 'selected' : ''}>${String(h).padStart(2,'0')}:00</option>`
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

// Bind day buttons
document.getElementById('days-picker').addEventListener('click', e => {
  const btn = e.target.closest('.day-btn');
  if (btn) btn.classList.toggle('selected');
});

// ── Save Slot ─────────────────────────────────────────────
window.saveSlot = async function () {
  const type   = $('s-type').value;
  const dateStr = $('s-date').value;
  const hour   = parseInt($('s-hour').value);
  if (!dateStr) { alert('Selecciona una fecha'); return; }

  const [y, m, d] = dateStr.split('-').map(Number);
  const baseDate  = new Date(y, m-1, d, hour, 0, 0);

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
    // Solo actualiza esta sesión
    baseData.date = Timestamp.fromDate(new Date(y, m-1, d, hour, 0, 0));
    await updateDoc(doc(db, 'slots', editingSlot.id), baseData);
    closeModalSlot();
    showToast('✅ Sesión actualizada');
    return;
  }

  // ── Nueva sesión ──────────────────────────────────────
  const isRepeat = $('s-repeat').checked;

  if (!isRepeat) {
    // Sesión única
    await addDoc(collection(db, 'slots'), {
      ...baseData,
      date: Timestamp.fromDate(baseDate),
      createdAt: Timestamp.now(),
    });
  } else {
    // Sesión repetida
    const weeks = parseInt($('s-weeks').value) || 8;
    const selectedDays = Array.from(document.querySelectorAll('.day-btn.selected'))
      .map(b => parseInt(b.dataset.day));

    if (selectedDays.length === 0) {
      alert('Selecciona al menos un día de la semana para repetir.');
      return;
    }

    // Generar todas las fechas: para cada semana, para cada día seleccionado
    const dates = [];
    for (let w = 0; w < weeks; w++) {
      for (const wd of selectedDays) {
        // Calcular la fecha del próximo "wd" a partir de baseDate + w semanas
        const ref = new Date(baseDate);
        ref.setDate(ref.getDate() + w * 7);
        // Ajustar al día de semana correcto dentro de esa semana
        const refWd  = ref.getDay();
        const diff   = wd - refWd;
        const target = new Date(ref);
        target.setDate(target.getDate() + diff);
        target.setHours(hour, 0, 0, 0);
        // Solo incluir si target >= baseDate (no fechas pasadas por el ajuste)
        if (w === 0 && target < baseDate) continue;
        dates.push(new Date(target));
      }
    }

    // Eliminar duplicados y ordenar
    const unique = [...new Map(dates.map(dt => [dt.getTime(), dt])).values()]
      .sort((a, b) => a - b);

    // Guardar en batch (addDoc en secuencia, Firestore free tier no tiene batch write en SDK v9 modular fácilmente)
    const groupId = `group_${Date.now()}`;
    for (const dt of unique) {
      await addDoc(collection(db, 'slots'), {
        ...baseData,
        date: Timestamp.fromDate(dt),
        createdAt: Timestamp.now(),
        repeatGroupId: groupId,
        repeatTotal: unique.length,
      });
    }
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
