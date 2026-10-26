(function () {
  'use strict';

  let context;
  let teams = [];
  let events = [];
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  document.addEventListener('DOMContentLoaded', () => {
    start().catch(error => {
      console.error('Events failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load club events.', true);
    });
  });

  async function start() {
    context = await window.AdminTools.initialize();
    if (!context) return;
    teams = await window.AdminTools.loadTeams(context.profile.club_id);
    document.getElementById('event-team').insertAdjacentHTML('beforeend', teams.map(team =>
      `<option value="${window.AdminTools.escape(team.id)}">${window.AdminTools.escape(team.name)}</option>`).join(''));
    document.addEventListener('admin-fab-action', event => {
      if (event.detail?.action === 'create-event') openEventForm();
    });
    document.getElementById('event-form').addEventListener('submit', createEvent);
    document.getElementById('event-list').addEventListener('click', cancelEvent);
    document.getElementById('previous-month').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
    await loadMonth();
    document.getElementById('admin-fab-menu').hidden = false;
    if (new URLSearchParams(window.location.search).get('quick') === 'create-event') openEventForm();
  }

  function toLocalInput(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openEventForm() {
    const form = document.getElementById('event-form');
    form.reset();
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    form.elements.starts_at.value = toLocalInput(now);
    document.getElementById('event-dialog').showModal();
  }

  async function changeMonth(amount) {
    month = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    try {
      await loadMonth();
    } catch (error) {
      console.error('Calendar month failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load events for this month.', true);
    }
  }

  async function loadMonth() {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    document.getElementById('month-label').textContent =
      month.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
    const { data, error } = await window.supabase.from('events')
      .select('id, type, title, description, starts_at, ends_at, venue, team_id, status')
      .eq('club_id', context.profile.club_id).is('deleted_at', null)
      .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString())
      .order('starts_at');
    if (error) throw error;
    events = data || [];
    renderCalendar();
    renderEvents();
  }

  function renderCalendar() {
    const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const today = new Date();
    const e = window.AdminTools.escape;
    const cells = Array.from({ length: offset }, () => '<div class="calendar-day-admin is-empty"></div>');
    for (let day = 1; day <= days; day++) {
      const dayEvents = events.filter(item => new Date(item.starts_at).getDate() === day);
      const isToday = today.toDateString() === new Date(month.getFullYear(), month.getMonth(), day).toDateString();
      const types = [...new Set(dayEvents.map(item => item.type))];
      cells.push(`<div class="calendar-day-admin ${dayEvents.length ? 'has-event' : ''} ${isToday ? 'today' : ''}">${day}${types.slice(0, 2).map(type =>
        `<span class="${type === 'training' ? 'training-label' : type === 'match' ? 'match-label' : ''}">${e(type.replace('_', ' '))}</span>`).join('')}</div>`);
    }
    document.getElementById('calendar-grid').innerHTML = cells.join('');
  }

  function renderEvents() {
    const list = document.getElementById('event-list');
    const e = window.AdminTools.escape;
    if (!events.length) {
      list.innerHTML = '<div class="admin-empty">No events scheduled this month. Add one to the club calendar.</div>';
      return;
    }
    list.innerHTML = events.map(item => {
      const team = teams.find(value => value.id === item.team_id)?.name || 'All club';
      return `<article class="admin-row"><div class="admin-row-main">
        <span class="status-pill ${e(item.type)}">${e(item.type.replace('_', ' '))}</span>
        <strong>${e(item.title)}</strong>
        <span>${window.AdminTools.localDate(item.starts_at, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${new Date(item.starts_at).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}${item.venue ? ` · ${e(item.venue)}` : ''} · ${e(team)}</span>
        ${item.description ? `<span>${e(item.description)}</span>` : ''}
      </div><button type="button" class="admin-button-secondary" data-cancel="${e(item.id)}">Cancel</button></article>`;
    }).join('');
  }

  async function createEvent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const startsAt = new Date(fields.get('starts_at'));
    const endsAt = fields.get('ends_at') ? new Date(fields.get('ends_at')) : null;
    if (endsAt && endsAt <= startsAt) {
      submit.disabled = false;
      window.AdminTools.message('Event end time must be after its start time.', true);
      return;
    }
    const record = {
      club_id: context.profile.club_id,
      type: fields.get('type'),
      title: String(fields.get('title')).trim(),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() || null,
      venue: String(fields.get('venue') || '').trim() || null,
      description: String(fields.get('description') || '').trim() || null,
      team_id: String(fields.get('team_id') || '') || null,
      status: 'published'
    };
    const { error } = await window.supabase.from('events').insert(record);
    submit.disabled = false;
    if (error) {
      console.error('Event creation failed:', error);
      window.AdminTools.message(error.message || 'Could not create the event.', true);
      return;
    }
    document.getElementById('event-dialog').close();
    window.AdminTools.message('Event added to the club calendar.');
    await loadMonth();
  }

  async function cancelEvent(event) {
    const button = event.target.closest('[data-cancel]');
    if (!button) return;
    if (!window.confirm('Cancel this event? It will be removed from the club calendar.')) return;
    button.disabled = true;
    const { error } = await window.supabase.from('events')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', button.dataset.cancel).eq('club_id', context.profile.club_id);
    if (error) {
      console.error('Event cancellation failed:', error);
      window.AdminTools.message(error.message || 'Could not cancel the event.', true);
      button.disabled = false;
      return;
    }
    window.AdminTools.message('Event cancelled.');
    await loadMonth();
  }
})();
