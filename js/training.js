(function () {
  'use strict';

  const { escape, formatDate, formatTime, initialize, loadRoster, showMessage } = window.CoachTools;
  let context;
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDate = dateKey(new Date());
  let events = [];

  document.addEventListener('DOMContentLoaded', () => {
    initialize().then(value => {
      context = value;
      if (!context) return;
      document.getElementById('training-content').hidden = false;
      document.getElementById('team-picker').addEventListener('change', () => {
        month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        loadEvents().catch(showError);
      });
      document.getElementById('previous-month').addEventListener('click', () => shiftMonth(-1));
      document.getElementById('next-month').addEventListener('click', () => shiftMonth(1));
      document.getElementById('add-session').addEventListener('click', openSessionDialog);
      document.getElementById('session-form').addEventListener('submit', saveSession);
      loadEvents().catch(showError);
    }).catch(showError);
  });

  function dateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function shiftMonth(amount) {
    month = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    selectedDate = dateKey(month);
    renderCalendar();
    renderSessions();
  }

  async function loadEvents() {
    const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString();
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString();
    const { data, error } = await window.supabase.from('events')
      .select('id, title, description, type, starts_at, ends_at, venue, status')
      .eq('team_id', context.team.id).in('type', ['training', 'match'])
      .is('deleted_at', null).gte('starts_at', start).lt('starts_at', end)
      .order('starts_at');
    if (error) throw error;
    events = data || [];
    renderCalendar();
    renderSessions();
  }

  function renderCalendar() {
    document.getElementById('month-label').textContent = month.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
    const firstOffset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Array.from({ length: firstOffset }, () => '<div class="cal-day is-empty"></div>');
    for (let day = 1; day <= days; day++) {
      const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
      const types = new Set(events.filter(event => dateKey(event.starts_at) === key).map(event => event.type));
      cells.push(`<button class="cal-day ${selectedDate === key ? 'selected' : ''}" type="button" data-date="${key}">
        <span>${day}</span><span class="cal-day-dots">${types.has('training') ? '<i class="training-dot"></i>' : ''}${types.has('match') ? '<i class="match-dot"></i>' : ''}</span>
      </button>`);
    }
    document.getElementById('calendar-grid').innerHTML = cells.join('');
    document.querySelectorAll('.cal-day[data-date]').forEach(button => button.addEventListener('click', () => {
      selectedDate = button.dataset.date;
      renderCalendar();
      renderSessions();
    }));
  }

  function renderSessions() {
    const selected = new Date(`${selectedDate}T12:00:00`);
    document.getElementById('selected-date').textContent = formatDate(selected);
    const matches = events.filter(event => dateKey(event.starts_at) === selectedDate);
    document.getElementById('session-list').innerHTML = matches.length
      ? matches.map(event => `<article class="coach-event-card">
          <div class="coach-event-time"><strong>${formatTime(event.starts_at)}</strong><span class="event-type ${event.type}">${event.type}</span></div>
          <div class="coach-row-main"><strong>${escape(event.title)}</strong><span>${escape(event.venue || 'Venue not set')}${event.ends_at ? ` · until ${formatTime(event.ends_at)}` : ''}</span>
          ${event.description ? `<p class="event-syllabus">${escape(event.description)}</p>` : ''}</div>
          ${event.type === 'training' ? `<button class="btn-outline attendance-button" data-event-id="${escape(event.id)}">Attendance</button>` : ''}
        </article>`).join('')
      : '<div class="coach-empty-state">Nothing scheduled for this day.</div>';
    document.querySelectorAll('.attendance-button').forEach(button =>
      button.addEventListener('click', () => openAttendance(button.dataset.eventId).catch(showError)));
  }

  function openSessionDialog() {
    const form = document.getElementById('session-form');
    form.elements.starts_at.value = `${selectedDate}T09:00`;
    form.elements.ends_at.value = `${selectedDate}T11:00`;
    document.getElementById('session-dialog').showModal();
  }

  async function saveSession(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const startsAt = new Date(values.get('starts_at'));
    const endsAtValue = values.get('ends_at');
    const endsAt = endsAtValue ? new Date(endsAtValue) : null;
    if (endsAt && endsAt <= startsAt) {
      showMessage('Session end time must be after the start time.', true);
      return;
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const { error } = await window.supabase.from('events').insert({
        club_id: context.profile.club_id,
        team_id: context.team.id,
        coach_id: context.user.id,
        type: 'training',
        title: String(values.get('title')).trim(),
        starts_at: startsAt.toISOString(),
        ends_at: endsAt?.toISOString() || null,
        venue: String(values.get('venue')).trim() || null,
        description: String(values.get('description')).trim() || null
      });
      if (error) throw error;
      document.getElementById('session-dialog').close();
      showMessage('Training session saved.');
      await loadEvents();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  async function openAttendance(eventId) {
    const [players, attendanceResult] = await Promise.all([
      loadRoster(context.team.id),
      window.supabase.from('attendance').select('player_id, status').eq('event_id', eventId)
    ]);
    if (attendanceResult.error) throw attendanceResult.error;
    const attendance = new Map((attendanceResult.data || []).map(row => [row.player_id, row.status]));
    const container = document.getElementById('attendance-form');
    container.dataset.eventId = eventId;
    container.innerHTML = players.length
      ? `<form id="attendance-save-form">${players.map(player => `<label class="attendance-row">
          <span>${escape(player.full_name)}</span>
          <select name="${escape(player.id)}">
            ${['present', 'absent', 'late', 'excused', 'mc', 'injured'].map(status =>
              `<option value="${status}" ${attendance.get(player.id) === status ? 'selected' : ''}>${status === 'mc' ? 'Medical certificate' : status}</option>`
            ).join('')}
          </select>
        </label>`).join('')}<button class="btn btn-primary coach-button" type="submit">Save attendance</button></form>`
      : '<div class="coach-empty-state">No players are linked to this team yet.</div>';
    const form = document.getElementById('attendance-save-form');
    form?.addEventListener('submit', saveAttendance);
    document.getElementById('attendance-dialog').showModal();
  }

  async function saveAttendance(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const eventId = form.closest('#attendance-form').dataset.eventId;
    const rows = [...new FormData(form).entries()].map(([playerId, status]) => ({
      club_id: context.profile.club_id,
      event_id: eventId,
      player_id: playerId,
      status,
      marked_by: context.user.id
    }));
    if (!rows.length) return;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const { error } = await window.supabase.from('attendance')
        .upsert(rows, { onConflict: 'event_id,player_id' });
      if (error) throw error;
      document.getElementById('attendance-dialog').close();
      showMessage('Attendance saved.');
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  function showError(error) {
    console.error('Training view failed:', error);
    showMessage(error.message || 'Could not load training data.', true);
  }
})();
