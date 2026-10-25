(function () {
  'use strict';

  let context;
  let teams = [];
  let coaches = [];

  document.addEventListener('DOMContentLoaded', () => {
    start().catch(error => {
      console.error('Team management failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load teams.', true);
    });
  });

  async function start() {
    context = await window.AdminTools.initialize();
    if (!context) return;
    [teams, coaches] = await Promise.all([
      window.AdminTools.loadTeams(context.profile.club_id),
      window.AdminTools.loadCoaches(context.profile.club_id)
    ]);
    const coachSelect = document.getElementById('team-coach');
    coachSelect.innerHTML = '<option value="">No coach assigned</option>' + coaches.map(coach =>
      `<option value="${window.AdminTools.escape(coach.id)}">${window.AdminTools.escape(coach.full_name || coach.email || 'Coach')}</option>`
    ).join('');
    document.addEventListener('admin-fab-action', event => {
      if (event.detail?.action === 'create-team') {
        document.getElementById('team-dialog').showModal();
      }
    });
    document.getElementById('team-form').addEventListener('submit', createTeam);
    document.getElementById('player-form').addEventListener('submit', createPlayer);
    document.getElementById('team-list').addEventListener('click', handleListClick);
    document.getElementById('team-list').addEventListener('change', handleListChange);
    renderTeams();
    document.getElementById('admin-fab-menu').hidden = false;
    if (new URLSearchParams(window.location.search).get('quick') === 'create-team') {
      document.getElementById('team-dialog').showModal();
    }
  }

  function renderTeams() {
    const container = document.getElementById('team-list');
    if (!teams.length) {
      container.innerHTML = '<div class="admin-empty">No teams yet. Create a team such as U14, then assign its coach.</div>';
      return;
    }
    const e = window.AdminTools.escape;
    container.innerHTML = teams.map(team => {
      const coachName = coaches.find(coach => coach.id === team.coach_id)?.full_name || 'No coach assigned';
      return `<article class="admin-row team-card">
        <div class="admin-row-main">
          <strong>${e(team.name)}</strong><span>${e(team.age_category || team.sport || 'Club team')} · ${e(coachName)}</span>
          <div class="team-roster" id="roster-${e(team.id)}" hidden><div class="admin-muted">Loading roster…</div></div>
        </div>
        <button class="admin-button-secondary" type="button" data-action="roster" data-team="${e(team.id)}">Roster</button>
        <select class="admin-toolbar-select" aria-label="Assign coach to ${e(team.name)}" data-action="coach" data-team="${e(team.id)}">
          <option value="">No coach</option>${coaches.map(coach =>
            `<option value="${e(coach.id)}" ${coach.id === team.coach_id ? 'selected' : ''}>${e(coach.full_name || coach.email || 'Coach')}</option>`
          ).join('')}
        </select>
      </article>`;
    }).join('');
  }

  async function handleListClick(event) {
    const button = event.target.closest('[data-action="roster"]');
    if (!button) return;
    const teamId = button.dataset.team;
    const section = document.getElementById(`roster-${teamId}`);
    if (!section.hidden) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    button.disabled = true;
    try {
      await renderRoster(teamId, section);
    } catch (error) {
      console.error('Roster failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load this roster.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function handleListChange(event) {
    const select = event.target.closest('[data-action="coach"]');
    if (!select) return;
    select.disabled = true;
    const { error } = await window.supabase.from('teams')
      .update({ coach_id: select.value || null })
      .eq('id', select.dataset.team).eq('club_id', context.profile.club_id);
    select.disabled = false;
    if (error) {
      console.error('Coach assignment failed:', error);
      window.AdminTools.message(error.message || 'Could not assign this coach.', true);
      renderTeams();
      return;
    }
    const team = teams.find(item => item.id === select.dataset.team);
    if (team) team.coach_id = select.value || null;
    window.AdminTools.message('Coach assignment updated.');
    renderTeams();
  }

  async function renderRoster(teamId, section) {
    const e = window.AdminTools.escape;
    const { data, error } = await window.supabase.from('team_members')
      .select('player_id, status, joined_at, players(id, full_name, jersey_no, position, membership_status)')
      .eq('team_id', teamId).is('left_at', null).order('joined_at', { ascending: false });
    if (error) throw error;
    if (!data?.length) {
      section.innerHTML = '<div class="admin-empty">No players in this squad yet.</div>';
    } else {
      section.innerHTML = `<div class="team-roster-actions"><button type="button" class="admin-button-secondary" data-action="add-player" data-team="${e(teamId)}">+ Add player</button></div>` +
        data.map(row => `<div class="admin-row"><div class="admin-row-main"><strong>${e(row.players?.full_name || 'Player')}</strong><span>${row.players?.jersey_no ? `#${e(row.players.jersey_no)} · ` : ''}${e(row.players?.position || row.players?.membership_status || 'Squad member')}</span></div><button type="button" class="admin-button-secondary" data-action="invite-parent" data-player="${e(row.player_id)}">Invite parent</button><button type="button" class="admin-button-secondary" data-action="registration" data-player="${e(row.player_id)}">Registration</button><button type="button" class="admin-button-secondary" data-action="remove-player" data-team="${e(teamId)}" data-player="${e(row.player_id)}">Remove</button></div>`).join('');
    }
    if (!section.querySelector('[data-action="add-player"]')) {
      section.insertAdjacentHTML('afterbegin', `<div class="team-roster-actions"><button type="button" class="admin-button-secondary" data-action="add-player" data-team="${e(teamId)}">+ Add player</button></div>`);
    }
  }

  async function createTeam(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const team = {
      club_id: context.profile.club_id,
      name: String(fields.get('name')).trim(),
      age_category: String(fields.get('age_category') || '').trim() || null,
      sport: String(fields.get('sport')).trim(),
      coach_id: String(fields.get('coach_id') || '') || null
    };
    const { data, error } = await window.supabase.from('teams').insert(team)
      .select('id, name, age_category, sport, coach_id').single();
    submit.disabled = false;
    if (error) {
      console.error('Team creation failed:', error);
      window.AdminTools.message(error.message || 'Could not create the team.', true);
      return;
    }
    teams = [...teams, data].sort((a, b) => a.name.localeCompare(b.name));
    renderTeams();
    form.reset();
    form.elements.sport.value = 'rugby';
    document.getElementById('team-dialog').close();
    window.AdminTools.message(`${data.name} created.`);
  }

  async function createPlayer(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const jerseyNo = String(fields.get('jersey_no') || '');
    const { error } = await window.supabase.rpc('create_player_for_team', {
      p_team_id: fields.get('team_id'),
      p_full_name: String(fields.get('full_name')).trim(),
      p_date_of_birth: fields.get('date_of_birth'),
      p_gender: fields.get('gender') || null,
      p_jersey_no: jerseyNo ? Number(jerseyNo) : null,
      p_position: fields.get('position') || null
    });
    submit.disabled = false;
    if (error) {
      console.error('Player creation failed:', error);
      window.AdminTools.message(error.message || 'Could not add the player.', true);
      return;
    }
    document.getElementById('player-dialog').close();
    form.reset();
    window.AdminTools.message('Player added to the squad.');
    try {
      await renderRoster(fields.get('team_id'), document.getElementById(`roster-${fields.get('team_id')}`));
    } catch (error) {
      console.error('Updated roster failed to load:', error);
      window.AdminTools.message(error.message || 'Player added, but the roster did not refresh.', true);
    }
  }

  document.getElementById('team-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-action="add-player"], [data-action="remove-player"], [data-action="registration"], [data-action="invite-parent"]');
    if (!button) return;
    if (button.dataset.action === 'add-player') {
      const form = document.getElementById('player-form');
      form.elements.team_id.value = button.dataset.team;
      document.getElementById('player-dialog').showModal();
      return;
    }
    if (button.dataset.action === 'registration') {
      button.disabled = true;
      try {
        await showRegistration(button.dataset.player);
      } catch (error) {
        console.error('Player registration failed to load:', error);
        window.AdminTools.message(error.message || 'Could not load player registration details.', true);
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (button.dataset.action === 'invite-parent') {
      const params = new URLSearchParams({ quick: 'create-parent-invite', player: button.dataset.player });
      window.location.href = `members.html?${params.toString()}`;
      return;
    }
    if (!window.confirm('Remove this player from the team roster? The player record will be kept.')) return;
    button.disabled = true;
    const { error } = await window.supabase.from('team_members')
      .update({ left_at: new Date().toISOString().slice(0, 10), status: 'inactive' })
      .eq('team_id', button.dataset.team).eq('player_id', button.dataset.player).is('left_at', null);
    if (error) {
      console.error('Player removal failed:', error);
      window.AdminTools.message(error.message || 'Could not remove the player.', true);
      button.disabled = false;
      return;
    }
    window.AdminTools.message('Player removed from the team roster.');
    await renderRoster(button.dataset.team, document.getElementById(`roster-${button.dataset.team}`));
  });

  async function showRegistration(playerId) {
    const [{ data: registration, error: registrationError }, { data: player, error: playerError }] = await Promise.all([
      window.supabase.from('player_registration_details').select('*').eq('player_id', playerId).maybeSingle(),
      window.supabase.from('players').select('full_name, nickname, date_of_birth, phone').eq('id', playerId).single()
    ]);
    if (registrationError) throw registrationError;
    if (playerError) throw playerError;
    const container = document.getElementById('registration-details');
    if (!registration) {
      container.innerHTML = `<div class="admin-empty">Registration details have not been submitted for ${window.AdminTools.escape(player.full_name)} yet.</div>`;
    } else {
      const e = window.AdminTools.escape;
      const row = (label, value) => `<div class="registration-detail"><span>${e(label)}</span><strong>${e(value || '—')}</strong></div>`;
      const consentLabels = {
        rugby_risk: 'Rugby risk acknowledgement',
        volunteer_program: 'Volunteer programme support',
        guardian_presence: 'Guardian presence and contactability',
        information_and_rules: 'Information accuracy and club rules',
        fees: 'Fees and payment proof',
        player_ethics: 'Player Ethics Code',
        parent_ethics: 'Parents and Guardians Ethics Code',
        media: 'Photo/video use',
        marketing_updates: 'Marketing communications'
      };
      const optionalConsents = new Set(['media', 'marketing_updates']);
      const consents = Object.entries(consentLabels).map(([key, label]) =>
        row(label, registration.consents?.[key]
          ? 'Accepted'
          : optionalConsents.has(key) ? 'Not given (optional)' : 'Not accepted')).join('');
      container.innerHTML = `
        <div class="registration-group"><h3>Player</h3>
          ${row('Name', player.full_name)}${row('Nickname', player.nickname)}
          ${row('Date of birth', player.date_of_birth)}${row('MyKad / MyKid / Passport', registration.identity_document)}
          ${row('Telephone', player.phone)}${row('Height (cm)', registration.height_cm)}
          ${row('Weight (kg)', registration.weight_kg)}${row('Address', registration.address)}
          ${row('Medical conditions', registration.medical_conditions)}
        </div>
        <div class="registration-group"><h3>Primary guardian</h3>
          ${row('Name', registration.primary_guardian_name)}
          ${row('MyKad / Passport', registration.primary_guardian_identity_document)}
          ${row('Telephone', registration.primary_guardian_phone)}
          ${row('Email', registration.primary_guardian_email)}
          ${row('Relationship', registration.primary_guardian_relationship)}
          ${row('Address', registration.primary_guardian_address)}
        </div>
        <div class="registration-group"><h3>Secondary guardian</h3>
          ${row('Name', registration.secondary_guardian_name)}
          ${row('Relationship', registration.secondary_guardian_relationship)}
          ${row('Telephone', registration.secondary_guardian_phone)}
        </div>
        <div class="registration-group"><h3>Consents · ${e(registration.consent_version)}</h3>
          ${consents}${row('Submitted', registration.consented_at)}
        </div>`;
    }
    document.getElementById('registration-dialog').showModal();
  }
})();
