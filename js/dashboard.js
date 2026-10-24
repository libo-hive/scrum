(function () {
  'use strict';

  const esc = (s) => s == null ? '' : String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const ini = (n) => !n ? '?' : n.trim().split(/\s+/).slice(0,2).map(w => w[0]).join('').toUpperCase();
  const rm = (v) => 'RM ' + Number(v || 0).toLocaleString('ms-MY', { maximumFractionDigits: 0 });
  const fmtDate = (d) => !d ? '—' : new Date(d + 'T00:00:00').toLocaleDateString('ms-MY', { day:'numeric', month:'short', year:'numeric' });
  const monthName = (m) => ['Jan','Feb','Mac','Apr','Mei','Jun','Jul','Ogos','Sep','Okt','Nov','Dis'][(m-1)%12] || '—';

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      sessionStorage.removeItem('serc_session');
      window.location.href = '../login.html';
    });

    document.querySelectorAll('.dock-item[data-soon="1"]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); alert('Akan datang'); });
    });

    loadKPIs();
    loadActions();
    loadNextEvent();
  });

  async function loadKPIs() {
    const el = document.getElementById('kpi-grid');
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    try {
      const [total, summary, next] = await Promise.all([
        window.SERCAPI.fees.getTotalPlayersCount(),
        window.SERCAPI.fees.getSummary(month, year),
        window.SERCAPI.events.getNextEvent(),
      ]);

      el.innerHTML = `
        <div class="kpi">
          <div class="kpi-label">Total Players</div>
          <div class="kpi-val">${total}</div>
          <div class="kpi-sub">Aktif berdaftar</div>
        </div>
        <div class="kpi ${summary.unpaid > 0 ? 'kpi-bad' : 'kpi-good'}">
          <div class="kpi-label">Overdue Fees</div>
          <div class="kpi-val">${summary.unpaid}</div>
          <div class="kpi-sub">${monthName(month)} ${year}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Next Event</div>
          <div class="kpi-val" style="font-size:1.1rem;line-height:1.2">${next ? esc(next.title) : '—'}</div>
          <div class="kpi-sub">${next ? fmtDate(next.event_date) : 'Tiada event'}</div>
        </div>
        <div class="kpi kpi-good">
          <div class="kpi-label">Collected</div>
          <div class="kpi-val">${rm(summary.collected)}</div>
          <div class="kpi-sub">Bulan ini</div>
        </div>
      `;
    } catch (err) {
      console.error(err);
      el.innerHTML = `<div class="empty">Gagal muat KPI</div>`;
    }
  }

  async function loadActions() {
    const el = document.getElementById('action-list');
    try {
      const rows = await window.SERCAPI.fees.getUnpaidCurrentMonth(6);
      if (!rows.length) {
        el.innerHTML = `<div class="empty">Semua clear ✓ Tiada tindakan.</div>`;
        return;
      }
      el.innerHTML = rows.map(f => {
        const p = f.players || {};
        return `
          <div class="alert-row bad">
            <div class="alert-icon">${esc(ini(p.full_name))}</div>
            <div class="alert-body">
              <div class="alert-title">${esc(p.full_name || 'Unknown')}</div>
              <div class="alert-sub">${esc(p.category || '—')} · ${monthName(f.month)} ${f.year} · ${rm(f.amount)}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error(err);
      el.innerHTML = `<div class="empty">Gagal muat tindakan</div>`;
    }
  }

  async function loadNextEvent() {
    const el = document.getElementById('next-event-section');
    try {
      const ev = await window.SERCAPI.events.getNextEvent();
      if (!ev) {
        el.innerHTML = `<div class="empty">Tiada event akan datang</div>`;
        return;
      }
      el.innerHTML = `
        <div class="card">
          <div class="card-head">
            <div class="card-title">${esc(ev.title)}</div>
          </div>
          <div style="font-size:0.85rem;color:var(--gray)">
            ${fmtDate(ev.event_date)}${ev.event_time ? ' · ' + ev.event_time.slice(0,5) : ''}${ev.location ? ' · ' + esc(ev.location) : ''}
          </div>
        </div>
      `;
    } catch (err) {
      console.error(err);
      el.innerHTML = `<div class="empty">Gagal muat event</div>`;
    }
  }
})();