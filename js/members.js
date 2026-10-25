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
  let activeClubId;
  let invitePlayers = [];

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
    window.BottomNav.render('admin');
    await loadInvitePlayers();
    await refreshLists();
    document.getElementById('inviteRole').addEventListener('change', updateParentInviteFields);
    updateParentInviteFields();
    const floatingMenu = document.getElementById('admin-fab-menu');
    if (floatingMenu) floatingMenu.hidden = false;
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

    async function loadInvitePlayers() {
      const { data, error } = await supabase.from('team_members')
        .select('player_id, players!inner(id, full_name, date_of_birth), teams!inner(name, age_category)')
        .eq('teams.club_id', activeClubId)
        .is('left_at', null)
        .eq('status', 'active');
      if (error) throw error;
      const playerMap = new Map();
      for (const row of data || []) {
        const player = row.players;
        if (!player) continue;
        const existing = playerMap.get(player.id) || { ...player, categories: [] };
        const category = row.teams?.age_category || row.teams?.name;
        if (category && !existing.categories.includes(category)) existing.categories.push(category);
        playerMap.set(player.id, existing);
      }
      invitePlayers = [...playerMap.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
      const select = document.getElementById('invitePlayer');
      select.innerHTML = '<option value="">Select a player</option>' + invitePlayers.map(player =>
        `<option value="${escapeHtml(player.id)}">${escapeHtml(player.full_name)}${player.categories.length ? ` · ${escapeHtml(player.categories.join(', '))}` : ''}${player.date_of_birth ? ` · ${escapeHtml(player.date_of_birth)}` : ''}</option>`
      ).join('');
      select.disabled = invitePlayers.length === 0;
      document.querySelector('#invitePlayerGroup .form-hint').textContent = invitePlayers.length
        ? 'The parent will only see the player linked to this invitation.'
        : 'No roster players found. Add the junior to a squad before creating a parent invitation.';
      updateParentInviteFields();
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
        throw new Error('For a parent invitation, enter the parent email and select their player from the roster.');
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
    refreshLists().catch(error => {
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
