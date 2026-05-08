// ═══════════════════════════════════════════════════════════
//  FITTRACKER PRO  — app.js
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

// Unsubs for Firestore listeners
const unsubs = {};

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

// Enter key on login
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ═══════════════════════════════════════════════════════════
//  FIRESTORE LISTENERS
// ═══════════════════════════════════════════════════════════
function startListeners() {
  unsubs.clients = onSnapshot(
    query(collection(db, 'clients'), orderBy('name')),
    snap => {
      clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      refreshAll();
    }
  );
  unsubs.slots = onSnapshot(
    query(collection(db, 'slots'), orderBy('date')),
    snap => {
      slots = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      refreshAll();
    }
  );
  unsubs.payments = onSnapshot(
    query(collection(db, 'payments'), orderBy('date', 'desc')),
    snap => {
      payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      refreshAll();
    }
  );
}

function stopListeners() {
  Object.values(unsubs).forEach(u => u && u());
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
  currentPage = page;
  // pages
  ['dashboard','clientes','calendario','pagos'].forEach(p => {
    toggleClass(`page-${p}`, 'hidden', p !== page);
  });
  // nav active — sidebar
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  // nav active — bottom nav
  document.querySelectorAll('.bottom-nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  closeSidebar();
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
//  DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard() {
  if (currentPage !== 'dashboard') return;

  // Date badge
  $('dash-date').textContent = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });

  const activeClients = clients.filter(c => c.active);
  const totalRevenue  = payments.reduce((s, p) => s + (p.amount || 0), 0);

  // Alerts: bonos con ≤2 sesiones
  const alerts = clients.filter(c => c.active && c.paymentType === 'bono' && (c.sessionsLeft || 0) <= 2);
  updateBadges(alerts.length);

  // Render alerts
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

  // Stats
  const todaySlots = slots.filter(s => {
    const d = toDate(s.date);
    return isToday(d) && s.status !== 'cancelled';
  });
  const weekSlots = slots.filter(s => {
    const d = toDate(s.date);
    return isThisWeek(d) && s.status !== 'cancelled';
  });

  $('dash-stats').innerHTML = `
    <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-value">${activeClients.length}</div><div class="stat-label">Clientes activos</div></div>
    <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-value">${todaySlots.length}</div><div class="stat-label">Sesiones hoy</div></div>
    <div class="stat-card"><div class="stat-icon">📊</div><div class="stat-value">${weekSlots.length}</div><div class="stat-label">Esta semana</div></div>
    <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-value">${totalRevenue.toFixed(0)}€</div><div class="stat-label">Total facturado</div></div>
  `;

  // Today sessions
  const todayEl = $('dash-today');
  if (todaySlots.length === 0) {
    todayEl.innerHTML = `<div class="empty-state"><span>🏖️</span><p>Sin sesiones hoy</p></div>`;
  } else {
    todayEl.innerHTML = `<div class="session-list">
      ${todaySlots.sort((a,b) => toDate(a.date)-toDate(b.date)).map(s => {
        const client = clients.find(c => c.id === s.clientId);
        const name   = client ? client.name : (s.title || 'Bloqueado');
        const icon   = s.status === 'completed' ? '✅' : s.status === 'cancelled' ? '❌' : '⏳';
        return `<div class="session-item ${s.status === 'completed' ? 'completed' : ''}">
          <div class="session-time">${formatTime(toDate(s.date))}</div>
          <div class="session-info">
            <strong>${esc(name)}</strong>
            <span>${s.notes || (client ? `${client.sessionsLeft || 0} sesiones restantes` : '')}</span>
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
      return `<div class="bono-card" onclick="openClientModal('${c.id}')">
        <div class="bono-avatar">${c.name.charAt(0).toUpperCase()}</div>
        <div class="bono-info">
          <strong>${esc(c.name)}</strong>
          <div class="bono-bar-wrap"><div class="bono-bar" style="width:${pct}%;background:${color}"></div></div>
          <span class="bono-count">${c.sessionsLeft || 0} sesiones</span>
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
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><span>👥</span><p>No hay clientes</p></div>`;
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
    return `<div class="client-card" onclick="openClientModal('${c.id}')">
      <div class="client-avatar">${c.name.charAt(0).toUpperCase()}</div>
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
};

window.deleteClient = async function () {
  if (!editingClient) return;
  if (!confirm(`¿Eliminar a ${editingClient.name}? Se borrarán todos sus datos.`)) return;
  await deleteDoc(doc(db, 'clients', editingClient.id));
  closeModalClient();
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
  const weekStart = getWeekStart(currentWeek);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Label
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
            && sd.getHours()    === hour
            && s.status         !== 'cancelled';
      });
      const isT = day.getTime() === today.getTime();
      html += `<div class="cal-cell ${isT ? 'today-col' : ''}" onclick="handleCellClick(${dayIdx},${hour},event)">
        ${cellSlots.map(s => {
          const client = clients.find(c => c.id === s.clientId);
          const label  = client ? client.name : (s.title || 'Bloqueado');
          return `<div class="cal-event type-${s.type || 'client'} ${s.status === 'completed' ? 'done' : ''}"
            onclick="openSlotModal('${s.id}',event)"
            style="height:${Math.max(20, (s.duration || 60) / 60 * 52 - 4)}px">
            ${esc(label)}
          </div>`;
        }).join('')}
      </div>`;
    });
  });

  grid.innerHTML = html;
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
    hide('btn-delete-slot');
    hide('btn-complete-slot');
  }
  toggleSlotFields();
  show('modal-slot');
};

window.toggleSlotFields = function () {
  const type = $('s-type').value;
  toggleClass('slot-client-group', 'hidden', type !== 'client');
  toggleClass('slot-title-group',  'hidden', type === 'client');
};

window.saveSlot = async function () {
  const type   = $('s-type').value;
  const dateStr = $('s-date').value;
  const hour   = parseInt($('s-hour').value);
  if (!dateStr) { alert('Selecciona una fecha'); return; }

  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m-1, d, hour, 0, 0);

  const data = {
    type,
    clientId:  type === 'client' ? ($('s-client').value || null) : null,
    title:     type !== 'client' ? $('s-title').value.trim() : '',
    date:      Timestamp.fromDate(date),
    duration:  parseInt($('s-duration').value),
    notes:     $('s-notes').value.trim(),
    status:    editingSlot ? $('s-status').value : 'scheduled',
    updatedAt: Timestamp.now(),
  };

  if (editingSlot) {
    await updateDoc(doc(db, 'slots', editingSlot.id), data);
  } else {
    data.createdAt = Timestamp.now();
    await addDoc(collection(db, 'slots'), data);
  }
  closeModalSlot();
};

window.deleteSlot = async function () {
  if (!editingSlot) return;
  if (!confirm('¿Eliminar esta sesión?')) return;
  await deleteDoc(doc(db, 'slots', editingSlot.id));
  closeModalSlot();
};

window.completeSlot = async function () {
  if (!editingSlot) return;
  if (!confirm('¿Marcar como completada? Se descontará una sesión del bono.')) return;
  await updateDoc(doc(db, 'slots', editingSlot.id), { status: 'completed', updatedAt: Timestamp.now() });
  // Descuenta sesión del bono
  const client = clients.find(c => c.id === editingSlot.clientId);
  if (client && client.paymentType === 'bono' && (client.sessionsLeft || 0) > 0) {
    await updateDoc(doc(db, 'clients', client.id), { sessionsLeft: client.sessionsLeft - 1 });
  }
  closeModalSlot();
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

function renderPagos() {
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth();
  $('month-label').textContent = currentMonth.toLocaleDateString('es-ES', { month:'long', year:'numeric' });

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

  // Add payment button row
  let html = `<div style="margin-bottom:16px">
    <button class="btn btn-primary" onclick="openPaymentModal()">+ Registrar pago</button>
  </div>`;

  if (monthPayments.length === 0) {
    html += `<div class="empty-state"><span>💳</span><p>Sin pagos este mes</p></div>`;
  } else {
    html += monthPayments.map(p => {
      const client = clients.find(c => c.id === p.clientId);
      const name   = client ? client.name : 'Cliente desconocido';
      const d      = toDate(p.date);
      return `<div class="payment-row" onclick="openPaymentModal('${p.id}')">
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
    // Si es un bono, actualizar sesiones del cliente
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
};

window.deletePayment = async function () {
  if (!editingPayment) return;
  if (!confirm('¿Eliminar este pago?')) return;
  await deleteDoc(doc(db, 'payments', editingPayment.id));
  closeModalPayment();
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
function val (id)       { return $( id)?.value || ''; }
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
