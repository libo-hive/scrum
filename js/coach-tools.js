(function () {
  'use strict';

  const roleNames = {
    head_coach: 'Head coach',
    coach: 'Coach',
    assistant_coach: 'Assistant coach'
  };

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function showMessage(text, isError = false) {
    const element = document.getElementById('page-message');
    element.textContent = text;
    element.hidden = false;
    element.classList.toggle('is-error', isError);
  }

  async function initialize() {
    const { data: { user }, error: authError } = await window.supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.location.replace('login.html');
      return null;
    }

    const [{ data: profile, error: profileError }, { data: roles, error: roleError }] = await Promise.all([
      window.supabase.from('profiles').select('club_id, full_name').eq('id', user.id).single(),
      window.supabase.from('user_roles').select('role').eq('user_id', user.id)
    ]);
    if (profileError) throw profileError;
    if (roleError) throw roleError;

    const role = roles?.map(row => row.role)
      .find(value => Object.prototype.hasOwnProperty.call(roleNames, value));
    if (!role) {
      window.location.replace('dashboard.html');
      return null;
    }
    window.BottomNav.render('coach');

    let teamsQuery = window.supabase.from('teams')
      .select('id, name, age_category, coach_id')
      .eq('club_id', profile.club_id)
      .is('deleted_at', null)
      .order('name');
    if (role !== 'head_coach') teamsQuery = teamsQuery.eq('coach_id', user.id);
    const { data: teams, error: teamsError } = await teamsQuery;
    if (teamsError) throw teamsError;

    document.getElementById('logout-btn').addEventListener('click', async () => {
      const { error } = await window.supabase.auth.signOut();
      if (error) {
        console.error('Sign out failed:', error);
        showMessage('Could not sign out. Please try again.', true);
        return;
      }
      window.location.replace('login.html');
    });
    document.querySelectorAll('[data-close-dialog]').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog').close());
    });

    const teamPicker = document.getElementById('team-picker');
    if (!teams?.length) {
      document.getElementById('team-empty').hidden = false;
      return null;
    }
    teamPicker.innerHTML = teams.map(team =>
      `<option value="${escape(team.id)}">${escape(team.name)}${team.age_category ? ` · ${escape(team.age_category)}` : ''}</option>`
    ).join('');

    const context = { user, profile, role, teams, team: teams[0] };
    const onTeamChange = () => {
      context.team = teams.find(team => team.id === teamPicker.value);
      document.dispatchEvent(new CustomEvent('coach-team-change', { detail: context }));
    };
    teamPicker.addEventListener('change', onTeamChange);
    document.getElementById('team-picker-wrap').hidden = teams.length < 2;
    document.getElementById('team-empty').hidden = true;
    return context;
  }

  async function loadRoster(teamId) {
    const { data, error } = await window.supabase.from('team_members')
      .select('player_id, status, left_at, players(id, full_name, jersey_no, position, membership_status, photo_url)')
      .eq('team_id', teamId)
      .is('left_at', null)
      .order('joined_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      ...row.players,
      teamStatus: row.status
    })).filter(player => player?.id);
  }

  function formatDate(value, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
    return new Date(value).toLocaleDateString('en-MY', options);
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
  }

  window.CoachTools = { escape, formatDate, formatTime, initialize, loadRoster, showMessage };
})();
