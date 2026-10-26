(function () {
  'use strict';

  const { escape, formatDate, formatTime, initialize, showMessage } = window.CoachTools;
  let context;
  let fixtures = [];
  let scores = new Map();
  let filter = 'upcoming';

  document.addEventListener('DOMContentLoaded', () => {
    initialize().then(value => {
      context = value;
      if (!context) return;
      document.getElementById('match-content').hidden = false;
      document.getElementById('team-picker').addEventListener('change', () => loadMatches().catch(showError));
      document.getElementById('add-match').addEventListener('click', openFixtureDialog);
      document.getElementById('match-form').addEventListener('submit', saveFixture);
      document.getElementById('result-form').addEventListener('submit', saveResult);
      document.addEventListener('admin-fab-action', event => {
        if (event.detail?.action === 'create-match') openFixtureDialog();
      });
      document.querySelectorAll('.segment-btn').forEach(button => button.addEventListener('click', () => {
        filter = button.dataset.filter;
        document.querySelectorAll('.segment-btn').forEach(item => item.classList.toggle('active', item === button));
        render();
      }));
      loadMatches().catch(showError);
      if (new URLSearchParams(window.location.search).get('quick') === 'create-match') openFixtureDialog();
    }).catch(showError);
  });

  async function loadMatches() {
    const { data, error } = await window.supabase.from('events')
      .select('id, title, opponent, is_home, starts_at, venue, status')
      .eq('team_id', context.team.id).eq('type', 'match')
      .is('deleted_at', null).order('starts_at', { ascending: false });
    if (error) throw error;
    fixtures = data || [];
    const ids = fixtures.map(item => item.id);
    scores = new Map();
    if (ids.length) {
      const { data: results, error: resultError } = await window.supabase.from('match_scores')
        .select('event_id, club_score, opponent_score')
        .in('event_id', ids);
      if (resultError) throw resultError;
      scores = new Map((results || []).map(result => [result.event_id, result]));
    }
    render();
  }

  function isPast(fixture) {
    return fixture.status === 'completed' || new Date(fixture.starts_at) < new Date();
  }

  function render() {
    const items = fixtures.filter(fixture => filter === 'upcoming' ? !isPast(fixture) : isPast(fixture));
    document.getElementById('match-list').innerHTML = items.length
      ? items.map(fixture => {
        const score = scores.get(fixture.id);
        const teamLabel = fixture.is_home ? 'Home' : 'Away';
        return `<article class="coach-match-card">
          <div class="coach-event-time"><span class="event-type match">${fixture.status === 'completed' ? 'Final' : 'Fixture'}</span><span>${formatDate(fixture.starts_at)}</span><span>${formatTime(fixture.starts_at)}</span></div>
          <div class="match-opponent"><small>${teamLabel} · ${escape(context.team.name)}</small><strong>vs ${escape(fixture.opponent || fixture.title)}</strong><span>${escape(fixture.venue || 'Venue not set')}</span></div>
          ${score ? `<div class="match-final-score"><strong>${score.club_score}</strong><span>:</span><strong>${score.opponent_score}</strong><small>Final score</small></div>` : ''}
          ${filter === 'past' ? `<button class="btn-outline result-button" data-event-id="${escape(fixture.id)}">${score ? 'Update result' : 'Record result'}</button>` : ''}
        </article>`;
      }).join('')
      : `<div class="coach-empty-state">${filter === 'upcoming' ? 'No upcoming fixtures for this team.' : 'No completed matches or results yet.'}</div>`;
    document.querySelectorAll('.result-button').forEach(button =>
      button.addEventListener('click', () => openResultDialog(button.dataset.eventId)));
  }

  function openFixtureDialog() {
    const form = document.getElementById('match-form');
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    form.elements.starts_at.value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}T${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    document.getElementById('match-dialog').showModal();
  }

  async function saveFixture(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const opponent = String(values.get('opponent')).trim();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const { error } = await window.supabase.from('events').insert({
        club_id: context.profile.club_id,
        team_id: context.team.id,
        coach_id: context.user.id,
        type: 'match',
        title: opponent,
        opponent,
        is_home: values.get('side') === 'home',
        starts_at: new Date(values.get('starts_at')).toISOString(),
        venue: String(values.get('venue')).trim() || null
      });
      if (error) throw error;
      document.getElementById('match-dialog').close();
      showMessage('Fixture saved.');
      await loadMatches();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  function openResultDialog(eventId) {
    const fixture = fixtures.find(item => item.id === eventId);
    const result = scores.get(eventId);
    const form = document.getElementById('result-form');
    form.dataset.eventId = eventId;
    form.elements.home_score.value = result?.club_score ?? '';
    form.elements.away_score.value = result?.opponent_score ?? '';
    document.getElementById('result-match-label').textContent = `Serdang Eagles vs ${fixture.opponent || fixture.title}`;
    document.getElementById('result-dialog').showModal();
  }

  async function saveResult(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const eventId = form.dataset.eventId;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const { error: scoreError } = await window.supabase.from('match_scores').upsert({
        event_id: eventId,
        club_id: context.profile.club_id,
        club_score: Number(values.get('home_score')),
        opponent_score: Number(values.get('away_score')),
        updated_by: context.user.id
      }, { onConflict: 'event_id' });
      if (scoreError) throw scoreError;
      const { error: eventError } = await window.supabase.from('events')
        .update({ status: 'completed' }).eq('id', eventId).eq('team_id', context.team.id);
      if (eventError) throw eventError;
      document.getElementById('result-dialog').close();
      filter = 'past';
      document.querySelectorAll('.segment-btn').forEach(item => item.classList.toggle('active', item.dataset.filter === filter));
      showMessage('Match result saved.');
      await loadMatches();
    } catch (error) {
      showError(error);
    } finally {
      button.disabled = false;
    }
  }

  function showError(error) {
    console.error('Match view failed:', error);
    showMessage(error.message || 'Could not load match data.', true);
  }
})();
