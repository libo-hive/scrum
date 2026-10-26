(function () {
  'use strict';

  const roleNames = {
    superadmin: 'Super admin', admin: 'Administrator', manager: 'Manager', finance: 'Finance',
    head_coach: 'Head coach', coach: 'Coach', assistant_coach: 'Assistant coach',
    medic: 'Medical staff', kit_man: 'Kit manager', volunteer: 'Volunteer',
    adult_player: 'Adult player', junior_player: 'Junior player', parent: 'Parent / guardian',
    sponsor: 'Sponsor', guest: 'Guest'
  };
  const message = document.getElementById('pageMessage');
  const pendingElement = document.getElementById('pendingMembers');
  const invitationsElement = document.getElementById('invitationList');
  const directoryElement = document.getElementById('memberDirectoryList');
  let activeClubId;
  let invitePlayers = [];
  let directoryEntries = [];
  let parentAccounts = [];
  let activeDirectoryCategory = 'all';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function showMessage(text, isError) {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle('is-error', Boolean(isError));
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  }

  function formatDate(value) {
    return new Date(value).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function initialize() {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.location.replace('login.html');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('club_id, account_status, onboarding_done')
      .eq('id', user.id)
      .single();
    if (profileError) throw profileError;
    if (profile.account_status !== 'active' || !profile.onboarding_done) {
      window.location.replace(profile.account_status === 'approved_pending_profile'
        ? 'onboarding.html'
        : 'login.html');
      return;
    }

    const { data: roles, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    if (roleError) throw roleError;
    if (!roles?.some(({ role }) => ['admin', 'manager'].includes(role))) {
      window.location.replace('dashboard.html');
      return;
    }
    activeClubId = profile.club_id;
    document.getElementById('membersMain').hidden = false;
    bindDirectoryControls();
    document.getElementById('inviteRole').addEventListener('change', updateParentInviteFields);
    updateParentInviteFields();
    const floatingMenu = document.getElementById('admin-fab-menu');
    if (floatingMenu) floatingMenu.hidden = false;
    await Promise.all([
      loadInvitePlayers(),
      refreshLists(),
      loadDirectory().catch(showDirectoryUnavailable)
    ]);
    const params = new URLSearchParams(window.location.search);
    if (params.get('quick') === 'create-parent-invite') {
      const roleSelect = document.getElementById('inviteRole');
      roleSelect.value = 'parent';
      updateParentInviteFields();
      const playerId = params.get('player');
      if (invitePlayers.some(player => player.id === playerId)) {
        document.getElementById('invitePlayer').value = playerId;
      }
      document.getElementById('inviteEmail').scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('inviteEmail').focus({ preventScroll: true });
    } else if (params.get('quick') === 'create-invite') {
      const roleSelect = document.getElementById('inviteRole');
      roleSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
      roleSelect.focus({ preventScroll: true });
    }
  }

  function bindDirectoryControls() {
    document.getElementById('addPlayerButton').addEventListener('click', openPlayerDialog);
    document.getElementById('closePlayerDialog').addEventListener('click', closePlayerDialog);
    document.getElementById('cancelPlayerDialog').addEventListener('click', closePlayerDialog);
    document.getElementById('addPlayerForm').addEventListener('submit', savePlayerRecord);
    document.querySelector('#addPlayerForm [name="date_of_birth"]').addEventListener('input', updatePlayerAge);
    document.getElementById('closeLinkParentDialog').addEventListener('click', closeParentLinkDialog);
    document.getElementById('cancelLinkParentDialog').addEventListener('click', closeParentLinkDialog);
    document.getElementById('linkParentForm').addEventListener('submit', saveParentLink);
    directoryElement.addEventListener('click', event => {
      const button = event.target.closest('[data-link-player]');
      if (button) openParentLinkDialog(button.dataset.linkPlayer, button.dataset.playerName);
    });
    document.getElementById('directorySearch').addEventListener('input', renderDirectory);
    document.getElementById('directoryFilters').addEventListener('click', event => {
      const filter = event.target.closest('[data-category]');
      if (!filter) return;
      activeDirectoryCategory = filter.dataset.category;
      document.querySelectorAll('.directory-filter').forEach(button => {
        const active = button === filter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderDirectory();
    });
    document.addEventListener('admin-fab-action', event => {
      if (event.detail?.action === 'create-player') openPlayerDialog();
    });
  }

  async function loadInvitePlayers() {
    const { data, error } = await supabase.from('players')
      .select('id, full_name, date_of_birth, team_members(status, left_at, teams(name, age_category))')
      .eq('club_id', activeClubId)
      .is('deleted_at', null)
      .order('full_name');
    if (error) throw error;
    invitePlayers = (data || []).map(player => {
      const categories = [...new Set((player.team_members || [])
        .filter(membership => !membership.left_at && membership.status === 'active')
        .map(membership => membership.teams?.age_category || membership.teams?.name)
        .filter(Boolean))];
      const category = categories.join(', ');
      return { ...player, categories: category ? [category] : [] };
    });
    const select = document.getElementById('invitePlayer');
    select.innerHTML = '<option value="">Select a player</option>' + invitePlayers.map(player =>
      `<option value="${escapeHtml(player.id)}">${escapeHtml(player.full_name)}${player.categories.length ? ` · ${escapeHtml(player.categories.join(', '))}` : ''}${player.date_of_birth ? ` · ${escapeHtml(player.date_of_birth)}` : ''}</option>`
    ).join('');
    select.disabled = invitePlayers.length === 0;
    document.querySelector('#invitePlayerGroup .form-hint').textContent = invitePlayers.length
      ? 'The parent will only see the player linked to this invitation. Team assignment is not required.'
      : 'Add a player record first to create a parent invitation.';
    updateParentInviteFields();
  }

  function showDirectoryUnavailable(error) {
    console.error('Member directory failed to load:', error);
    const text = error.code === '42703'
      ? 'The member directory database update is not applied yet. Apply migration 20261026073000_admin_member_directory.sql, then reload this page.'
      : error.message || 'Could not load the club member directory.';
    directoryElement.innerHTML = `<div class="member-empty">${escapeHtml(text)}</div>`;
    document.getElementById('directoryCount').textContent = '—';
  }

  function updateParentInviteFields() {
    const isParent = document.getElementById('inviteRole').value === 'parent';
    const group = document.getElementById('invitePlayerGroup');
    const select = document.getElementById('invitePlayer');
    const email = document.getElementById('inviteEmail');
    group.hidden = !isParent;
    select.required = isParent;
    email.required = isParent;
    document.getElementById('inviteEmailHint').textContent = isParent ? '(required for parent account)' : '(optional)';
  }

  async function loadDirectory() {
    const [profileResult, playerResult, accountResult] = await Promise.all([
      supabase.from('profiles')
        .select('id, full_name, email, phone, account_status, onboarding_done, user_roles(role)')
        .eq('club_id', activeClubId)
        .is('deleted_at', null)
        .order('full_name'),
      supabase.from('players')
        .select('id, full_name, nickname, email, phone, date_of_birth, membership_status, player_registration_details(category), team_members(status, left_at, teams(name, age_category))')
        .eq('club_id', activeClubId)
        .is('deleted_at', null)
        .order('full_name'),
      supabase.from('player_accounts').select('player_id, user_id')
    ]);
    for (const result of [profileResult, playerResult, accountResult]) {
      if (result.error) throw result.error;
    }
    const profileById = new Map((profileResult.data || []).map(profile => [profile.id, profile]));
    parentAccounts = (profileResult.data || []).filter(profile =>
      profile.account_status === 'active' &&
      profile.onboarding_done &&
      (profile.user_roles || []).some(({ role }) => role === 'parent')
    );
    const accountByPlayer = new Map((accountResult.data || []).map(account => [account.player_id, account.user_id]));
    const linkedUsers = new Set(accountByPlayer.values());
    const players = (playerResult.data || []).map(player => {
      const teams = (player.team_members || [])
        .filter(membership => !membership.left_at && membership.status === 'active')
        .map(membership => membership.teams)
        .filter(Boolean);
      const categories = [...new Set(teams.map(team => team.age_category || team.name).filter(Boolean))];
      const category = player.player_registration_details?.category || categories.join(', ') || 'Category not set';
      const userId = accountByPlayer.get(player.id);
      const account = userId ? profileById.get(userId) : null;
      return {
        id: player.id,
        type: 'player',
        category: 'players',
        name: player.full_name,
        subtitle: [category, player.nickname ? `“${player.nickname}”` : ''].filter(Boolean).join(' · '),
        email: account?.email || player.email || '',
        phone: account?.phone || player.phone || '',
        status: account ? 'Login linked' : 'Record only',
        statusClass: account ? 'is-linked' : '',
        searchText: `${player.full_name} ${category} ${player.nickname || ''} ${account?.email || player.email || ''} ${account?.phone || player.phone || ''}`
      };
    });

    const accountMembers = (profileResult.data || []).filter(profile => {
      const roles = (profile.user_roles || []).map(item => item.role);
      return roles.some(role => !['adult_player', 'junior_player'].includes(role)) || !linkedUsers.has(profile.id);
    }).map(profile => {
      const roles = (profile.user_roles || []).map(item => item.role);
      const category = memberCategory(roles);
      const roleLabel = roles.map(role => roleNames[role] || role).join(' · ') || 'Member';
      return {
        id: profile.id,
        type: 'account',
        category,
        name: profile.full_name,
        subtitle: roleLabel,
        email: profile.email || '',
        phone: profile.phone || '',
        status: accountStatusLabel(profile.account_status),
        statusClass: profile.account_status === 'active' ? 'is-active' : '',
        searchText: `${profile.full_name} ${roleLabel} ${profile.email || ''} ${profile.phone || ''} ${profile.account_status || ''}`
      };
    });

    directoryEntries = [...players, ...accountMembers].sort((a, b) => a.name.localeCompare(b.name));
    renderDirectory();
  }

  function memberCategory(roles) {
    if (roles.some(role => ['head_coach', 'coach', 'assistant_coach'].includes(role))) return 'coaches';
    if (roles.some(role => ['admin', 'manager', 'finance', 'medic', 'kit_man', 'volunteer'].includes(role))) return 'staff';
    if (roles.includes('parent')) return 'parents';
    if (roles.some(role => ['adult_player', 'junior_player'].includes(role))) return 'players';
    return 'other';
  }

  function accountStatusLabel(status) {
    return ({
      active: 'Active',
      pending_approval: 'Pending approval',
      approved_pending_profile: 'Profile setup',
      suspended: 'Suspended',
      rejected: 'Rejected'
    })[status] || status || 'Member';
  }

  function renderDirectory() {
    const search = document.getElementById('directorySearch').value.trim().toLowerCase();
    const visible = directoryEntries.filter(entry =>
      (activeDirectoryCategory === 'all' || entry.category === activeDirectoryCategory) &&
      (!search || entry.searchText.toLowerCase().includes(search))
    );
    document.getElementById('directoryCount').textContent = String(visible.length);
    if (!visible.length) {
      directoryElement.innerHTML = `<div class="member-empty">${directoryEntries.length
        ? 'No members match this category or search.'
        : 'No player records or member accounts found yet.'}</div>`;
      return;
    }

    const categories = [
      ['players', 'Players'],
      ['coaches', 'Coaches'],
      ['staff', 'Club staff'],
      ['parents', 'Parents / guardians'],
      ['other', 'Other members']
    ];
    const groups = activeDirectoryCategory === 'all'
      ? categories.map(([key, label]) => [label, visible.filter(item => item.category === key)]).filter(([, items]) => items.length)
      : [[categoryLabel(activeDirectoryCategory), visible]];
    directoryElement.innerHTML = groups.map(([label, items]) =>
      `<div class="member-category-label">${escapeHtml(label)}</div>${items.map(renderDirectoryEntry).join('')}`
    ).join('');
  }

  function categoryLabel(category) {
    return ({
      players: 'Players',
      coaches: 'Coaches',
      staff: 'Club staff',
      parents: 'Parents / guardians',
      other: 'Other members'
    })[category] || 'Members';
  }

  function renderDirectoryEntry(entry) {
    return `<article class="member-row">
      <div class="member-avatar">${escapeHtml(initials(entry.name))}</div>
      <div class="member-row-main">
        <div class="member-row-name">${escapeHtml(entry.name)}</div>
        <div class="member-row-meta">${escapeHtml(entry.subtitle)}</div>
        <div class="member-row-meta">${escapeHtml([entry.email, entry.phone].filter(Boolean).join(' · ') || 'Contact details not provided')}</div>
        <span class="member-row-status ${entry.statusClass}">${escapeHtml(entry.status)}</span>
      </div>
      ${entry.type === 'player' ? `<div class="member-row-actions"><button class="member-action approve-action" type="button" data-link-player="${escapeHtml(entry.id)}" data-player-name="${escapeHtml(entry.name)}">Link to parent</button></div>` : ''}
    </article>`;
  }

  function openParentLinkDialog(playerId, playerName) {
    const select = document.getElementById('linkParentAccount');
    const submit = document.getElementById('saveParentLink');
    const hint = document.getElementById('linkParentHint');
    select.innerHTML = '<option value="">Select a parent account</option>' + parentAccounts.map(parent =>
      `<option value="${escapeHtml(parent.id)}">${escapeHtml(parent.full_name)}${parent.email ? ` · ${escapeHtml(parent.email)}` : ''}</option>`
    ).join('');
    select.disabled = parentAccounts.length === 0;
    submit.disabled = parentAccounts.length === 0;
    hint.textContent = parentAccounts.length
      ? 'Only active parent accounts that completed onboarding are listed.'
      : 'There are no active parent accounts yet. Invite and approve a parent first.';
    document.getElementById('linkParentPlayerId').value = playerId;
    document.getElementById('linkParentPlayer').value = playerName;
    document.getElementById('linkParentDialog').showModal();
  }

  function closeParentLinkDialog() {
    document.getElementById('linkParentDialog').close();
  }

  async function saveParentLink(event) {
    event.preventDefault();
    const submit = document.getElementById('saveParentLink');
    const playerId = document.getElementById('linkParentPlayerId').value;
    const parentUserId = document.getElementById('linkParentAccount').value;
    if (!playerId || !parentUserId) return;
    submit.disabled = true;
    submit.textContent = 'Linking…';
    try {
      const { error } = await supabase.rpc('link_player_to_parent', {
        p_player_id: playerId,
        p_parent_user_id: parentUserId
      });
      if (error) throw error;
      closeParentLinkDialog();
      showMessage('Player linked to the parent account. Their dashboard will now include this player.', false);
      try {
        await loadDirectory();
      } catch (refreshError) {
        console.error('Refreshing the member directory after linking failed:', refreshError);
        showMessage('Player linked, but the directory could not refresh. Reload the page to see the update.', true);
      }
    } catch (error) {
      console.error('Linking player to parent failed:', error);
      showMessage(error.message || 'Could not link this player to the parent account.', true);
    } finally {
      submit.disabled = parentAccounts.length === 0;
      submit.textContent = 'Link player';
    }
  }

  function openPlayerDialog() {
    const form = document.getElementById('addPlayerForm');
    form.reset();
    updatePlayerAge();
    document.getElementById('addPlayerDialog').showModal();
  }

  function updatePlayerAge() {
    const value = document.querySelector('#addPlayerForm [name="date_of_birth"]').value;
    document.getElementById('playerAgeThisYear').textContent = value
      ? String(new Date().getFullYear() - new Date(`${value}T00:00:00`).getFullYear())
      : '—';
  }

  function closePlayerDialog() {
    document.getElementById('addPlayerDialog').close();
  }

  async function savePlayerRecord(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const details = Object.fromEntries(values.entries());
    for (const field of ['height_cm', 'weight_kg']) {
      details[field] = details[field] ? Number(details[field]) : null;
    }
    for (const field of ['email', 'primary_guardian_email', 'secondary_guardian_name',
      'secondary_guardian_relationship', 'secondary_guardian_phone', 'nickname', 'phone', 'medical_conditions']) {
      details[field] = String(details[field] || '').trim() || null;
    }
    for (const field of ['full_name', 'category', 'identity_document', 'date_of_birth', 'address',
      'primary_guardian_name', 'primary_guardian_identity_document', 'primary_guardian_phone',
      'primary_guardian_relationship', 'primary_guardian_address']) {
      details[field] = String(details[field] || '').trim();
    }
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      const { error } = await supabase.rpc('create_manual_player_record', { p_details: details });
      if (error) throw error;
      closePlayerDialog();
      showMessage('Player record saved. No team or login account was created.', false);
      await Promise.all([loadDirectory(), loadInvitePlayers()]);
    } catch (error) {
      console.error('Manual player record creation failed:', error);
      showMessage(error.message || 'Could not save the player record.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Save player record';
    }
  }

  async function refreshLists() {
    message.hidden = true;
    await Promise.all([loadPendingMembers(), loadInvitations()]);
  }

  async function loadPendingMembers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, created_at, user_roles(role)')
      .eq('club_id', activeClubId)
      .eq('account_status', 'pending_approval')
      .order('created_at', { ascending: false });
    if (error) {
      pendingElement.innerHTML = '<div class="member-empty">Could not load membership applications.</div>';
      throw error;
    }

    document.getElementById('pendingCount').textContent = String(data.length);
    pendingElement.innerHTML = data.length ? data.map(member => {
      const role = member.user_roles?.[0]?.role;
      return `<article class="member-row">
        <div class="member-avatar">${escapeHtml(initials(member.full_name))}</div>
        <div class="member-row-main">
          <div class="member-row-name">${escapeHtml(member.full_name)}</div>
          <div class="member-row-meta">${escapeHtml(roleNames[role] || 'Member')} · ${escapeHtml(member.email || '')} · ${escapeHtml(member.phone || '')}</div>
          <div class="member-row-meta">Applied ${escapeHtml(formatDate(member.created_at))}</div>
        </div>
        <div class="member-row-actions">
          <button class="member-action approve-action" data-member-action="approve" data-user-id="${escapeHtml(member.id)}">Approve</button>
          <button class="member-action reject-action" data-member-action="reject" data-user-id="${escapeHtml(member.id)}">Reject</button>
        </div>
      </article>`;
    }).join('') : '<div class="member-empty">No applications waiting for approval.</div>';
  }

  async function loadInvitations() {
    const { data, error } = await supabase
      .from('invitations')
      .select('id, token, role, email, player_id, expires_at, status, created_at')
      .eq('club_id', activeClubId)
      .order('created_at', { ascending: false })
      .limit(12);
    if (error) {
      invitationsElement.innerHTML = '<div class="member-empty">Could not load invitations.</div>';
      throw error;
    }

    invitationsElement.innerHTML = data.length ? data.map(invite => {
      const expired = invite.status === 'active' && new Date(invite.expires_at) <= new Date();
      const status = expired ? 'expired' : invite.status;
      return `<article class="invitation-row">
        <div>
          <div class="invitation-role">${escapeHtml(roleNames[invite.role] || invite.role)}</div>
          <div class="invitation-meta">${escapeHtml(invite.email || 'Any email')}${invite.player_id ? ` · Player: ${escapeHtml(invitePlayers.find(player => player.id === invite.player_id)?.full_name || 'Linked player')}` : ''} · Expires ${escapeHtml(formatDate(invite.expires_at))}</div>
        </div>
        <div class="invitation-tools">
          <span class="invitation-status ${status === 'active' ? 'active' : ''}">${escapeHtml(status)}</span>
          ${status === 'active' ? `<button class="member-action revoke-action" data-revoke-id="${escapeHtml(invite.id)}">Revoke</button>` : ''}
        </div>
      </article>`;
    }).join('') : '<div class="member-empty">No invitation links have been created yet.</div>';
  }

  document.getElementById('inviteCreateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('createInviteButton');
    const role = document.getElementById('inviteRole').value;
    const email = document.getElementById('inviteEmail').value.trim().toLowerCase();
    const playerId = document.getElementById('invitePlayer').value || null;
    const days = Number(document.getElementById('inviteDuration').value);
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (role === 'parent' && (!email || !playerId)) {
        throw new Error('For a parent invitation, enter the parent email and select their player record.');
      }
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase.from('invitations').insert({
        club_id: activeClubId,
        created_by: user.id,
        role,
        player_id: role === 'parent' ? playerId : null,
        email: email || null,
        expires_at: expiresAt
      }).select('token, role, expires_at').single();
      if (error) throw error;

      const link = new URL('invite.html', window.location.href);
      link.searchParams.set('token', data.token);
      document.getElementById('createdInviteMeta').textContent =
        `${roleNames[data.role] || data.role}${role === 'parent' ? ` for ${invitePlayers.find(player => player.id === playerId)?.full_name || 'player'}` : ''} · expires ${formatDate(data.expires_at)}`;
      document.getElementById('createdInviteLink').value = link.toString();
      document.getElementById('createdInvite').hidden = false;
      showMessage('Invitation link created. Share it only with the intended member.', false);
      await loadInvitations();
    } catch (error) {
      console.error('Invitation creation failed:', error);
      showMessage(error.message || 'Could not create the invitation link.', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Create invite link';
    }
  });

  document.getElementById('copyInviteButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('createdInviteLink').value);
      document.getElementById('copyInviteButton').textContent = 'Copied';
    } catch (error) {
      console.error('Copy invitation link failed:', error);
      showMessage('Could not copy the link. Select and copy it from the field.', true);
    }
  });

  pendingElement.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-member-action]');
    if (!button) return;
    const approve = button.dataset.memberAction === 'approve';
    if (!approve && !window.confirm('Reject this member application?')) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from('profiles').update({
        account_status: approve ? 'approved_pending_profile' : 'rejected'
      }).eq('id', button.dataset.userId).eq('club_id', activeClubId);
      if (error) throw error;
      showMessage(approve ? 'Application approved. The member can now complete their profile.' : 'Application rejected.', false);
      await loadPendingMembers();
    } catch (error) {
      console.error('Membership review failed:', error);
      showMessage(error.message || 'Could not update the application.', true);
      button.disabled = false;
    }
  });

  invitationsElement.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-revoke-id]');
    if (!button) return;
    button.disabled = true;
    try {
      const { error } = await supabase.from('invitations').update({
        status: 'revoked',
        revoked_at: new Date().toISOString()
      }).eq('id', button.dataset.revokeId).eq('club_id', activeClubId);
      if (error) throw error;
      showMessage('Invitation link revoked.', false);
      await loadInvitations();
    } catch (error) {
      console.error('Invitation revocation failed:', error);
      showMessage(error.message || 'Could not revoke the invitation link.', true);
      button.disabled = false;
    }
  });

  document.getElementById('refreshMembers').addEventListener('click', () => {
    Promise.all([refreshLists(), loadDirectory().catch(showDirectoryUnavailable)]).catch(error => {
      console.error('Refreshing member data failed:', error);
      showMessage(error.message || 'Could not refresh member data.', true);
    });
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign out failed:', error);
      showMessage(error.message || 'Could not sign out.', true);
      return;
    }
    window.location.replace('login.html');
  });

  initialize().catch(error => {
    console.error('Member management setup failed:', error);
    document.getElementById('membersMain').hidden = false;
    showMessage(error.message || 'Could not load member management.', true);
  });
})();
