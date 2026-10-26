(function () {
  'use strict';

  const roleNames = {
    superadmin: 'Super admin', admin: 'Administrator', manager: 'Manager', finance: 'Finance',
    head_coach: 'Head coach', coach: 'Coach', assistant_coach: 'Assistant coach',
    medic: 'Medical staff', kit_man: 'Kit manager', volunteer: 'Volunteer',
    adult_player: 'Adult player', junior_player: 'Junior player', parent: 'Parent / guardian',
    sponsor: 'Sponsor', guest: 'Guest'
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(part => part[0]).join('').toUpperCase();
  const formatDate = (value) => new Date(value).toLocaleDateString('en-MY', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Sign out failed:', error);
        return;
      }
      window.location.replace('login.html');
    });

    loadDashboard().catch(error => {
      console.error('Dashboard data failed to load:', error);
      if (!document.getElementById('member-dashboard').hidden) {
        const target = document.getElementById('member-dashboard-message');
        target.hidden = false;
        target.textContent = error.message || 'Could not load your player dashboard. Please try again.';
      } else if (!document.getElementById('admin-dashboard').hidden) {
        document.getElementById('kpi-grid').textContent = 'Could not load membership overview.';
      } else if (!document.getElementById('finance-dashboard').hidden) {
        const target = document.getElementById('finance-dashboard-message');
        target.hidden = false;
        target.textContent = error.message || 'Could not load your finance dashboard. Please try again.';
      } else {
        document.getElementById('coach-team-notice').textContent =
          'Could not load your coach dashboard. Please try again or contact an administrator.';
      }
    });
  });

  async function loadDashboard() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.location.replace('login.html');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('club_id, full_name')
      .eq('id', user.id)
      .single();
    if (profileError) throw profileError;

    const { data: roles, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    if (roleError) throw roleError;
    if (!roles?.length) throw new Error('No membership role was found for this account.');

    const roleSet = new Set(roles.map(({ role }) => role));
    if (!roleSet.has('admin') && !roleSet.has('manager')) {
      if (roleSet.has('finance')) {
        await renderFinanceDashboard(profile);
        return;
      }
      const role = roles.find(({ role: userRole }) =>
        ['head_coach', 'coach', 'assistant_coach'].includes(userRole))?.role;
      if (role) {
        await renderCoachDashboard(profile, role, user.id);
      } else {
        await renderMemberDashboard(profile, roles[0].role);
      }
      return;
    }

    document.getElementById('admin-dashboard').hidden = false;
    setDockVisibility('admin');
    const clubId = profile.club_id;
    const [active, pending, profileSetup, invites] = await Promise.all([
      countProfiles(clubId, 'active'),
      countProfiles(clubId, 'pending_approval'),
      countProfiles(clubId, 'approved_pending_profile'),
      supabase.from('invitations').select('id', { count: 'exact', head: true })
        .eq('club_id', clubId).eq('status', 'active').gt('expires_at', new Date().toISOString())
    ]);
    if (invites.error) throw invites.error;

    renderKpis(active, pending, profileSetup, invites.count || 0);
    await Promise.all([loadPendingMembers(clubId), loadRecentInvitations(clubId)]);
  }

  async function renderFinanceDashboard(profile) {
    document.getElementById('header-title').textContent = 'SERC Finance';
    document.getElementById('header-sub').textContent = 'Accounts & payments';
    document.getElementById('finance-dashboard').hidden = false;
    document.getElementById('finance-fab-menu').hidden = false;
    document.getElementById('finance-greeting').textContent = `Welcome, ${profile.full_name || 'Finance team'}.`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStartDate = new Date(monthStart.getTime() - monthStart.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const [invoiceResult, paymentResult, transactionResult, clubResult] = await Promise.all([
      fetchAllRows(() => supabase.from('invoices')
        .select('id, invoice_no, due_date, total, currency, status, notes')
        .eq('club_id', profile.club_id).order('created_at', { ascending: false })),
      fetchAllRows(() => supabase.from('payments')
        .select('invoice_id, amount, paid_at, method, status')
        .eq('club_id', profile.club_id).order('paid_at', { ascending: false })),
      fetchAllRows(() => supabase.from('finance_records')
        .select('transaction_type, amount, transaction_date')
        .eq('club_id', profile.club_id).gte('transaction_date', monthStartDate)),
      supabase.from('clubs').select('currency').eq('id', profile.club_id).single()
    ]);
    if (invoiceResult.error) throw invoiceResult.error;
    if (paymentResult.error) throw paymentResult.error;
    if (transactionResult.error) throw transactionResult.error;
    if (clubResult.error) throw clubResult.error;

    const invoices = invoiceResult.data || [];
    const payments = paymentResult.data || [];
    const paidByInvoice = new Map();
    payments.filter(payment => payment.status === 'success').forEach(payment => {
      paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) || 0) + Number(payment.amount || 0));
    });
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const eligibleInvoices = invoices.filter(invoice => !['draft', 'void', 'refunded'].includes(invoice.status));
    const outstandingInvoices = eligibleInvoices.map(invoice => ({
      ...invoice,
      balance: Math.max(0, Number(invoice.total || 0) - (paidByInvoice.get(invoice.id) || 0))
    })).filter(invoice => invoice.balance > 0);
    const overdueInvoices = outstandingInvoices.filter(invoice =>
      invoice.due_date && new Date(`${invoice.due_date}T00:00:00`) < today);
    const dueSoon = outstandingInvoices.filter(invoice => {
      if (!invoice.due_date) return false;
      const due = new Date(`${invoice.due_date}T00:00:00`);
      return due >= today && due <= nextWeek;
    });
    const collectedThisMonth = payments.filter(payment =>
      payment.status === 'success' && payment.paid_at && new Date(payment.paid_at) >= monthStart
    ).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const transactionsThisMonth = (transactionResult.data || [])
      .filter(record => record.transaction_date >= monthStartDate);
    const otherIncomeThisMonth = transactionsThisMonth.filter(record => record.transaction_type === 'income')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const expensesThisMonth = transactionsThisMonth.filter(record => record.transaction_type === 'expense')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const currency = (clubResult.data.currency || 'MYR').trim();
    const money = value => new Intl.NumberFormat('en-MY', {
      style: 'currency', currency, maximumFractionDigits: 2
    }).format(Number(value || 0));
    const kpis = document.getElementById('finance-dashboard-kpis').querySelectorAll('.kpi-val');
    kpis[0].textContent = money(outstandingInvoices.reduce((sum, invoice) => sum + invoice.balance, 0));
    kpis[1].textContent = money(overdueInvoices.reduce((sum, invoice) => sum + invoice.balance, 0));
    kpis[2].textContent = money(collectedThisMonth);
    kpis[3].textContent = money(otherIncomeThisMonth);
    kpis[4].textContent = money(expensesThisMonth);
    kpis[5].textContent = String(dueSoon.length);

    const escape = escapeHtml;
    const outstandingList = document.getElementById('finance-outstanding-list');
    outstandingList.innerHTML = overdueInvoices.slice(0, 5).concat(
      outstandingInvoices.filter(invoice => !overdueInvoices.includes(invoice)).slice(0, Math.max(0, 5 - overdueInvoices.slice(0, 5).length))
    ).map(invoice => `<article class="admin-row">
      <div class="admin-row-main">
        <span class="status-pill ${invoice.due_date && new Date(`${invoice.due_date}T00:00:00`) < today ? 'overdue' : ''}">${invoice.due_date && new Date(`${invoice.due_date}T00:00:00`) < today ? 'Overdue' : 'Outstanding'}</span>
        <strong>${escape(invoice.invoice_no || 'Invoice')}</strong>
        <span>${escape(invoice.notes || 'Club invoice')} · Due ${escape(invoice.due_date ? formatDate(invoice.due_date) : 'No due date')}</span>
      </div>
      <strong>${escape(money(invoice.balance))}</strong>
    </article>`).join('') || '<div class="admin-empty">No outstanding invoices. Accounts are up to date.</div>';

    const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice]));
    const recentPayments = document.getElementById('finance-recent-payments');
    recentPayments.innerHTML = payments.filter(payment => payment.status === 'success').slice(0, 5)
      .map(payment => {
        const invoice = invoiceById.get(payment.invoice_id);
        return `<article class="admin-row"><div class="admin-row-main">
          <strong>${escape(money(payment.amount))} · ${escape(invoice?.invoice_no || 'Payment')}</strong>
          <span>${escape(formatDate(payment.paid_at))} · ${escape(String(payment.method || 'payment').replaceAll('_', ' '))}</span>
        </div><span class="status-pill paid">Received</span></article>`;
      }).join('') || '<div class="admin-empty">No payments have been recorded yet.</div>';
  }

  async function fetchAllRows(buildQuery) {
    const pageSize = 1000;
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
      if (error) return { data: null, error };
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return { data: rows, error: null };
    }
  }

  async function renderMemberDashboard(profile, role) {
    const isParent = role === 'parent';
    const isPlayer = ['adult_player', 'junior_player'].includes(role);
    if (!isParent && !isPlayer) {
      document.getElementById('header-title').textContent = 'SERC Member';
      document.getElementById('header-sub').textContent = roleNames[role] || 'Club member';
      document.getElementById('member-dashboard').hidden = false;
      document.getElementById('member-dashboard-tag').textContent = 'Member access';
      document.getElementById('member-dashboard-title').textContent = 'Your dashboard';
      document.getElementById('member-greeting').textContent = `Welcome, ${profile.full_name || 'member'}.`;
      document.getElementById('member-general-name').textContent = profile.full_name || 'Club member';
      document.getElementById('member-general-role').textContent = roleNames[role] || 'Club member';
      document.getElementById('member-general-card').hidden = false;
      setDockVisibility('member');
      return;
    }
    document.getElementById('header-title').textContent = isParent ? 'SERC Family' : 'SERC Player';
    document.getElementById('header-sub').textContent = isParent ? 'Parent dashboard' : 'Player dashboard';
    document.getElementById('member-dashboard').hidden = false;
    document.getElementById('member-dashboard-tag').textContent = isParent ? 'Family overview' : 'Player overview';
    document.getElementById('member-dashboard-title').textContent = isParent ? 'Family dashboard' : 'Player dashboard';
    document.getElementById('member-greeting').textContent =
      `Good ${getTimeOfDay()}, ${profile.full_name || (isParent ? 'Parent' : 'Player')}.`;
    document.getElementById('member-player-kicker').textContent = isParent ? 'Linked player' : roleNames[role] || 'Player profile';
    setDockVisibility('member');

    const { data: players, error } = await supabase.from('players')
      .select('id, full_name, date_of_birth, position, jersey_no')
      .eq('club_id', profile.club_id)
      .is('deleted_at', null)
      .order('full_name');
    if (error) throw error;

    if (!players?.length) {
      document.getElementById('member-no-player-title').textContent = isParent
        ? 'No player linked yet' : 'Player profile not found';
      document.getElementById('member-no-player-copy').textContent = isParent
        ? 'Your parent account is ready, but the club has not linked a player profile to it yet. Please contact a club administrator to connect your child’s profile. Once linked, their team, schedule, attendance and account details will appear here.'
        : 'Your player account is active, but there is no player record linked to it yet. Please contact a club administrator to connect your player profile.';
      document.getElementById('member-no-player').hidden = false;
      document.getElementById('member-player-content').hidden = true;
      return;
    }

    const memberMenu = document.getElementById('member-fab-menu');
    if (memberMenu) memberMenu.hidden = false;
    const pickerWrap = document.getElementById('member-child-picker-wrap');
    const picker = document.getElementById('member-child-picker');
    pickerWrap.hidden = !isParent || players.length < 2;
    picker.innerHTML = players.map(player =>
      `<option value="${escapeHtml(player.id)}">${escapeHtml(player.full_name)}</option>`).join('');
    document.getElementById('member-no-player').hidden = true;
    document.getElementById('member-player-content').hidden = false;

    const loadSelectedPlayer = async () => {
      const selected = players.find(player => player.id === picker.value) || players[0];
      document.getElementById('member-player-content').hidden = true;
      document.getElementById('member-dashboard-message').hidden = true;
      await loadPlayerDashboard(selected, isParent);
      document.getElementById('member-player-content').hidden = false;
    };
    picker.addEventListener('change', () => loadSelectedPlayer().catch(showMemberError));
    await loadSelectedPlayer();
  }

  async function loadPlayerDashboard(player, isParent) {
    const playerIds = [player.id];
    const [{ data: memberships, error: membershipError }, { data: attendance, error: attendanceError },
      { data: invoices, error: invoiceError }, { data: fitness, error: fitnessError }] = await Promise.all([
      supabase.from('team_members').select('team_id, status, joined_at')
        .in('player_id', playerIds).is('left_at', null).order('joined_at', { ascending: false }),
      supabase.from('attendance').select('status, created_at')
        .eq('player_id', player.id)
        .gte('created_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('invoices').select('invoice_no, issue_date, due_date, total, currency, status')
        .eq('player_id', player.id).not('status', 'in', '("draft","void")')
        .order('issue_date', { ascending: false }).limit(10),
      supabase.from('fitness_tests').select('test_name, result, unit, tested_at')
        .eq('player_id', player.id).order('tested_at', { ascending: false }).limit(1)
    ]);
    if (membershipError) throw membershipError;
    if (attendanceError) throw attendanceError;
    if (invoiceError) throw invoiceError;
    if (fitnessError) throw fitnessError;

    const teamIds = [...new Set((memberships || []).map(item => item.team_id))];
    let teams = [];
    let upcoming = [];
    let recentMatches = [];
    if (teamIds.length) {
      const { data: teamRows, error: teamError } = await supabase.from('teams')
        .select('id, name, age_category').in('id', teamIds).is('deleted_at', null);
      if (teamError) throw teamError;
      teams = teamRows || [];

      const now = new Date().toISOString();
      const [{ data: eventRows, error: eventError }, { data: pastMatches, error: matchEventError }] = await Promise.all([
        supabase.from('events').select('id, team_id, type, title, starts_at, venue, opponent, is_home')
          .in('team_id', teamIds).eq('status', 'published').is('deleted_at', null)
          .gte('starts_at', now).order('starts_at').limit(8),
        supabase.from('events').select('id, team_id, title, starts_at, opponent, is_home')
          .in('team_id', teamIds).eq('type', 'match').eq('status', 'published')
          .is('deleted_at', null).lt('starts_at', now).order('starts_at', { ascending: false }).limit(5)
      ]);
      if (eventError) throw eventError;
      if (matchEventError) throw matchEventError;
      upcoming = eventRows || [];

      if (pastMatches?.length) {
        const { data: scores, error: scoreError } = await supabase.from('match_scores')
          .select('event_id, club_score, opponent_score').in('event_id', pastMatches.map(item => item.id));
        if (scoreError) throw scoreError;
        const scoreByEvent = new Map((scores || []).map(score => [score.event_id, score]));
        recentMatches = pastMatches.filter(match => scoreByEvent.has(match.id))
          .map(match => ({ ...match, score: scoreByEvent.get(match.id) }));
      }
    }

    renderPlayerProfile(player, teams, memberships, isParent);
    renderPlayerKpis(teams, upcoming, attendance || [], invoices || []);
    renderUpcomingEvents(upcoming, teams);
    renderPlayerActivity(attendance || [], recentMatches);
    renderPlayerInvoices(invoices || []);
    renderFitnessResult(fitness?.[0]);
  }

  function renderPlayerProfile(player, teams, memberships, isParent) {
    const age = getAge(player.date_of_birth);
    document.getElementById('member-player-name').textContent = player.full_name;
    document.getElementById('member-player-meta').textContent = [
      player.position || 'Position not set',
      player.jersey_no ? `#${player.jersey_no}` : '',
      age === null ? '' : `${age} years old`
    ].filter(Boolean).join(' · ');
    document.getElementById('member-team-chips').innerHTML = teams.length
      ? teams.map(team => `<span class="member-team-chip">${escapeHtml(team.name)}${team.age_category ? ` · ${escapeHtml(team.age_category)}` : ''}</span>`).join('')
      : `<span class="coach-muted">${memberships.length ? 'Team details unavailable' : 'No squad assigned yet'}</span>`;
    document.getElementById('member-player-kicker').textContent = isParent ? 'Linked player' : 'Player profile';
  }

  function renderPlayerKpis(teams, upcoming, attendance, invoices) {
    const sessions = attendance.filter(row => ['present', 'late', 'absent'].includes(row.status));
    const attended = sessions.filter(row => ['present', 'late'].includes(row.status)).length;
    const rate = sessions.length ? `${Math.round(attended / sessions.length * 100)}%` : '—';
    const outstanding = invoices.filter(invoice => ['sent', 'partially_paid', 'overdue'].includes(invoice.status));
    document.getElementById('member-kpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">Squads</div><div class="kpi-val">${teams.length}</div><div class="kpi-sub">${teams.length ? 'Current team links' : 'Awaiting team assignment'}</div></div>
      <div class="kpi"><div class="kpi-label">Coming up</div><div class="kpi-val">${upcoming.length}</div><div class="kpi-sub">Published sessions &amp; matches</div></div>
      <div class="kpi ${sessions.length && attended / sessions.length >= .75 ? 'kpi-good' : ''}"><div class="kpi-label">Attendance</div><div class="kpi-val">${rate}</div><div class="kpi-sub">${sessions.length ? `Last ${sessions.length} recorded sessions` : 'No attendance recorded yet'}</div></div>
      <div class="kpi ${outstanding.length ? 'kpi-warn' : 'kpi-good'}"><div class="kpi-label">Open invoices</div><div class="kpi-val">${outstanding.length}</div><div class="kpi-sub">${outstanding.length ? 'Please check invoice details' : 'No outstanding invoices'}</div></div>`;
  }

  function renderUpcomingEvents(events, teams) {
    const names = new Map(teams.map(team => [team.id, team.name]));
    document.getElementById('member-upcoming-list').innerHTML = events.length
      ? events.map(event => `<article class="coach-event-card">
          <div class="coach-event-time"><strong>${escapeHtml(formatShortDate(event.starts_at))}</strong><span>${escapeHtml(formatTime(event.starts_at))}</span></div>
          <div class="coach-row-main">
            <span class="event-type${event.type === 'match' ? ' match' : ''}">${escapeHtml(event.type)}</span>
            <strong>${escapeHtml(event.type === 'match' && event.opponent ? `${event.is_home ? 'vs' : '@'} ${event.opponent}` : event.title)}</strong>
            <span>${escapeHtml(names.get(event.team_id) || 'Team')}${event.venue ? ` · ${escapeHtml(event.venue)}` : ''}</span>
          </div>
        </article>`).join('')
      : '<div class="coach-empty-state">No upcoming team sessions or matches are scheduled.</div>';
  }

  function renderPlayerActivity(attendance, matches) {
    const recentAttendance = attendance.slice(0, 5).map(row => `
      <article class="coach-list-row"><div class="coach-row-main">
        <strong>Training attendance</strong><span>${escapeHtml(formatShortDate(row.created_at))}</span>
      </div><span class="member-status-pill ${row.status === 'present' || row.status === 'late' ? 'is-good' : ''}">${escapeHtml(row.status)}</span></article>`).join('');
    const recentResults = matches.slice(0, 3).map(match => `
      <article class="coach-list-row"><div class="coach-row-main">
        <strong>${escapeHtml(match.opponent || match.title)}</strong><span>${escapeHtml(formatShortDate(match.starts_at))}</span>
      </div><strong class="member-match-score">${match.score.club_score} – ${match.score.opponent_score}</strong></article>`).join('');
    document.getElementById('member-activity-list').innerHTML = recentAttendance + recentResults
      || '<div class="coach-empty-state">Attendance and match results will appear here when recorded.</div>';
  }

  function renderPlayerInvoices(invoices) {
    document.getElementById('member-invoice-list').innerHTML = invoices.length
      ? invoices.map(invoice => `<article class="coach-list-row">
          <div class="coach-row-main"><strong>${escapeHtml(invoice.invoice_no)}</strong><span>${invoice.due_date ? `Due ${escapeHtml(formatShortDate(invoice.due_date))}` : `Issued ${escapeHtml(formatShortDate(invoice.issue_date))}`}</span></div>
          <div class="member-invoice-meta"><strong>${escapeHtml(formatMoney(invoice.total, invoice.currency))}</strong><span class="member-status-pill ${invoice.status === 'paid' ? 'is-good' : ''}">${escapeHtml(invoice.status.replaceAll('_', ' '))}</span></div>
        </article>`).join('')
      : '<div class="coach-empty-state">No invoices are available for this player.</div>';
  }

  function renderFitnessResult(result) {
    document.getElementById('member-fitness-list').innerHTML = result
      ? `<article class="coach-list-row">
          <div class="coach-row-main"><strong>${escapeHtml(result.test_name)}</strong><span>${escapeHtml(formatShortDate(result.tested_at))}</span></div>
          <strong class="member-match-score">${escapeHtml(result.result)} ${escapeHtml(result.unit || '')}</strong>
        </article>`
      : '<div class="coach-empty-state">Fitness results will appear here when recorded by the coaching team.</div>';
  }

  function formatShortDate(value) {
    return new Date(value).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
  }

  function formatMoney(value, currency) {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency', currency: String(currency || 'MYR').trim()
    }).format(Number(value) || 0);
  }

  function getAge(value) {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    const today = new Date();
    return today.getFullYear() - year - (today.getMonth() + 1 < month
      || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
  }

  function showMemberError(error) {
    console.error('Member dashboard data failed to load:', error);
    const message = document.getElementById('member-dashboard-message');
    if (message) {
      message.hidden = false;
      message.textContent = error.message || 'Could not load player information. Please try again.';
    }
  }

  async function renderCoachDashboard(profile, role, userId) {
    document.getElementById('header-title').textContent = 'SERC Coach';
    document.getElementById('header-sub').textContent = roleNames[role] || 'Coach';
    document.getElementById('coach-dashboard').hidden = false;
    setDockVisibility('coach');
    document.getElementById('coach-greeting').textContent =
      `Good ${getTimeOfDay()}, ${profile.full_name || 'Coach'}.`;

    const { data, error } = await supabase.from('member_details')
      .select('details')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    const details = data?.details;
    const category = details?.coaching_category || '';
    const preferredTeam = details?.preferred_team || '';
    document.getElementById('coach-team-label').textContent =
      [category, preferredTeam].filter(Boolean).join(' · ') || roleNames[role] || 'Coach';

    if (!preferredTeam) {
      document.getElementById('coach-team-notice').textContent =
        'Add your team or age group to your coach profile to connect your squad.';
      return;
    }

    const { data: teams, error: teamsError } = await supabase.from('teams')
      .select('id, name')
      .eq('club_id', profile.club_id);
    if (teamsError) throw teamsError;
    const linkedTeam = teams?.find(team =>
      String(team.name || '').trim().toLowerCase() === preferredTeam.trim().toLowerCase());

    document.getElementById('coach-team-notice').textContent = linkedTeam
      ? `${linkedTeam.name} is linked. Squad, training and match data will appear here as those coach tools are connected.`
      : `“${preferredTeam}” is on your profile, but there is no matching team in the club yet. Ask an administrator to create or link it before squad data can appear.`;
  }

  function setDockVisibility(view) {
    const floatingMenu = document.getElementById('admin-fab-menu');
    if (floatingMenu) floatingMenu.hidden = view !== 'admin';
    const coachMenu = document.getElementById('coach-fab-menu');
    if (coachMenu) coachMenu.hidden = view !== 'coach';
    const memberMenu = document.getElementById('member-fab-menu');
    if (memberMenu) memberMenu.hidden = true;
  }

  function getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  async function countProfiles(clubId, status) {
    const { count, error } = await supabase.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('account_status', status);
    if (error) throw error;
    return count || 0;
  }

  function renderKpis(active, pending, profileSetup, invites) {
    document.getElementById('kpi-grid').innerHTML = `
      <div class="kpi kpi-good">
        <div class="kpi-label">Active Members</div>
        <div class="kpi-val">${active}</div>
        <div class="kpi-sub">Approved and onboarded</div>
      </div>
      <div class="kpi ${pending ? 'kpi-warn' : 'kpi-good'}">
        <div class="kpi-label">Pending Approval</div>
        <div class="kpi-val">${pending}</div>
        <div class="kpi-sub">Applications to review</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Profile Setup</div>
        <div class="kpi-val">${profileSetup}</div>
        <div class="kpi-sub">Approved members completing setup</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Open Invites</div>
        <div class="kpi-val">${invites}</div>
        <div class="kpi-sub">Links not yet used</div>
      </div>
    `;
  }

  async function loadPendingMembers(clubId) {
    const element = document.getElementById('action-list');
    const { data, error } = await supabase.from('profiles')
      .select('id, full_name, email, phone, created_at, user_roles(role)')
      .eq('club_id', clubId)
      .eq('account_status', 'pending_approval')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    if (!data.length) {
      element.innerHTML = '<div class="empty">No membership applications are waiting for review.</div>';
      return;
    }

    element.innerHTML = data.map(member => {
      const role = member.user_roles?.[0]?.role;
      return `<a class="alert-row" href="members.html">
        <div class="alert-icon">${escapeHtml(initials(member.full_name))}</div>
        <div class="alert-body">
          <div class="alert-title">${escapeHtml(member.full_name)}</div>
          <div class="alert-sub">${escapeHtml(roleNames[role] || 'Member')} · ${escapeHtml(member.email || '')}</div>
        </div>
        <span class="member-review-link">Review →</span>
      </a>`;
    }).join('');
  }

  async function loadRecentInvitations(clubId) {
    const element = document.getElementById('next-event-section');
    const { data, error } = await supabase.from('invitations')
      .select('role, email, status, expires_at, created_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    if (!data.length) {
      element.innerHTML = '<div class="empty">No invitation links have been created yet.</div>';
      return;
    }

    element.innerHTML = data.map(invite => {
      const expired = invite.status === 'active' && new Date(invite.expires_at) <= new Date();
      const status = expired ? 'expired' : invite.status;
      return `<div class="card">
        <div class="card-head">
          <div class="card-title">${escapeHtml(roleNames[invite.role] || invite.role)}</div>
          <span class="invitation-status ${status === 'active' ? 'active' : ''}">${escapeHtml(status)}</span>
        </div>
        <div class="dashboard-invite-meta">${escapeHtml(invite.email || 'Any email')} · Expires ${escapeHtml(formatDate(invite.expires_at))}</div>
      </div>`;
    }).join('');
  }
})();