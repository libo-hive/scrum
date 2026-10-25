(function () {
  'use strict';

  const { escape, initialize, loadRoster, showMessage } = window.CoachTools;
  let context;
  let roster = [];
  let attendanceByPlayer = new Map();
  let fitnessByPlayer = new Map();
  let filter = 'all';
  let search = '';

  document.addEventListener('DOMContentLoaded', () => {
    initialize().then(value => {
      context = value;
      if (!context) return;
      document.getElementById('squad-content').hidden = false;
      document.getElementById('team-name').textContent = context.team.name;
      document.getElementById('team-picker').addEventListener('change', () => loadSquad().catch(showError));
      document.getElementById('player-search').addEventListener('input', event => {
        search = event.target.value.trim().toLowerCase();
        renderPlayers();
      });
      document.querySelectorAll('#player-filters [data-filter]').forEach(button => {
        button.addEventListener('click', () => {
          filter = button.dataset.filter;
          document.querySelectorAll('#player-filters [data-filter]').forEach(item => item.classList.toggle('active', item === button));
          renderPlayers();
        });
      });
      loadSquad().catch(showError);
    }).catch(showError);
  });

  async function loadSquad() {
    document.getElementById('team-name').textContent = context.team.name;
    const { data: memberships, error: membershipError } = await window.supabase.from('team_members')
      .select('player_id, status')
      .eq('team_id', context.team.id)
      .is('left_at', null);
    if (membershipError) throw membershipError;
    const playerIds = (memberships || []).map(row => row.player_id);

    [roster, attendanceByPlayer, fitnessByPlayer] = [[], new Map(), new Map()];
    if (playerIds.length) {
      roster = await loadRoster(context.team.id);
      const [{ data: events, error: eventsError }, { data: fitness, error: fitnessError }] = await Promise.all([
        window.supabase.from('events').select('id').eq('team_id', context.team.id)
          .eq('type', 'training').is('deleted_at', null),
        window.supabase.from('fitness_tests')
          .select('player_id, test_name, result, unit, tested_at')
          .eq('club_id', context.profile.club_id).in('player_id', playerIds)
          .order('tested_at', { ascending: false })
      ]);
      if (eventsError) throw eventsError;
      if (fitnessError) throw fitnessError;
      if (events?.length) {
        const { data: attendance, error } = await window.supabase.from('attendance')
          .select('player_id, event_id, status')
          .in('event_id', events.map(event => event.id))
          .in('player_id', playerIds);
        if (error) throw error;
        for (const row of attendance || []) {
          const current = attendanceByPlayer.get(row.player_id) || { sessions: 0, attended: 0 };
          current.sessions++;
          if (['present', 'late'].includes(row.status)) current.attended++;
          attendanceByPlayer.set(row.player_id, current);
        }
      }
      for (const result of fitness || []) {
        if (!fitnessByPlayer.has(result.player_id)) fitnessByPlayer.set(result.player_id, result);
      }
    }
    renderStats();
    renderPlayers();
    renderFitness();
  }

  function renderStats() {
    const injured = roster.filter(player => player.membership_status === 'injured').length;
    const active = roster.filter(player => player.membership_status === 'active').length;
    const attendance = [...attendanceByPlayer.values()];
    const attendanceRate = attendance.length
      ? Math.round(attendance.reduce((total, item) => total + (item.attended / item.sessions), 0) / attendance.length * 100)
      : null;
    document.getElementById('squad-kpis').innerHTML = `
      <div class="kpi kpi-good"><div class="kpi-label">Active players</div><div class="kpi-val">${active}</div><div class="kpi-sub">of ${roster.length} on the roster</div></div>
      <div class="kpi ${injured ? 'kpi-warn' : 'kpi-good'}"><div class="kpi-label">Injured</div><div class="kpi-val">${injured}</div><div class="kpi-sub">${injured ? 'needs attention' : 'all clear'}</div></div>
      <div class="kpi"><div class="kpi-label">Training attendance</div><div class="kpi-val">${attendanceRate === null ? '—' : `${attendanceRate}%`}</div><div class="kpi-sub">Average for recorded sessions</div></div>
      <div class="kpi"><div class="kpi-label">Fitness records</div><div class="kpi-val">${fitnessByPlayer.size}</div><div class="kpi-sub">Players with a latest result</div></div>`;
  }

  function renderPlayers() {
    const filtered = roster.filter(player => {
      const status = player.membership_status || 'active';
      return (filter === 'all' || status === filter)
        && `${player.full_name} ${player.position || ''} ${player.jersey_no || ''}`.toLowerCase().includes(search);
    });
    document.getElementById('player-list').innerHTML = filtered.length
      ? filtered.map(player => {
        const attendance = attendanceByPlayer.get(player.id);
        const percent = attendance?.sessions ? Math.round(attendance.attended / attendance.sessions * 100) : null;
        const latestFitness = fitnessByPlayer.get(player.id);
        return `<article class="coach-list-row">
          <div class="player-number">${player.jersey_no ? `#${escape(player.jersey_no)}` : '—'}</div>
          <div class="coach-row-main"><strong>${escape(player.full_name)}</strong><span>${escape(player.position || 'Position not set')} · ${escape(player.membership_status || 'active')}</span></div>
          <div class="player-stats"><span>${percent === null ? '—' : `${percent}%`}<small>attendance</small></span><span>${latestFitness ? `${escape(latestFitness.result)} ${escape(latestFitness.unit || '')}` : '—'}<small>fitness</small></span></div>
        </article>`;
      }).join('')
      : `<div class="coach-empty-state">${roster.length ? 'No players match this filter.' : 'No players are linked to this team yet. An admin can add players and assign them to this squad.'}</div>`;
  }

  function renderFitness() {
    const fitness = [...fitnessByPlayer.entries()].map(([playerId, result]) => ({
      player: roster.find(item => item.id === playerId),
      result
    })).filter(item => item.player);
    document.getElementById('fitness-list').innerHTML = fitness.length
      ? fitness.map(({ player, result }) => `<article class="coach-list-row">
          <div class="coach-row-main"><strong>${escape(player.full_name)}</strong><span>${escape(result.test_name)}</span></div>
          <div class="fitness-result"><strong>${escape(result.result)} ${escape(result.unit || '')}</strong><small>${escape(result.tested_at)}</small></div>
        </article>`).join('')
      : '<div class="coach-empty-state">Fitness testing results will appear here when recorded.</div>';
  }

  function showError(error) {
    console.error('Squad view failed:', error);
    showMessage(error.message || 'Could not load squad data.', true);
  }
})();
