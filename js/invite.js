(function () {
  'use strict';

  const form = document.getElementById('inviteForm');
  const button = document.getElementById('inviteSubmit');
  const message = document.getElementById('inviteMessage');
  const token = new URLSearchParams(window.location.search).get('token')?.trim();
  const roleNames = {
    superadmin: 'Super admin', admin: 'Administrator', manager: 'Manager', finance: 'Finance',
    head_coach: 'Head coach', coach: 'Coach', assistant_coach: 'Assistant coach',
    medic: 'Medical staff', kit_man: 'Kit manager', volunteer: 'Volunteer',
    adult_player: 'Adult player', junior_player: 'Junior player', parent: 'Parent / guardian',
    sponsor: 'Sponsor', guest: 'Guest'
  };
  let inviteEmail = null;

  function showMessage(text, isError) {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle('is-error', Boolean(isError));
  }

  if (!token) {
    form.hidden = true;
    showMessage('This invitation link is missing its token. Ask your club administrator for a new link.', true);
  } else {
    initializeInvite();
  }

  async function initializeInvite() {
    try {
      const { data, error } = await supabase.rpc('get_invite_details', { p_token: token });
      if (error) throw error;
      const invite = data?.[0];
      if (!invite) {
        form.hidden = true;
        showMessage('This invitation is invalid, expired, or has already been used. Ask your club administrator for a new link.', true);
        return;
      }
      inviteEmail = invite.email;
      const emailInput = document.getElementById('email');
      if (inviteEmail) {
        emailInput.value = inviteEmail;
        emailInput.readOnly = true;
      }
      document.getElementById('inviteIntro').textContent =
        invite.role === 'parent' && invite.player_name
          ? `Register as the parent or guardian of ${invite.player_name}. An administrator will review your application before you can continue.`
          : `Register as ${roleNames[invite.role] || 'a club member'}. An administrator will review your application before you can continue.`;
      form.hidden = false;
    } catch (error) {
      console.error('Invitation lookup failed:', error);
      form.hidden = true;
      showMessage(error.message || 'We could not validate this invitation. Ask your club administrator for a new link.', true);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const phone = document.getElementById('phone').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    message.hidden = true;
    if (password.length < 8) {
      showMessage('Choose a password with at least 8 characters.', true);
      return;
    }
    if (password !== confirmPassword) {
      showMessage('The passwords do not match.', true);
      return;
    }
    if (inviteEmail && email !== inviteEmail.toLowerCase()) {
      showMessage('Use the email address this invitation was issued to.', true);
      return;
    }

    button.disabled = true;
    button.textContent = 'Sending application…';
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, phone },
          emailRedirectTo: new URL('login.html', window.location.href).toString()
        }
      });
      if (error) throw error;
      if (!data.user) throw new Error('Account registration did not complete. Please try again.');

      const { error: redeemError } = await supabase.rpc('redeem_invite', {
        p_token: token,
        p_user_id: data.user.id,
        p_name: fullName,
        p_email: email,
        p_phone: phone
      });
      if (redeemError) throw redeemError;

      if (data.session) await supabase.auth.signOut();
      form.hidden = true;
      showMessage('Application sent. An administrator will review your membership. If prompted, verify your email before signing in.', false);
    } catch (error) {
      console.error('Invitation registration failed:', error);
      showMessage(error.message || 'We could not submit your application. Check the invitation details and try again.', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Send application';
    }
  });
})();
