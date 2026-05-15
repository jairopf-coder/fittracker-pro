// ═══════════════════════════════════════════════════════════
//  FITTRACKER PRO  — app.js  v4
// ═══════════════════════════════════════════════════════════

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, doc,
         addDoc, setDoc, updateDoc, deleteDoc,
         onSnapshot, query, where, orderBy, Timestamp }
                                   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Init Firebase ───────────────────────────────────────
const app = initializeApp(firebaseConfig);
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

// Track unsaved changes in modal
let slotModalDirty = false;

const unsubs = {};

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
document.addEventListener('DOMContentLoaded', _updateThemeUI);

// ═══════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  // Cmd/Ctrl+K → búsqueda global
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    const overlay = document.getElementById('search-overlay');
    const isOpen  = overlay && !overlay.classList.contains('hidden');
    isOpen ? _dismissSearch() : openSearch();
    return;
  }

  // N → nueva sesión (cuando no hay modal abierto y no se está escribiendo)
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
    const activeTag = document.activeElement?.tagName;
    if (['INPUT','TEXTAREA','SELECT'].includes(activeTag)) return;
    const anyModal = document.querySelector('.modal-overlay:not(.hidden)');
    if (anyModal) return;
    if (currentPage === 'calendario') { openSlotModal(null, null, toDateInput(new Date()), 9, 0); }
    return;
  }

  // Escape → cerrar modales / búsqueda
  if (e.key === 'Escape') {
    const search = document.getElementById('search-overlay');
    if (search && !search.classList.contains('hidden')) { _dismissSearch(); return; }
    // Close topmost open modal
    const modals = ['modal-slot','modal-client','modal-payment','modal-notif-help','modal-recur-action'];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) {
        el.querySelector('.close-btn')?.click();
        return;
      }
    }
  }
});

// ═══════════════════════════════════════════════════════════
//  NOTIFICACIONES
// ═══════════════════════════════════════════════════════════
function _updateNotifUI() {
  const btn   = document.getElementById('notif-toggle-btn');
  const icon  = document.getElementById('notif-icon');
  const track = document.getElementById('notif-track');
  if (!btn || !track) return;
  const permission = 'Notification' in window ? Notification.permission : 'denied';
  const enabled    = localStorage.getItem('notif-enabled') !== '0';
  if (permission === 'denied') {
    if (icon) icon.textContent = '🔕';
    btn.setAttribute('data-denied', 'true');
    btn.setAttribute('data-tooltip', 'Actívalas en tu navegador');
    track.classList.remove('notif-on');
    track.classList.add('notif-denied');
  } else {
    if (icon) icon.textContent = '🔔';
    btn.removeAttribute('data-denied');
    btn.removeAttribute('data-tooltip');
    track.classList.remove('notif-denied');
    if (enabled) { track.classList.add('notif-on'); }
    else { track.classList.remove('notif-on'); }
  }
}

window.toggleNotifications = function () {
  const permission = 'Notification' in window ? Notification.permission : 'denied';
  if (permission === 'denied') return;
  const current = localStorage.getItem('notif-enabled') !== '0';
  localStorage.setItem('notif-enabled', current ? '0' : '1');
  _updateNotifUI();
  scheduleSessionNotifications();
};

window.toggleNotifConfig = function () {
  const panel = document.getElementById('notif-config-panel');
  const arrow = document.getElementById('notif-config-arrow');
  const open  = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'flex';
  if (arrow) arrow.textContent = open ? '▸' : '▾';
};

document.addEventListener('DOMContentLoaded', _updateNotifUI);
document.addEventListener('DOMContentLoaded', loadNotifConfig);

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] registrado, scope:', reg.scope))
      .catch(err => console.warn('[SW] error al registrar:', err));
  }
});

// ═══════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if (user) {
    show('app'); hide('page-login');
    startListeners();
    navigate('dashboard');
    if ('Notification' in window && !localStorage.getItem('notif-asked')) {
      localStorage.setItem('notif-asked', '1');
      Notification.requestPermission().then(() => _updateNotifUI());
    }
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

window.doLogout = async function () { await signOut(auth); };

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ═══════════════════════════════════════════════════════════
//  FIRESTORE LISTENERS
// ═══════════════════════════════════════════════════════════
function startListeners() {
  showSkeletons();
  unsubs.clients = onSnapshot(
    query(collection(db, 'clients'), orderBy('name')),
    snap => { clients = snap.docs.map(d => ({ id: d.id, ...d.data() })); dataLoaded.clients = true; refreshAll(); }
  );
  unsubs.slots = onSnapshot(
    query(collection(db, 'slots'), orderBy('date')),
    snap => { slots = snap.docs.map(d => ({ id: d.id, ...d.data() })); dataLoaded.slots = true; refreshAll(); }
  );
  unsubs.payments = onSnapshot(
    query(collection(db, 'payments'), orderBy('date', 'desc')),
    snap => { payments = snap.docs.map(d => ({ id: d.id, ...d.data() })); dataLoaded.payments = true; refreshAll(); }
  );
}

function stopListeners() {
  Object.values(unsubs).forEach(u => u && u());
  dataLoaded.clients = false; dataLoaded.slots = false; dataLoaded.payments = false;
}

function skeletonGrid(cls, count) {
  return Array(count).fill(`<div class="skeleton ${cls}"></div>`).join('');
}

function showSkeletons() {
  $('dash-stats').innerHTML   = skeletonGrid('skeleton-stat', 4);
  $('dash-today').innerHTML   = skeletonGrid('skeleton-session', 3);
  $('dash-bonos').innerHTML   = skeletonGrid('skeleton-bono', 4);
  $('clients-grid').innerHTML = skeletonGrid('skeleton-client', 6);
  $('calendar-grid').innerHTML = skeletonGrid('skeleton-cal-row', 5);
  $('payments-list').innerHTML = skeletonGrid('skeleton-payment', 5);
  if ($('payments-summary')) $('payments-summary').innerHTML = skeletonGrid('skeleton-stat', 3);
}

function refreshAll() {
  renderDashboard();
  renderClientes();
  renderCalendario();
  renderPagos();
  updateBadges();
  scheduleSessionNotifications();
}

function loadNotifConfig() {
  const minutes   = parseInt(localStorage.getItem('notif-minutes')        || '30', 10);
  const threshold = parseInt(localStorage.getItem('notif-bono-threshold') || '2',  10);
  const selMin = document.getElementById('notif-minutes');
  const selThr = document.getElementById('notif-bono-threshold');
  if (selMin) selMin.value = String(minutes);
  if (selThr) selThr.value = String(threshold);
}

window.saveNotifConfig = function () {
  const selMin = document.getElementById('notif-minutes');
  const selThr = document.getElementById('notif-bono-threshold');
  if (selMin) localStorage.setItem('notif-minutes',        selMin.value);
  if (selThr) localStorage.setItem('notif-bono-threshold', selThr.value);
  scheduleSessionNotifications();
  showToast('Configuración guardada', 'success');
};

window.openNotifHelp = function () {
  const modal = document.getElementById('modal-notif-help');
  if (modal) modal.classList.remove('hidden');
};
window.closeNotifHelp = function (e) {
  if (e && e.target !== document.getElementById('modal-notif-help')) return;
  const modal = document.getElementById('modal-notif-help');
  if (modal) modal.classList.add('hidden');
};

// ═══════════════════════════════════════════════════════════
//  NOTIFICACIONES LOCALES
// ═══════════════════════════════════════════════════════════
async function scheduleSessionNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('notif-enabled') === '0') return;
  if (!('serviceWorker' in navigator)) return;
  const swReg = await navigator.serviceWorker.ready.catch(() => null);
  if (!swReg || !swReg.active) return;
  swReg.active.postMessage({ type: 'CANCEL_ALL_NOTIFICATIONS' });
  const now = new Date();
  const todaySlots = slots.filter(s => isToday(toDate(s.date)) && s.status !== 'cancelled');
  for (const slot of todaySlots) {
    const client = clients.find(c => c.id === slot.clientId);
    const clientName = client ? client.name : 'Cliente';
    const minutesBefore = parseInt(localStorage.getItem('notif-minutes') || '30', 10);
    const [h, m] = (slot.time || '00:00').split(':').map(Number);
    const sessionDate = new Date(); sessionDate.setHours(h, m, 0, 0);
    const notifTime = new Date(sessionDate.getTime() - minutesBefore * 60 * 1000);
    const delay = notifTime.getTime() - now.getTime();
    if (delay > 0) {
      const tag = `session-${slot.id}`;
      const timeLabel = slot.time || `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const minLabel  = minutesBefore >= 60 ? `${minutesBefore / 60}h` : `${minutesBefore} min`;
      swReg.active.postMessage({ type: 'SCHEDULE_NOTIFICATION', delay, title: `FitTracker · en ${minLabel}`, body: `${clientName} · ${timeLabel}`, tag });
    }
  }
  const bonoThreshold = parseInt(localStorage.getItem('notif-bono-threshold') || '2', 10);
  const lowBono = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= bonoThreshold);
  for (const c of lowBono) {
    const left = c.sessionsLeft || 0;
    swReg.active.postMessage({ type: 'SHOW_NOTIFICATION', title: `Bono bajo: ${c.name}`, body: `Solo tiene ${left} sesión${left === 1 ? '' : 'es'} restante${left === 1 ? '' : 's'}`, tag: `bono-${c.id}` });
  }
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
  } else { doSwitch(); }
};

window.toggleSidebar = function () {
  $('sidebar').classList.toggle('open');
  $('sidebar-overlay').classList.toggle('visible');
};
window.closeSidebar = function () {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('visible');
};

// ═══════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════

// Client color derived from name
function clientColor(clientId) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return null;
  return avatarColor(client.name);
}

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

// ═══════════════════════════════════════════════════════════
//  CLIENT DETAIL
// ═══════════════════════════════════════════════════════════
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

  // ── Attendance stats ──────────────────────────────────
  const allClientSlots = slots.filter(s => s.clientId === id);
  const completed  = allClientSlots.filter(s => s.status === 'completed').length;
  const cancelled  = allClientSlots.filter(s => s.status === 'cancelled').length;
  const attendance = allClientSlots.length > 0
    ? Math.round((completed / allClientSlots.length) * 100)
    : 0;

  // ── Streak ────────────────────────────────────────────
  const recentCompleted = allClientSlots
    .filter(s => s.status === 'completed')
    .sort((a, b) => toDate(b.date) - toDate(a.date));
  let streak = 0;
  const now2 = new Date(); now2.setHours(0,0,0,0);
  for (let i = 0; i < recentCompleted.length; i++) {
    const d = toDate(recentCompleted[i].date);
    d.setHours(0,0,0,0);
    if (i === 0 && (now2 - d) > 14 * 86400000) break;
    streak++;
    if (i < recentCompleted.length - 1) {
      const next = toDate(recentCompleted[i+1].date);
      next.setHours(0,0,0,0);
      if ((d - next) > 14 * 86400000) break;
    }
  }

  // ── Next session ──────────────────────────────────────
  const futureSlots = slots
    .filter(s => s.clientId === id && toDate(s.date) >= new Date() && s.status !== 'cancelled')
    .sort((a, b) => toDate(a.date) - toDate(b.date));
  const nextSession = futureSlots[0];

  // ── Inactivity alert ─────────────────────────────────
  const lastSlot = allClientSlots
    .filter(s => s.status === 'completed')
    .sort((a, b) => toDate(b.date) - toDate(a.date))[0];
  const daysSinceLast = lastSlot
    ? Math.floor((new Date() - toDate(lastSlot.date)) / 86400000)
    : null;
  const inactiveAlert = daysSinceLast !== null && daysSinceLast > 14;

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

  const nextHtml = nextSession
    ? `<div class="detail-next-session">
        <span class="detail-next-icon">📅</span>
        <div>
          <div class="detail-next-label">Próxima sesión</div>
          <div class="detail-next-date">${toDate(nextSession.date).toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})} · ${formatTime(toDate(nextSession.date))}</div>
        </div>
      </div>` : '';

  const inactiveHtml = inactiveAlert
    ? `<div class="detail-inactive-alert">⚠️ Sin sesiones completadas en ${daysSinceLast} días</div>` : '';

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
    <div class="page-header page-header--hero">
      <span class="ph-eyebrow">Ficha de cliente</span>
      <div class="ph-top">
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn btn-outline btn-sm" onclick="navigate('clientes')">← Volver</button>
          <h1>${esc(c.name)}</h1>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openClientModal('${c.id}')">✏️ Editar</button>
      </div>
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

    ${inactiveHtml}
    ${nextHtml}
    ${bonoHtml}

    <div class="detail-attendance-row">
      <div class="detail-att-card">
        <div class="detail-att-value">${attendance}%</div>
        <div class="detail-att-label">Asistencia</div>
      </div>
      <div class="detail-att-card">
        <div class="detail-att-value">${completed}</div>
        <div class="detail-att-label">Completadas</div>
      </div>
      <div class="detail-att-card">
        <div class="detail-att-value">${cancelled}</div>
        <div class="detail-att-label">Canceladas</div>
      </div>
      <div class="detail-att-card">
        <div class="detail-att-value">${streak > 0 ? '🔥' + streak : '—'}</div>
        <div class="detail-att-label">Racha</div>
      </div>
    </div>

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
  const bonoThr = parseInt(localStorage.getItem('notif-bono-threshold') || '2', 10);
  const alerts = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= bonoThr);
  updateBadges(alerts.length);

  const todaySlots = slots.filter(s => isToday(toDate(s.date)) && s.status !== 'cancelled');
  if ($('dash-hero-sessions')) $('dash-hero-sessions').textContent = todaySlots.length;

  const alertsEl = $('dash-alerts');
  if (alerts.length === 0) {
    alertsEl.innerHTML = '';
  } else {
    alertsEl.innerHTML = `<button class="dash-alert-pill" onclick="navigate('clientes')">
      <span class="dash-alert-dot"></span>
      ${alerts.length} bono${alerts.length !== 1 ? 's' : ''} bajo
    </button>`;
  }

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
        const canComplete = s.status !== 'completed' && s.status !== 'cancelled' && s.clientId;
        return `<div class="dash-tl-item">
          <span class="dash-tl-dot ${cls}"></span>
          <span class="dash-tl-time">${formatTime(toDate(s.date))}</span>
          <span class="dash-tl-name">${esc(name)}</span>
          <span class="dash-tl-status ${cls}">${statusTxt(s.status)}</span>
          ${canComplete ? `<button class="dash-tl-complete-btn" onclick="quickCompleteSlot('${s.id}')" title="Completar sesión">✓</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  // Charts
  const sesLabels = [], sesCounts = [];
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
      data: { labels: sesLabels, datasets: [{ data: sesCounts, backgroundColor: '#e8ff47', borderRadius: 6, borderSkipped: false }] },
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

  const ingLabels = [], ingTotals = [];
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
      data: { labels: ingLabels, datasets: [{ data: ingTotals, borderColor: '#47b8ff', borderWidth: 2, tension: 0.4, pointRadius: 0, fill: true, backgroundColor: 'rgba(71,184,255,0.10)' }] },
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

  const bonosEl = $('dash-bonos');
  const bonoClients = activeClients.filter(c => c.paymentType === 'bono').slice(0, 6);
  if (bonoClients.length === 0) {
    bonosEl.innerHTML = `<p class="dash-empty">Sin clientes con bono activo</p>`;
  } else {
    const R = 26; const CIRC = 2 * Math.PI * R;
    bonosEl.innerHTML = bonoClients.map(c => {
      const left = c.sessionsLeft || 0; const total = c.bonoSize || 10;
      const pct = Math.min(1, left / total); const offset = CIRC * (1 - pct);
      const color = left <= 2 ? 'var(--red)' : left <= 4 ? 'var(--orange)' : 'var(--green)';
      const pctTxt = Math.round(pct * 100); const firstName = esc(c.name).split(' ')[0];
      return `<div class="dash-ring-item" onclick="openClientDetail('${c.id}')">
        <div style="position:relative;width:64px;height:64px">
          <svg class="dash-ring-svg" width="64" height="64" viewBox="0 0 64 64">
            <circle class="dash-ring-track" cx="32" cy="32" r="${R}"/>
            <circle class="dash-ring-fill" cx="32" cy="32" r="${R}" stroke="${color}" stroke-dasharray="${CIRC}" stroke-dashoffset="${offset}"/>
          </svg>
          <div class="dash-ring-pct" style="color:${color}">${pctTxt}%</div>
        </div>
        <span class="dash-ring-name">${firstName}</span>
        <span class="dash-ring-sessions">${left}/${total}</span>
      </div>`;
    }).join('');
  }
}

// ── Quick complete from dashboard ──────────────────────────
window.quickCompleteSlot = async function (id) {
  const s = slots.find(x => x.id === id);
  if (!s) return;
  if (!confirm('¿Marcar como completada?')) return;
  await updateDoc(doc(db, 'slots', s.id), { status: 'completed', updatedAt: Timestamp.now() });
  const client = clients.find(c => c.id === s.clientId);
  if (client && client.paymentType === 'bono' && (client.sessionsLeft || 0) > 0) {
    await updateDoc(doc(db, 'clients', client.id), { sessionsLeft: client.sessionsLeft - 1 });
  }
  showToast('☑️ Sesión completada');
};

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

let clientView = 'grid'; // 'grid' | 'list'

window.setClientView = function (v) {
  clientView = v;
  $('btn-view-grid').classList.toggle('active', v === 'grid');
  $('btn-view-list').classList.toggle('active', v === 'list');
  const grid = $('clients-grid');
  grid.classList.toggle('clients-list-view', v === 'list');
  renderClientes();
};

window.renderClientes = function () {
  if (!dataLoaded.clients) return;
  const search  = (val('client-search') || '').toLowerCase();
  const sortBy  = ($('client-sort') || {}).value || 'name';
  const bonoThr = parseInt(localStorage.getItem('notif-bono-threshold') || '2', 10);
  const now     = new Date();

  // ── Filter ──────────────────────────────────────────────
  let list = clients.filter(c => {
    const match = c.name.toLowerCase().includes(search) ||
      (c.phone || '').includes(search) ||
      (c.email || '').toLowerCase().includes(search);
    if (clientFilter === 'active') return match && c.active;
    if (clientFilter === 'alert')  return match && c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= bonoThr;
    return match;
  });

  // ── Sort ─────────────────────────────────────────────────
  list = list.slice().sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, 'es');
    if (sortBy === 'next') {
      const nextOf = c => slots.filter(s => s.clientId === c.id && toDate(s.date) >= now && s.status !== 'cancelled').sort((x,y) => toDate(x.date)-toDate(y.date))[0];
      const na = nextOf(a), nb = nextOf(b);
      if (!na && !nb) return a.name.localeCompare(b.name, 'es');
      if (!na) return 1; if (!nb) return -1;
      return toDate(na.date) - toDate(nb.date);
    }
    if (sortBy === 'alert') {
      const alertScore = c => {
        if (c.paymentType !== 'bono') return 999;
        const left = c.sessionsLeft || 0;
        if (left < 0) return -1;   // deuda
        if (left === 0) return 0;
        if (left <= bonoThr) return left;
        return 100 + left;
      };
      return alertScore(a) - alertScore(b);
    }
    if (sortBy === 'inactive') {
      const lastOf = c => slots.filter(s => s.clientId === c.id && s.status === 'completed').sort((x,y) => toDate(y.date)-toDate(x.date))[0];
      const la = lastOf(a), lb = lastOf(b);
      if (!la && !lb) return a.name.localeCompare(b.name, 'es');
      if (!la) return -1; if (!lb) return 1;
      return toDate(la.date) - toDate(lb.date);
    }
    return 0;
  });

  // ── Meta counter ─────────────────────────────────────────
  const metaEl = $('clients-meta');
  if (metaEl) {
    const active  = list.filter(c => c.active).length;
    const alerts  = list.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= bonoThr).length;
    const debt    = list.filter(c => c.paymentType === 'bono' && (c.sessionsLeft || 0) < 0).length;
    let metaHtml  = `<span>${list.length} cliente${list.length !== 1 ? 's' : ''}</span>`;
    if (active < list.length) metaHtml += `<span class="meta-dot">·</span><span>${active} activos</span>`;
    if (debt > 0)   metaHtml += `<span class="meta-dot">·</span><span class="meta-debt">⛔ ${debt} con deuda</span>`;
    else if (alerts > 0) metaHtml += `<span class="meta-dot">·</span><span class="meta-alert">⚠️ ${alerts} en alerta</span>`;
    metaEl.innerHTML = metaHtml;
  }

  const el = $('clients-grid');
  el.classList.toggle('clients-list-view', clientView === 'list');

  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span>👥</span><p>No hay clientes todavía</p><button class="btn btn-primary btn-sm" onclick="openClientModal()">+ Añadir primer cliente</button></div>`;
    return;
  }

  // ── Separate active / inactive ────────────────────────────
  const activeList   = list.filter(c => c.active);
  const inactiveList = list.filter(c => !c.active);

  function buildCard(c) {
    const color    = avatarColor(c.name);
    const initials = c.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

    // ── Stats ────────────────────────────────────────────
    const completedSlots = slots.filter(s => s.clientId === c.id && s.status === 'completed');
    const totalSessions  = completedSlots.length;
    const totalRevenue   = payments.filter(p => p.clientId === c.id).reduce((s, p) => s + (p.amount || 0), 0);

    // ── Inactivity ───────────────────────────────────────
    const lastSlot  = completedSlots.sort((a,b) => toDate(b.date)-toDate(a.date))[0];
    const daysSince = lastSlot ? Math.floor((now - toDate(lastSlot.date)) / 86400000) : null;
    const isInactive = daysSince !== null && daysSince > 14;

    // ── Next session ─────────────────────────────────────
    const nextSl = slots.filter(s => s.clientId === c.id && toDate(s.date) >= now && s.status !== 'cancelled').sort((a,b) => toDate(a.date)-toDate(b.date))[0];
    const nextStr = nextSl ? toDate(nextSl.date).toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'}) : null;

    // ── Bono logic ───────────────────────────────────────
    let bonoHtml = '';
    if (c.paymentType === 'bono') {
      const left    = c.sessionsLeft || 0;
      const size    = c.bonoSize    || 10;
      const isDebt  = left < 0;   // sesiones hechas sin renovar

      // Color scheme
      let barColor, badgeClass, badgeLabel;
      if (isDebt) {
        barColor   = 'var(--red)';
        badgeClass = 'bono-badge-debt';
        badgeLabel = `⛔ ${Math.abs(left)} pendiente${Math.abs(left)>1?'s':''} de renovar`;
      } else if (left === 0) {
        barColor   = 'var(--red)';
        badgeClass = 'bono-badge-empty';
        badgeLabel = '🔴 Bono agotado · Renovar';
      } else if (left <= bonoThr) {
        barColor   = 'var(--orange)';
        badgeClass = 'bono-badge-low';
        badgeLabel = `⚠️ ${left} ses. restante${left > 1 ? 's' : ''}`;
      } else {
        barColor   = 'var(--green)';
        badgeClass = 'bono-badge-ok';
        badgeLabel = `✅ ${left} ses. restantes`;
      }

      // Progress bar: if debt, show full red bar; else pct consumed
      const pct = isDebt ? 100 : Math.max(0, Math.round((left / size) * 100));

      bonoHtml = `
        <div class="card-bono-wrap">
          <div class="card-bono-bar-bg">
            <div class="card-bono-bar" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <span class="card-bono-badge ${badgeClass}">${badgeLabel}</span>
        </div>`;
    }

    // ── Tags row ─────────────────────────────────────────
    const statusTag   = c.active ? `<span class="tag tag-active">Activo</span>` : `<span class="tag tag-inactive">Inactivo</span>`;
    const payTag      = `<span class="tag tag-${c.paymentType || 'bono'}">${payLabel(c.paymentType)}</span>`;
    const inactiveTag = isInactive ? `<span class="tag tag-inactive" title="${daysSince} días sin sesión">💤 ${daysSince}d sin sesión</span>` : '';

    // ── Stats row ─────────────────────────────────────────
    const statsHtml = `<div class="card-stats-row">
      <span class="card-stat">🏋️ ${totalSessions} ses.</span>
      <span class="card-stat">💶 ${totalRevenue.toLocaleString('es-ES')} €</span>
      ${nextStr ? `<span class="card-stat">📅 ${nextStr}</span>` : ''}
    </div>`;

    return `<div class="client-card${!c.active ? ' client-card--inactive' : ''}" onclick="openClientDetail('${c.id}')">
      <div class="client-avatar" style="background:${color}">${initials}</div>
      <div class="client-info">
        <div class="client-card-top">
          <h3>${esc(c.name)}</h3>
          <button class="card-edit-btn" onclick="event.stopPropagation();openClientModal('${c.id}')" title="Editar">✏️</button>
        </div>
        <p>${esc(c.phone || c.email || '—')}</p>
        <div class="client-tags">${statusTag}${payTag}${inactiveTag}</div>
        ${bonoHtml}
        ${statsHtml}
      </div>
    </div>`;
  }

  let html = activeList.map(buildCard).join('');
  if (inactiveList.length > 0) {
    html += `<div class="clients-section-divider" style="grid-column:1/-1">
      <span>Inactivos (${inactiveList.length})</span>
    </div>`;
    html += inactiveList.map(buildCard).join('');
  }
  el.innerHTML = html;
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
    name, phone: $('c-phone').value.trim(), email: $('c-email').value.trim(),
    paymentType: $('c-payment-type').value, bonoSize: parseInt($('c-bono-size').value) || 10,
    sessionsLeft: parseInt($('c-sessions-left').value) || 0, notes: $('c-notes').value.trim(),
    active: $('c-active').checked, updatedAt: Timestamp.now(),
  };
  if (editingClient) {
    await updateDoc(doc(db, 'clients', editingClient.id), data);
  } else {
    data.createdAt = Timestamp.now(); data.totalPaid = 0;
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
  hide('modal-client'); editingClient = null;
};

// ═══════════════════════════════════════════════════════════
//  CALENDARIO
// ═══════════════════════════════════════════════════════════
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
let showWeekend = false;

window.changeWeek = function (dir) {
  currentWeek = new Date(currentWeek);
  currentWeek.setDate(currentWeek.getDate() + dir * 7);
  renderCalendario();
};
window.goToday = function () { currentWeek = new Date(); renderCalendario(); };
window.toggleWeekend = function () { showWeekend = !showWeekend; renderCalendario(); };

function getWeekStart(d) {
  const date = new Date(d); const day = date.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diff); date.setHours(0, 0, 0, 0); return date;
}

const PX_PER_MIN = 40 / 60;
const PX_PER_HOUR = 40;
const CAL_START_H = 7;
function minutesToPx(minutes) { return minutes * PX_PER_MIN; }
function timeToTopPx(h, m) { return minutesToPx((h - CAL_START_H) * 60 + m); }

let dragSlotId   = null;
let dragOffsetMin = 0;

function renderCalendario() {
  if (!dataLoaded.clients || !dataLoaded.slots) return;

  const weekStart = getWeekStart(currentWeek);
  const allDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(d.getDate() + i); return d;
  });
  const days = showWeekend ? allDays : allDays.slice(0, 5);
  const numDays = days.length;

  const wkBtn = document.getElementById('toggle-weekend-btn');
  if (wkBtn) wkBtn.textContent = showWeekend ? '← Ocultar fin de semana' : 'Ver fin de semana →';

  const opts = { day:'numeric', month:'short' };
  $('week-label').textContent =
    `${days[0].toLocaleDateString('es-ES', opts)} – ${days[numDays-1].toLocaleDateString('es-ES', { ...opts, year:'numeric' })}`;

  const today = new Date(); today.setHours(0,0,0,0);
  const DAYS_ES = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const calendarEl = $('calendar-grid');
  const totalHours = HOURS.length;
  const colHeight  = totalHours * PX_PER_HOUR;
  const gridCols = `52px repeat(${numDays}, 1fr)`;

  // Header
  let html = `<div class="cal-header-row" style="grid-template-columns:${gridCols}">
    <div class="cal-corner"></div>`;
  days.forEach((d, i) => {
    const isT = d.getTime() === today.getTime();
    // Day occupancy (non-cancelled slots)
    const daySlotCount = slots.filter(s => {
      const sd = toDate(s.date);
      return sd.getFullYear() === d.getFullYear() && sd.getMonth() === d.getMonth() && sd.getDate() === d.getDate() && s.status !== 'cancelled';
    }).length;
    const maxSlots = 8;
    const occupancy = Math.min(100, (daySlotCount / maxSlots) * 100);
    html += `<div class="cal-day-header ${isT ? 'today' : ''}">
      <span class="day-name">${DAYS_ES[i]}</span>
      <span class="day-number">${d.getDate()}</span>
      ${daySlotCount > 0 ? `<div class="cal-day-occ-bar" title="${daySlotCount} sesiones"><div class="cal-day-occ-fill" style="width:${occupancy}%"></div></div>` : ''}
    </div>`;
  });
  html += `</div>`;

  // Body
  html += `<div class="cal-body" style="grid-template-columns:${gridCols}">`;
  html += `<div class="cal-time-col">`;
  HOURS.forEach(h => { html += `<div class="cal-time">${h}:00</div>`; });
  html += `</div>`;

  days.forEach((day, dayIdx) => {
    const isT = day.getTime() === today.getTime();
    const daySlots = slots.filter(s => {
      const sd = toDate(s.date);
      return sd.getFullYear() === day.getFullYear() && sd.getMonth() === day.getMonth() && sd.getDate() === day.getDate();
    });

    let gridLines = '';
    HOURS.forEach(() => { gridLines += `<div class="cal-hour-slot half-mark"></div>`; });

    let evHtml = '';
    daySlots.forEach(s => {
      const sd = toDate(s.date);
      const h = sd.getHours(); const m = sd.getMinutes();
      const dur = s.duration || 60;
      const top = timeToTopPx(h, m);
      const height = Math.max(22, minutesToPx(dur) - 3);
      if (top < 0 || top > colHeight) return;

      const client  = clients.find(c => c.id === s.clientId);
      const label   = client ? client.name : (s.title || 'Bloqueado');
      const status  = s.status || 'scheduled';
      const statusCls = status === 'completed' ? 'status-completed'
                      : status === 'pending'   ? 'status-pending'
                      : status === 'cancelled' ? 'status-cancelled' : '';
      const startTime = formatTime(sd);
      const endDate   = new Date(sd.getTime() + dur * 60000);
      const endTime   = formatTime(endDate);
      const showTime  = height >= 36;

      // Color per client (use client color for type=client, else default)
      const evColor = (s.type === 'client' && client) ? avatarColor(client.name) : null;
      const colorStyle = evColor && status !== 'cancelled' ? `border-left: 3px solid ${evColor};` : '';

      // Repeat badge
      const repeatBadge = s.repeatGroupId ? `<span class="ev-repeat-badge" title="Sesión repetida">🔁</span>` : '';

      // Quick complete button (hover)
      const canComplete = status !== 'completed' && status !== 'cancelled' && s.clientId;
      const quickBtn = canComplete
        ? `<button class="ev-quick-complete" onclick="event.stopPropagation();quickCompleteSlot('${s.id}')" title="Completar">✓</button>` : '';

      evHtml += `<div class="cal-event type-${s.type || 'client'} ${statusCls}"
        style="top:${top}px;height:${height}px;${colorStyle}"
        data-slot-id="${s.id}"
        draggable="true"
        onclick="openSlotModal('${s.id}',event)"
        data-tooltip-name="${esc(label)}"
        data-tooltip-time="${startTime} – ${endTime}"
        data-tooltip-dur="${dur} min"
        data-tooltip-status="${esc(statusLabel(status))}"
        data-tooltip-repeat="${s.repeatGroupId ? 'true' : ''}">
        <span class="ev-label">${esc(label)}${repeatBadge}</span>
        ${showTime ? `<span class="ev-time">${startTime} – ${endTime}</span>` : ''}
        ${quickBtn}
      </div>`;
    });

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
      onclick="handleColClick(event,${dayIdx})"
      ondragover="handleDragOver(event)"
      ondragleave="handleDragLeave(event)"
      ondrop="handleDrop(event,${dayIdx})">
      ${gridLines}${nowLine}${evHtml}
    </div>`;
  });

  html += `</div>`;
  calendarEl.innerHTML = html;

  calendarEl.querySelectorAll('.cal-event[data-slot-id]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragSlotId = el.dataset.slotId;
      const s = slots.find(x => x.id === dragSlotId);
      if (!s) return;
      const eventTopPx  = parseFloat(el.style.top);
      const colRect     = el.closest('.cal-day-col').getBoundingClientRect();
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

  // Week summary
  const weekEnd = new Date(allDays[6]); weekEnd.setHours(23,59,59,999);
  const weekBeg = new Date(allDays[0]); weekBeg.setHours(0,0,0,0);
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

  clearInterval(window._nowLineTick);
  window._nowLineTick = setInterval(() => {
    const nowLine = calendarEl.querySelector('.cal-now-line');
    if (!nowLine) { clearInterval(window._nowLineTick); return; }
    const now = new Date();
    nowLine.style.top = timeToTopPx(now.getHours(), now.getMinutes()) + 'px';
  }, 60000);
}

// ── Drag & Drop ───────────────────────────────────────────
window.handleColClick = function (e, dayIdx) {
  if (e.target.closest('.cal-event')) return;
  const col = e.currentTarget;
  const rect = col.getBoundingClientRect();
  const offsetPx = e.clientY - rect.top;
  const totalMin = offsetPx / PX_PER_MIN;
  const absMin   = CAL_START_H * 60 + totalMin;
  const h = Math.floor(absMin / 60);
  const m = Math.round((absMin % 60) / 15) * 15;
  const weekStart = getWeekStart(currentWeek);
  const day = new Date(weekStart); day.setDate(day.getDate() + dayIdx);
  const dateStr = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
  openSlotModal(null, null, dateStr, h, m);
};

window.handleDragOver = function (e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
};
window.handleDragLeave = function (e) { e.currentTarget.classList.remove('drag-over'); };

window.handleDrop = async function (e, dayIdx) {
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  if (!dragSlotId) return;
  const s = slots.find(x => x.id === dragSlotId);
  if (!s) return;

  // Warn if part of a repeat group
  if (s.repeatGroupId) {
    if (!confirm('Esta sesión pertenece a una serie repetida.\n¿Mover solo esta sesión?')) {
      dragSlotId = null; return;
    }
  }

  const col = e.currentTarget; const rect = col.getBoundingClientRect();
  const offsetPx = e.clientY - rect.top;
  const rawMin   = offsetPx / PX_PER_MIN - dragOffsetMin;
  const absMin   = CAL_START_H * 60 + rawMin;
  const snappedMin = Math.round(absMin / 15) * 15;
  const newH = Math.max(CAL_START_H, Math.min(20, Math.floor(snappedMin / 60)));
  const newM = snappedMin % 60;
  const weekStart = getWeekStart(currentWeek);
  const day = new Date(weekStart); day.setDate(day.getDate() + dayIdx);
  const newDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), newH, newM, 0);
  await updateDoc(doc(db, 'slots', s.id), { date: Timestamp.fromDate(newDate), updatedAt: Timestamp.now() });
  dragSlotId = null;
  showToast('📅 Sesión movida');
};

// ═══════════════════════════════════════════════════════════
//  RECURRING ACTION MODAL
//  Shows when user tries to edit/delete a recurring slot
// ═══════════════════════════════════════════════════════════
let _recurCallback = null;

function showRecurModal(title, onThis, onThisAndFuture, onAll) {
  const modal = document.getElementById('modal-recur-action');
  document.getElementById('recur-modal-title').textContent = title;
  _recurCallback = { onThis, onThisAndFuture, onAll };
  modal.classList.remove('hidden');
}

window.recurSelectThis = function () {
  document.getElementById('modal-recur-action').classList.add('hidden');
  _recurCallback?.onThis?.();
};
window.recurSelectFuture = function () {
  document.getElementById('modal-recur-action').classList.add('hidden');
  _recurCallback?.onThisAndFuture?.();
};
window.recurSelectAll = function () {
  document.getElementById('modal-recur-action').classList.add('hidden');
  _recurCallback?.onAll?.();
};
window.closeRecurModal = function () {
  document.getElementById('modal-recur-action').classList.add('hidden');
  _recurCallback = null;
};

// ── Slot Modal ─────────────────────────────────────────────
window.openSlotModal = function (id, e, prefillDate, prefillHour, prefillMin) {
  if (e) e.stopPropagation();
  editingSlot = id ? slots.find(s => s.id === id) : null;
  slotModalDirty = false;

  $('modal-slot-title').textContent = editingSlot ? 'Editar Sesión' : 'Nueva Sesión';
  $('slot-id').value = editingSlot?.id || '';

  const clientSel = $('s-client');
  clientSel.innerHTML = '<option value="">— Selecciona cliente —</option>' +
    clients.filter(c => c.active).map(c =>
      `<option value="${c.id}" ${editingSlot?.clientId === c.id ? 'selected' : ''}>
        ${esc(c.name)} ${c.paymentType === 'bono' ? `(${c.sessionsLeft || 0} ses.)` : ''}
      </option>`
    ).join('');

  const hourSel = $('s-hour'); const minSel = $('s-min');
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

    // Series info badge
    const seriesInfo = document.getElementById('series-info');
    if (seriesInfo) {
      if (editingSlot.repeatGroupId) {
        const group = slots.filter(s => s.repeatGroupId === editingSlot.repeatGroupId).sort((a,b) => toDate(a.date)-toDate(b.date));
        const idx = group.findIndex(s => s.id === editingSlot.id);
        seriesInfo.textContent = `🔁 Sesión ${idx + 1} de ${group.length}`;
        seriesInfo.style.display = 'inline-block';
      } else {
        seriesInfo.style.display = 'none';
      }
    }
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
    $('s-repeat').checked = false;
    hide('repeat-box');
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected'));
    if (prefillDate) {
      const [y, m, d] = prefillDate.split('-').map(Number);
      const wd = new Date(y, m-1, d).getDay();
      const btn = document.querySelector(`.day-btn[data-day="${wd}"]`);
      if (btn) btn.classList.add('selected');
    }
    const seriesInfo = document.getElementById('series-info');
    if (seriesInfo) seriesInfo.style.display = 'none';
  }

  // Dirty tracking
  const modal = $('modal-slot');
  ['s-client','s-type','s-date','s-hour','s-min','s-duration','s-notes','s-status','s-title'].forEach(fieldId => {
    const el = $(fieldId);
    if (el) el.addEventListener('change', () => { slotModalDirty = true; }, { once: true });
  });

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
  if (checked) { show('repeat-box'); } else { hide('repeat-box'); }
};

document.getElementById('days-picker').addEventListener('click', e => {
  const btn = e.target.closest('.day-btn');
  if (btn) { btn.classList.toggle('selected'); updateRepeatPreview(); }
});

window.updateRepeatPreview = function () {
  const preview = document.getElementById('repeat-preview');
  if (!preview) return;
  const total = parseInt($('s-repeat-count')?.value || 12);
  const nDays = document.querySelectorAll('.day-btn.selected').length;
  if (nDays === 0 || !total) { preview.textContent = ''; return; }
  const weekSpan = Math.ceil(total / nDays);
  const NAMES = { 0:'Dom',1:'Lun',2:'Mar',3:'Mié',4:'Jue',5:'Vie',6:'Sáb' };
  const dayNames = Array.from(document.querySelectorAll('.day-btn.selected'))
    .map(b => NAMES[b.dataset.day]).join(' + ');
  if (nDays === 1) {
    preview.textContent = `→ ${total} sesiones · ~${weekSpan} semanas`;
  } else {
    const perDay = Math.floor(total / nDays);
    preview.textContent = `→ ~${perDay} × ${dayNames} = ${total} sesiones · ~${weekSpan} semanas`;
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

    if (editingSlot.repeatGroupId) {
      // Ask what scope to apply changes to
      const group = slots
        .filter(s => s.repeatGroupId === editingSlot.repeatGroupId)
        .sort((a, b) => toDate(a.date) - toDate(b.date));
      const editDate = toDate(editingSlot.date);

      showRecurModal('Editar sesión repetida',
        // Only this
        async () => {
          await updateDoc(doc(db, 'slots', editingSlot.id), baseData);
          closeModalSlot();
          showToast('✅ Sesión actualizada');
        },
        // This and future
        async () => {
          const future = group.filter(s => toDate(s.date) >= editDate);
          for (const s of future) {
            const sd = toDate(s.date);
            const newDate = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), hour, min, 0);
            await updateDoc(doc(db, 'slots', s.id), {
              ...baseData,
              date: Timestamp.fromDate(newDate),
              clientId: baseData.clientId,
              title: baseData.title,
              duration: baseData.duration,
              notes: baseData.notes,
              status: baseData.status,
            });
          }
          closeModalSlot();
          showToast(`✅ ${future.length} sesiones actualizadas`);
        },
        // All
        async () => {
          for (const s of group) {
            const sd = toDate(s.date);
            const newDate = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate(), hour, min, 0);
            await updateDoc(doc(db, 'slots', s.id), {
              ...baseData,
              date: Timestamp.fromDate(newDate),
              clientId: baseData.clientId,
              title: baseData.title,
              duration: baseData.duration,
              notes: baseData.notes,
              status: baseData.status,
            });
          }
          closeModalSlot();
          showToast(`✅ ${group.length} sesiones actualizadas`);
        }
      );
    } else {
      await updateDoc(doc(db, 'slots', editingSlot.id), baseData);
      closeModalSlot();
      showToast('✅ Sesión actualizada');
    }
    return;
  }

  // ── Nueva sesión ──────────────────────────────────────
  const isRepeat = $('s-repeat').checked;

  if (!isRepeat) {
    await addDoc(collection(db, 'slots'), {
      ...baseData, date: Timestamp.fromDate(baseDate), createdAt: Timestamp.now(),
    });
    closeModalSlot();
    showToast('✅ Sesión guardada');
    return;
  }

  // ── Repetición ────────────────────────────────────────
  const totalOccurrences = parseInt($('s-repeat-count')?.value || 12);
  if (!totalOccurrences || totalOccurrences < 1) { alert('Introduce el número de sesiones'); return; }
  const selectedDays = Array.from(document.querySelectorAll('.day-btn.selected')).map(b => parseInt(b.dataset.day));
  if (selectedDays.length === 0) { alert('Selecciona al menos un día de la semana'); return; }

  const sortedDays = [...selectedDays].sort((a, b) => {
    const toMon = x => x === 0 ? 7 : x;
    return toMon(a) - toMon(b);
  });

  const dates = [];
  const monday = getWeekStart(baseDate);
  let week = 0;
  while (dates.length < totalOccurrences && week < 500) {
    for (const wd of sortedDays) {
      if (dates.length >= totalOccurrences) break;
      const offset = wd === 0 ? 6 : wd - 1;
      const target = new Date(monday);
      target.setDate(target.getDate() + week * 7 + offset);
      target.setHours(hour, min, 0, 0);
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
};

// ── Delete Slot ───────────────────────────────────────────
window.deleteSlot = async function () {
  if (!editingSlot) return;

  if (editingSlot.repeatGroupId) {
    const group = slots
      .filter(s => s.repeatGroupId === editingSlot.repeatGroupId)
      .sort((a, b) => toDate(a.date) - toDate(b.date));
    const editDate = toDate(editingSlot.date);

    showRecurModal('Eliminar sesión repetida',
      // Only this
      async () => {
        await deleteDoc(doc(db, 'slots', editingSlot.id));
        closeModalSlot();
        showToast('🗑️ Sesión eliminada', 'info');
      },
      // This and future
      async () => {
        const future = group.filter(s => toDate(s.date) >= editDate);
        for (const s of future) await deleteDoc(doc(db, 'slots', s.id));
        closeModalSlot();
        showToast(`🗑️ ${future.length} sesiones eliminadas`, 'info');
      },
      // All
      async () => {
        for (const s of group) await deleteDoc(doc(db, 'slots', s.id));
        closeModalSlot();
        showToast(`🗑️ ${group.length} sesiones eliminadas`, 'info');
      }
    );
  } else {
    if (!confirm('¿Eliminar esta sesión?')) return;
    await deleteDoc(doc(db, 'slots', editingSlot.id));
    closeModalSlot();
    showToast('🗑️ Sesión eliminada', 'info');
  }
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
  if (slotModalDirty) {
    if (!confirm('Tienes cambios sin guardar. ¿Salir de todas formas?')) return;
  }
  hide('modal-slot');
  editingSlot = null;
  slotModalDirty = false;
};

// ═══════════════════════════════════════════════════════════
//  PAGOS
// ═══════════════════════════════════════════════════════════
window.changeMonth = function (dir) {
  currentMonth = new Date(currentMonth);
  currentMonth.setMonth(currentMonth.getMonth() + dir);
  pagoSearchQuery = '';
  pagoConceptFilter = 'all';
  renderPagos();
};

window.goToCurrentMonth = function () {
  currentMonth = new Date();
  pagoSearchQuery = '';
  pagoConceptFilter = 'all';
  renderPagos();
};

let selectedPaymentIds = new Set();

function updateSelectionBadge() {
  const badge = document.getElementById('selection-badge');
  if (!badge) return;
  const n = selectedPaymentIds.size;
  if (n > 0) { badge.textContent = `${n} seleccionado${n > 1 ? 's' : ''}`; badge.classList.add('visible'); }
  else { badge.classList.remove('visible'); }
}

function togglePaymentSelection(e, id) {
  e.stopPropagation();
  if (selectedPaymentIds.has(id)) { selectedPaymentIds.delete(id); }
  else { selectedPaymentIds.add(id); }
  const row = document.querySelector(`.payment-row[data-id="${id}"]`);
  if (row) {
    row.classList.toggle('selected', selectedPaymentIds.has(id));
    const cb = row.querySelector('.payment-checkbox');
    if (cb) cb.checked = selectedPaymentIds.has(id);
  }
  updateSelectionBadge();
}

window.exportPaymentsCSV = function () {
  const y = currentMonth.getFullYear(); const m = currentMonth.getMonth();
  const monthPayments = payments.filter(p => { const d = toDate(p.date); return d.getFullYear() === y && d.getMonth() === m; });
  const toExport = selectedPaymentIds.size > 0 ? monthPayments.filter(p => selectedPaymentIds.has(p.id)) : monthPayments;
  if (toExport.length === 0) { alert('No hay pagos para exportar'); return; }
  const headers = ['Fecha', 'Cliente', 'Concepto', 'Importe (€)', 'Sesiones', 'Notas'];
  const rows = toExport.map(p => {
    const client = clients.find(c => c.id === p.clientId);
    const name = client ? client.name : 'Cliente desconocido';
    const d = toDate(p.date).toLocaleDateString('es-ES');
    return `"${d}","${name}","${conceptLabel(p.concept)}","${(p.amount||0).toFixed(2)}","${conceptIsBonoType(p.concept) ? (p.sessions||0) : ''}","${(p.notes||'').replace(/"/g,'""')}"`;
  });
  const monthStr = currentMonth.toLocaleDateString('es-ES', { month:'long', year:'numeric' });
  const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `pagos_${monthStr.replace(/ /g,'_')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
};

// ── Estado de filtros de pagos ────────────────────────────
let pagoSearchQuery = '';
let pagoConceptFilter = 'all';

window.setPagoSearch = function(v) { pagoSearchQuery = v.toLowerCase(); renderPagosList(); };
window.setPagoConceptFilter = function(v) { pagoConceptFilter = v; renderPagosList(); };

function buildRevenueChart() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString('es-ES', { month:'short' }) });
  }
  const totals = months.map(({ y, m }) =>
    payments.filter(p => { const d = toDate(p.date); return d.getFullYear() === y && d.getMonth() === m; })
      .reduce((s, p) => s + (p.amount || 0), 0)
  );
  const maxVal = Math.max(...totals, 1);
  const W = 560; const H = 90; const PL = 8; const PR = 8; const PT = 10; const PB = 28;
  const barW = Math.floor((W - PL - PR) / months.length);
  const chartW = barW * months.length;
  const bars = months.map(({ label }, i) => {
    const v = totals[i];
    const barH = Math.max(3, ((v / maxVal) * (H - PT - PB)));
    const x = PL + i * barW;
    const y = H - PB - barH;
    const isCurrent = months[i].y === now.getFullYear() && months[i].m === now.getMonth();
    return `
      <rect x="${x + 4}" y="${y}" width="${barW - 8}" height="${barH}" rx="4"
        fill="${isCurrent ? 'var(--primary)' : 'var(--bg3)'}" opacity="${isCurrent ? 1 : 0.7}" />
      <text x="${x + barW/2}" y="${H - PB + 14}" text-anchor="middle" font-size="10" fill="var(--text3)" font-family="Syne,sans-serif">${label}</text>
      ${v > 0 ? `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" font-size="9" fill="${isCurrent ? 'var(--primary)' : 'var(--text2)'}" font-family="JetBrains Mono,monospace">${v.toFixed(0)}€</text>` : ''}
    `;
  }).join('');
  return `<div class="revenue-chart-wrap">
    <div class="revenue-chart-title">Ingresos últimos 6 meses</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>
  </div>`;
}

function renderPagosList() {
  const y = currentMonth.getFullYear(); const m = currentMonth.getMonth();
  const monthPayments = payments.filter(p => { const d = toDate(p.date); return d.getFullYear() === y && d.getMonth() === m; });

  let filtered = monthPayments;
  if (pagoConceptFilter !== 'all') filtered = filtered.filter(p => p.concept === pagoConceptFilter);
  if (pagoSearchQuery) filtered = filtered.filter(p => {
    const client = clients.find(c => c.id === p.clientId);
    return (client?.name || '').toLowerCase().includes(pagoSearchQuery);
  });

  const listEl = $('payments-list-inner');
  if (!listEl) return;
  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><span>💳</span><p>${monthPayments.length === 0 ? 'Sin pagos este mes' : 'Sin resultados para ese filtro'}</p></div>`;
    return;
  }
  listEl.innerHTML = filtered.map(p => {
    const client = clients.find(c => c.id === p.clientId);
    const name = client ? client.name : 'Cliente desconocido';
    const color = client ? avatarColor(client.name) : '#888';
    const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const d = toDate(p.date);
    const isSelected = selectedPaymentIds.has(p.id);
    const conceptClass = { bono:'tag-bono', bono_pareja:'tag-bono-pareja', sesion:'tag-sesion', mensual:'tag-mensual', individual:'tag-individual', otro:'tag-otro' }[p.concept] || 'tag-otro';
    return `<div class="payment-row${isSelected ? ' selected' : ''}" data-id="${p.id}" onclick="openPaymentModal('${p.id}')">
      <div class="payment-checkbox-wrap" onclick="togglePaymentSelection(event, '${p.id}')">
        <input type="checkbox" class="payment-checkbox" ${isSelected ? 'checked' : ''} tabindex="-1" />
      </div>
      <div class="payment-avatar" style="background:${color}">${initials}</div>
      <div class="payment-info">
        <strong>${esc(name)}</strong>
        <span class="payment-concept-row"><span class="tag ${conceptClass}">${conceptLabel(p.concept)}</span>${p.notes ? `<span class="payment-notes">${esc(p.notes)}</span>` : ''}</span>
      </div>
      <div class="payment-date">${d.toLocaleDateString('es-ES', { day:'numeric', month:'short' })}</div>
      <div class="payment-amount">+${(p.amount || 0).toFixed(0)}€</div>
    </div>`;
  }).join('');
}

function renderPagos() {
  if (!dataLoaded.clients || !dataLoaded.payments) return;
  const y = currentMonth.getFullYear(); const m = currentMonth.getMonth();
  const now = new Date();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();

  $('month-label').textContent = currentMonth.toLocaleDateString('es-ES', { month:'long', year:'numeric' });
  const todayBtn = $('btn-month-today');
  if (todayBtn) todayBtn.style.display = isCurrentMonth ? 'none' : '';

  selectedPaymentIds.clear();

  const monthPayments = payments.filter(p => { const d = toDate(p.date); return d.getFullYear() === y && d.getMonth() === m; });
  const total = monthPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const numBonos = monthPayments.filter(p => conceptIsBonoType(p.concept)).length;

  // Clientes sin pagar: activos con bono, sin pago de bono este mes y sessionsLeft <= 0
  const clientsConBonoSinPago = clients.filter(c => {
    if (!c.active || c.paymentType !== 'bono') return false;
    const hasPagoMes = monthPayments.some(p => p.clientId === c.id && conceptIsBonoType(p.concept));
    return !hasPagoMes && (c.sessionsLeft || 0) <= 0;
  }).length;

  $('payments-summary').innerHTML = `
    <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">${total.toFixed(0)}€</div><div class="stat-label">Total del mes</div></div>
    <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-value">${numBonos}</div><div class="stat-label">Bonos renovados</div></div>
    <div class="stat-card"><div class="stat-icon">🧾</div><div class="stat-value">${monthPayments.length}</div><div class="stat-label">Pagos totales</div></div>
    <div class="stat-card ${clientsConBonoSinPago > 0 ? 'stat-card--alert' : ''}"><div class="stat-icon">${clientsConBonoSinPago > 0 ? '⚠️' : '✅'}</div><div class="stat-value">${clientsConBonoSinPago}</div><div class="stat-label">Sin pagar bono</div></div>
  `;

  const listEl = $('payments-list');
  listEl.innerHTML = `
    ${buildRevenueChart()}
    <div class="payments-toolbar">
      <div class="payments-toolbar-left">
        <button class="btn btn-primary btn-sm" onclick="openPaymentModal()">+ Registrar pago</button>
        <span class="selection-badge" id="selection-badge"></span>
      </div>
      <div class="payments-toolbar-right">
        <div class="export-dropdown" id="export-dropdown">
          <button class="btn btn-outline btn-sm btn-export" onclick="toggleExportDropdown(event)">⬇️ Exportar <span class="export-caret">▾</span></button>
          <div class="export-menu" id="export-menu">
            <button class="export-menu-item" onclick="exportPaymentsCSV(); closeExportDropdown()"><span>📄</span> CSV</button>
            <button class="export-menu-item" onclick="exportPaymentsXLSX(); closeExportDropdown()"><span>📊</span> Excel (.xlsx)</button>
            <button class="export-menu-item" onclick="exportPaymentsPDF(); closeExportDropdown()"><span>📋</span> PDF</button>
          </div>
        </div>
      </div>
    </div>
    <div class="pagos-filters">
      <div class="pagos-search-wrap">
        <input class="pagos-search" placeholder="🔍 Buscar cliente..." oninput="setPagoSearch(this.value)" value="${pagoSearchQuery}" />
      </div>
      <div class="concept-filter-pills" id="concept-filter-pills">
        ${['all','bono','bono_pareja','sesion','mensual','otro'].map(v => {
          const label = { all:'Todos', bono:'Bono individual', bono_pareja:'Bono pareja', sesion:'Sesión suelta', mensual:'Mensual', otro:'Otro' }[v];
          return `<button class="concept-pill${pagoConceptFilter === v ? ' active' : ''}" onclick="setPagoConceptFilter('${v}')">${label}</button>`;
        }).join('')}
      </div>
    </div>
    <div id="payments-list-inner"></div>
  `;
  renderPagosList();
}

// ── Payment Modal ─────────────────────────────────────────
window.openPaymentModal = function (id) {
  editingPayment = id ? payments.find(p => p.id === id) : null;
  const clientSel = $('p-client');
  clientSel.innerHTML = '<option value="">— Selecciona cliente —</option>' +
    clients.map(c => `<option value="${c.id}" ${editingPayment?.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  $('payment-id').value = editingPayment?.id || '';
  $('p-amount').value   = editingPayment?.amount || '';
  $('p-date').value     = editingPayment ? toDateInput(toDate(editingPayment.date)) : toDateInput(new Date());
  $('p-concept').value  = editingPayment?.concept || 'bono';
  $('p-sessions').value = editingPayment?.sessions || 10;
  $('p-notes').value    = editingPayment?.notes || '';
  toggleClass('btn-delete-payment', 'hidden', !editingPayment);
  togglePBonoGroup();
  show('modal-payment');
};

function togglePBonoGroup() {
  const isBono = conceptIsBonoType($('p-concept').value);
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
    clientId, amount, date: Timestamp.fromDate(new Date(y, m-1, d)),
    concept, sessions: conceptIsBonoType(concept) ? sessions : 0,
    notes: $('p-notes').value.trim(), updatedAt: Timestamp.now(),
  };
  if (editingPayment) {
    await updateDoc(doc(db, 'payments', editingPayment.id), data);
  } else {
    data.createdAt = Timestamp.now();
    await addDoc(collection(db, 'payments'), data);
    const client = clients.find(c => c.id === clientId);
    if (conceptIsBonoType(concept)) {
      if (client) await updateDoc(doc(db, 'clients', clientId), { sessionsLeft: (client.sessionsLeft || 0) + sessions, bonoSize: sessions, totalPaid: (client.totalPaid || 0) + amount });
    } else {
      if (client) await updateDoc(doc(db, 'clients', clientId), { totalPaid: (client.totalPaid || 0) + amount });
    }
  }
  closeModalPayment();
  showToast('✅ Pago registrado');
};

window.deletePayment = async function () {
  if (!editingPayment) return;
  if (!confirm('¿Eliminar este pago?')) return;
  const p = editingPayment;
  await deleteDoc(doc(db, 'payments', p.id));
  // Si era un bono, restar las sesiones añadidas al cliente
  if (conceptIsBonoType(p.concept) && p.sessions > 0) {
    const client = clients.find(c => c.id === p.clientId);
    if (client) {
      const newLeft = Math.max(0, (client.sessionsLeft || 0) - p.sessions);
      await updateDoc(doc(db, 'clients', p.clientId), { sessionsLeft: newLeft, totalPaid: Math.max(0, (client.totalPaid || 0) - (p.amount || 0)) });
    }
  } else {
    const client = clients.find(c => c.id === p.clientId);
    if (client) await updateDoc(doc(db, 'clients', p.clientId), { totalPaid: Math.max(0, (client.totalPaid || 0) - (p.amount || 0)) });
  }
  closeModalPayment();
  showToast('🗑️ Pago eliminado', 'info');
};

window.closeModalPayment = function (e) {
  if (e && e.target !== $('modal-payment')) return;
  hide('modal-payment'); editingPayment = null;
};

// ═══════════════════════════════════════════════════════════
//  BADGES
// ═══════════════════════════════════════════════════════════
function updateBadges(count) {
  if (count === undefined) {
    count = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= parseInt(localStorage.getItem('notif-bono-threshold') || '2', 10)).length;
  }
  [$('nav-badge'), $('topbar-badge'), $('bottom-badge')].forEach(el => {
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
function conceptLabel(t){ return { bono:'Bono individual', bono_pareja:'Bono pareja', sesion:'Sesión suelta', mensual:'Mensualidad', individual:'Sesión individual', otro:'Otro' }[t] || t || '—'; }
function conceptIsBonoType(t) { return t === 'bono' || t === 'bono_pareja'; }
function showError(id, msg) { const el=$(id); if(el){el.textContent=msg; el.classList.remove('hidden');} }
function statusIcon(status) { return { scheduled:'⏳', completed:'✅', pending:'🔶', cancelled:'❌' }[status] || '⏳'; }
function statusLabel(status) { return { scheduled:'Programada', completed:'Completada', pending:'Pendiente confirmación', cancelled:'Cancelada' }[status] || 'Programada'; }

// ═══════════════════════════════════════════════════════════
//  GLOBAL SEARCH
// ═══════════════════════════════════════════════════════════
window.openSearch = function () {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    const input = document.getElementById('search-global-input');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('search-results').innerHTML = '';
  });
};

window.closeSearch = function (e) {
  if (e && !e.target.classList.contains('search-overlay')) return;
  _dismissSearch();
};

function _dismissSearch() {
  const overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  setTimeout(() => overlay.classList.add('hidden'), 100);
}

window.runSearch = function (q) {
  const query   = (q || '').toLowerCase().trim();
  const results = document.getElementById('search-results');
  if (!results) return;
  if (!query) { results.innerHTML = ''; return; }

  const matchClients  = clients.filter(c => c.name.toLowerCase().includes(query) || (c.notes||'').toLowerCase().includes(query)).slice(0, 4);
  const matchSlots    = slots.filter(s => { const c = clients.find(x => x.id === s.clientId); return c && c.name.toLowerCase().includes(query); }).slice(0, 4);
  const matchPayments = payments.filter(p =>
    (p.notes||'').toLowerCase().includes(query) ||
    (() => { const c = clients.find(x => x.id === p.clientId); return c && c.name.toLowerCase().includes(query); })()
  ).slice(0, 4);

  if (!matchClients.length && !matchSlots.length && !matchPayments.length) {
    results.innerHTML = `<div class="search-empty">Sin resultados para "<strong>${esc(q)}</strong>"</div>`;
    return;
  }

  let html = '';
  if (matchClients.length) {
    html += `<div class="search-group-header">Clientes</div>`;
    matchClients.forEach(c => {
      const initials = c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      const meta = [c.phone, c.email].filter(Boolean).join(' · ') || (c.notes ? c.notes.slice(0,40) : '—');
      html += `<div class="search-result-item" tabindex="0" onclick="openClientDetail('${c.id}'); _dismissSearch();" onkeydown="if(event.key==='Enter'){openClientDetail('${c.id}');_dismissSearch();}">
        <div class="search-result-icon">👤</div>
        <div class="search-result-body"><div class="search-result-name">${esc(c.name)}</div><div class="search-result-meta">${esc(meta)}</div></div>
      </div>`;
    });
  }
  if (matchSlots.length) {
    if (matchClients.length) html += `<div class="search-result-divider"></div>`;
    html += `<div class="search-group-header">Sesiones</div>`;
    matchSlots.forEach(s => {
      const client = clients.find(c => c.id === s.clientId);
      const name = client ? client.name : (s.title || 'Bloqueado');
      const d = toDate(s.date);
      html += `<div class="search-result-item" tabindex="0" onclick="navigate('calendario'); _dismissSearch();" onkeydown="if(event.key==='Enter'){navigate('calendario');_dismissSearch();}">
        <div class="search-result-icon">📅</div>
        <div class="search-result-body">
          <div class="search-result-name">${esc(name)}</div>
          <div class="search-result-meta">${d.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'})} · ${formatTime(d)} · ${statusLabel(s.status||'scheduled')}</div>
        </div>
      </div>`;
    });
  }
  if (matchPayments.length) {
    if (matchClients.length || matchSlots.length) html += `<div class="search-result-divider"></div>`;
    html += `<div class="search-group-header">Pagos</div>`;
    matchPayments.forEach(p => {
      const client = clients.find(c => c.id === p.clientId);
      const name = client ? client.name : 'Cliente desconocido';
      const d = toDate(p.date);
      html += `<div class="search-result-item" tabindex="0" onclick="navigate('pagos'); _dismissSearch();" onkeydown="if(event.key==='Enter'){navigate('pagos');_dismissSearch();}">
        <div class="search-result-icon">💳</div>
        <div class="search-result-body">
          <div class="search-result-name">${esc(name)} · ${(p.amount||0).toFixed(0)}€</div>
          <div class="search-result-meta">${d.toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}${p.notes ? ' — '+esc(p.notes) : ''}</div>
        </div>
      </div>`;
    });
  }
  results.innerHTML = html;
};

// ═══════════════════════════════════════════════════════════
//  EXPORT DROPDOWN
// ═══════════════════════════════════════════════════════════
window.toggleExportDropdown = function (e) {
  e.stopPropagation();
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  menu.classList.toggle('open', !menu.classList.contains('open'));
};
window.closeExportDropdown = function () {
  const menu = document.getElementById('export-menu');
  if (menu) menu.classList.remove('open');
};
document.addEventListener('click', () => closeExportDropdown());

// ═══════════════════════════════════════════════════════════
//  EXPORT EXCEL
// ═══════════════════════════════════════════════════════════
window.exportPaymentsXLSX = function () {
  if (typeof XLSX === 'undefined') { alert('La librería Excel no está disponible. Recarga la página.'); return; }
  const y = currentMonth.getFullYear(); const m = currentMonth.getMonth();
  const monthPayments = payments.filter(p => { const d = toDate(p.date); return d.getFullYear() === y && d.getMonth() === m; });
  const toExport = selectedPaymentIds.size > 0 ? monthPayments.filter(p => selectedPaymentIds.has(p.id)) : monthPayments;
  if (toExport.length === 0) { alert('No hay pagos para exportar'); return; }
  const total = toExport.reduce((s, p) => s + (p.amount || 0), 0);
  const headers = ['Fecha', 'Cliente', 'Concepto', 'Importe (€)', 'Notas'];
  const dataRows = toExport.map(p => {
    const client = clients.find(c => c.id === p.clientId);
    return [toDate(p.date).toLocaleDateString('es-ES'), client ? client.name : 'Desconocido', conceptLabel(p.concept), parseFloat((p.amount||0).toFixed(2)), p.notes || ''];
  });
  const wsData = [headers, ...dataRows, ['', '', 'TOTAL', parseFloat(total.toFixed(2)), '']];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{wch:12},{wch:24},{wch:22},{wch:14},{wch:30}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pagos');
  XLSX.writeFile(wb, `pagos-${String(m+1).padStart(2,'0')}-${y}.xlsx`);
};

// ═══════════════════════════════════════════════════════════
//  EXPORT PDF
// ═══════════════════════════════════════════════════════════
window.exportPaymentsPDF = function () {
  if (typeof window.jspdf === 'undefined') { alert('La librería PDF no está disponible. Recarga la página.'); return; }
  const { jsPDF } = window.jspdf;
  const y = currentMonth.getFullYear(); const m = currentMonth.getMonth();
  const monthPayments = payments.filter(p => { const d = toDate(p.date); return d.getFullYear() === y && d.getMonth() === m; });
  const toExport = selectedPaymentIds.size > 0 ? monthPayments.filter(p => selectedPaymentIds.has(p.id)) : monthPayments;
  if (toExport.length === 0) { alert('No hay pagos para exportar'); return; }
  const monthStr = currentMonth.toLocaleDateString('es-ES', { month:'long', year:'numeric' });
  const total = toExport.reduce((s, p) => s + (p.amount || 0), 0);
  const doc2 = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
  const pageW = doc2.internal.pageSize.getWidth();
  doc2.setFillColor(14,15,20); doc2.rect(0,0,pageW,38,'F');
  doc2.setTextColor(232,255,71); doc2.setFontSize(20); doc2.setFont('helvetica','bold'); doc2.text('⚡ FitTracker Pro', 14, 16);
  doc2.setTextColor(200,205,215); doc2.setFontSize(11); doc2.setFont('helvetica','normal'); doc2.text(`Pagos — ${monthStr}`, 14, 25);
  doc2.setTextColor(232,255,71); doc2.setFontSize(11); doc2.setFont('helvetica','bold'); doc2.text(`Total: ${total.toFixed(2)} €`, pageW-14, 25, {align:'right'});
  const tableRows = toExport.map(p => {
    const client = clients.find(c => c.id === p.clientId);
    return [toDate(p.date).toLocaleDateString('es-ES'), client ? client.name : 'Desconocido', conceptLabel(p.concept), `${(p.amount||0).toFixed(2)} €`, p.notes||''];
  });
  doc2.autoTable({
    startY: 44, head:[['Fecha','Cliente','Concepto','Importe (€)','Notas']], body: tableRows, foot:[['','','TOTAL',`${total.toFixed(2)} €`,'']],
    theme:'grid',
    headStyles:{fillColor:[30,33,42],textColor:[232,255,71],fontStyle:'bold',fontSize:9},
    footStyles:{fillColor:[30,33,42],textColor:[232,255,71],fontStyle:'bold',fontSize:9},
    bodyStyles:{fontSize:9,textColor:[30,33,42]},
    alternateRowStyles:{fillColor:[245,247,250]},
    columnStyles:{0:{cellWidth:24},1:{cellWidth:44},2:{cellWidth:38},3:{cellWidth:26,halign:'right'},4:{cellWidth:'auto'}},
    margin:{left:14,right:14}, showFoot:'lastPage',
  });
  const pageCount = doc2.internal.getNumberOfPages();
  const today2 = new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'});
  for (let i = 1; i <= pageCount; i++) {
    doc2.setPage(i); const pageH = doc2.internal.pageSize.getHeight();
    doc2.setFontSize(8); doc2.setFont('helvetica','normal'); doc2.setTextColor(160,165,175);
    doc2.text(`Generado el ${today2}`, 14, pageH-8);
    doc2.text(`Página ${i} de ${pageCount}`, pageW-14, pageH-8, {align:'right'});
  }
  doc2.save(`pagos-${String(m+1).padStart(2,'0')}-${y}.pdf`);
};
