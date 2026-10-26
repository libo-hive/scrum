(function () {
  'use strict';

  const roleNames = {
    superadmin: 'Super admin', admin: 'Administrator', manager: 'Manager', finance: 'Finance',
    head_coach: 'Head coach', coach: 'Coach', assistant_coach: 'Assistant coach',
    medic: 'Medical staff', kit_man: 'Kit manager', volunteer: 'Volunteer',
    adult_player: 'Adult player', junior_player: 'Junior player', parent: 'Parent / guardian',
    sponsor: 'Sponsor', guest: 'Guest'
  };

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function money(value, currency = 'MYR') {
    return new Intl.NumberFormat('en-MY', { style: 'currency', currency, maximumFractionDigits: 2 })
      .format(Number(value || 0));
  }

  function localDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    return value ? new Date(value).toLocaleDateString('en-MY', options) : '—';
  }

  function message(text, isError = false) {
    const element = document.getElementById('page-message');
    if (!element) return;
    element.textContent = text;
    element.hidden = false;
    element.classList.toggle('is-error', isError);
  }

  async function initialize(allowedRoles = ['admin', 'manager']) {
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
    if (!roles?.some(({ role }) => allowedRoles.includes(role))) {
      window.location.replace('dashboard.html');
      return null;
    }
    const { data: club, error: clubError } = await window.supabase.from('clubs')
      .select('id, name, slug, timezone, currency, domain, sport_types')
      .eq('id', profile.club_id).single();
    if (clubError) throw clubError;

    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      const { error } = await window.supabase.auth.signOut();
      if (error) {
        console.error('Sign out failed:', error);
        message('Could not sign out. Please try again.', true);
        return;
      }
      window.location.replace('login.html');
    });
    document.querySelectorAll('[data-close-dialog]').forEach(button =>
      button.addEventListener('click', () => button.closest('dialog').close()));
    return { user, profile, club, roles: roles.map(({ role }) => role) };
  }

  async function loadTeams(clubId) {
    const { data, error } = await window.supabase.from('teams')
      .select('id, name, age_category, sport, coach_id')
      .eq('club_id', clubId).is('deleted_at', null).order('name');
    if (error) throw error;
    return data || [];
  }

  async function loadCoaches(clubId) {
    const { data: roles, error: roleError } = await window.supabase.from('user_roles')
      .select('user_id, role').eq('club_id', clubId)
      .in('role', ['head_coach', 'coach', 'assistant_coach']);
    if (roleError) throw roleError;
    const ids = [...new Set((roles || []).map(item => item.user_id))];
    if (!ids.length) return [];
    const { data, error } = await window.supabase.from('profiles')
      .select('id, full_name, email').in('id', ids).eq('account_status', 'active');
    if (error) throw error;
    return data || [];
  }

  window.AdminTools = { escape, initialize, loadCoaches, loadTeams, localDate, message, money, roleNames };
})();
