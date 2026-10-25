(function () {
  'use strict';

  const form = document.getElementById('onboardingForm');
  const fields = document.getElementById('roleFields');
  const message = document.getElementById('onboardingMessage');
  const submit = document.getElementById('onboardingSubmit');
  const signOut = document.getElementById('signOutButton');
  const summary = document.getElementById('profileSummary');

  const roleNames = {
    superadmin: 'Super admin', admin: 'Administrator', manager: 'Manager', finance: 'Finance',
    head_coach: 'Head coach', coach: 'Coach', assistant_coach: 'Assistant coach',
    medic: 'Medical staff', kit_man: 'Kit manager', volunteer: 'Volunteer',
    adult_player: 'Adult player', junior_player: 'Junior player', parent: 'Parent / guardian',
    sponsor: 'Sponsor', guest: 'Guest'
  };
  const playerRoles = ['adult_player', 'junior_player'];
  const coachRoles = ['head_coach', 'coach', 'assistant_coach'];

  function field(name, label, type, options) {
    const id = `member-${name}`;
    let input;
    if (type === 'select') {
      input = `<select id="${id}" name="${name}" required>${options.map(([value, text]) =>
        `<option value="${value}">${text}</option>`).join('')}</select>`;
    } else if (type === 'textarea') {
      input = `<textarea id="${id}" name="${name}" ${options?.required ? 'required' : ''} placeholder="${options?.placeholder || ''}"></textarea>`;
    } else {
      input = `<input id="${id}" name="${name}" type="${type}" ${options?.required === false ? '' : 'required'} ${options?.placeholder ? `placeholder="${options.placeholder}"` : ''}>`;
    }
    return `<div class="form-group"><label for="${id}">${label}</label>${input}</div>`;
  }

  function renderRoleFields(role, profile, linkedPlayer) {
    if (playerRoles.includes(role)) {
      return field('date_of_birth', 'Date of birth', 'date') +
        field('gender', 'Gender', 'select', [['', 'Select gender'], ['Male', 'Male'], ['Female', 'Female'], ['Prefer not to say', 'Prefer not to say']]) +
        field('preferred_position', 'Preferred position', 'text', { placeholder: 'e.g. Scrum-half' }) +
        field('school', 'School / college', 'text', { required: false, placeholder: 'School or college' }) +
        field('home_address', 'Home address', 'textarea', { required: false, placeholder: 'Address' }) +
        field('emergency_contact_name', 'Emergency contact name', 'text') +
        field('emergency_contact_phone', 'Emergency contact phone', 'tel') +
        field('emergency_relationship', 'Relationship to player', 'text', { placeholder: 'e.g. Parent' });
    }
    if (role === 'parent') {
      return renderParentFields(profile, linkedPlayer);
    }

    function renderParentFields(profile, player) {
      const value = (input) => escapeHtml(input || '');
      const linkedCategory = player.category || 'Category to be confirmed by the club';
      return `
        <section class="onboarding-form-section full-width">
          <div class="dash-tag">Player details</div>
          <p class="onboarding-section-copy">This invitation is linked to a player already on the club roster. Check their details carefully.</p>
        </section>
        <div class="form-group"><label for="member-player_full_name">Name as per MyKid / MyKad / Passport</label><input id="member-player_full_name" name="player_full_name" required maxlength="160" value="${value(player.full_name)}"></div>
        <div class="form-group"><label for="member-player_nickname">Nickname</label><input id="member-player_nickname" name="player_nickname" maxlength="80" value="${value(player.nickname)}"></div>
        <div class="form-group"><label for="member-player_phone">Player telephone number</label><input id="member-player_phone" name="player_phone" type="tel" maxlength="40" value="${value(player.phone)}"></div>
        <div class="form-group"><label for="member-player_identity_document">MyKad / MyKid / Passport number</label><input id="member-player_identity_document" name="player_identity_document" required maxlength="80" autocomplete="off"></div>
        <div class="form-group"><label for="member-player_height_cm">Height (cm)</label><input id="member-player_height_cm" name="height_cm" type="number" min="40" max="250" step="0.1" inputmode="decimal"></div>
        <div class="form-group"><label for="member-player_weight_kg">Weight (kg)</label><input id="member-player_weight_kg" name="weight_kg" type="number" min="5" max="250" step="0.1" inputmode="decimal"></div>
        <div class="form-group"><label for="member-player_date_of_birth">Date of birth</label><input id="member-player_date_of_birth" name="player_date_of_birth" type="date" required value="${value(player.date_of_birth)}"></div>
        <div class="form-group"><label for="member-player_age_this_year">Age this year</label><input id="member-player_age_this_year" value="" readonly aria-describedby="ageHelp"><small id="ageHelp">Calculated from date of birth.</small></div>
        <div class="form-group"><label for="member-player_category">Category</label><input id="member-player_category" name="player_category" value="${value(linkedCategory)}" readonly></div>
        <div class="form-group full-width"><label for="member-player_address">Player address</label><textarea id="member-player_address" name="player_address" required maxlength="500"></textarea></div>
        <div class="form-group full-width"><label for="member-medical_conditions">Medical conditions</label><textarea id="member-medical_conditions" name="medical_conditions" maxlength="1000" placeholder="Allergies, asthma, diabetes, heart conditions, or none"></textarea></div>

        <section class="onboarding-form-section full-width">
          <div class="dash-tag">Parent / guardian 1</div>
          <p class="onboarding-section-copy">Primary guardian details. The name and phone are prefilled from the account registration.</p>
        </section>
        <div class="form-group"><label for="member-guardian_name">Name</label><input id="member-guardian_name" name="guardian_name" required maxlength="160" value="${value(profile.full_name)}"></div>
        <div class="form-group"><label for="member-guardian_identity_document">MyKad / Passport number</label><input id="member-guardian_identity_document" name="guardian_identity_document" required maxlength="80" autocomplete="off"></div>
        <div class="form-group"><label for="member-guardian_phone">Telephone number</label><input id="member-guardian_phone" name="guardian_phone" type="tel" required maxlength="40" value="${value(profile.phone)}"></div>
        <div class="form-group"><label for="member-relationship_to_player">Relationship to player</label><input id="member-relationship_to_player" name="relationship_to_player" required maxlength="60" placeholder="e.g. Mother, father, guardian"></div>
        <div class="form-group full-width"><label for="member-guardian_address">Guardian address</label><textarea id="member-guardian_address" name="guardian_address" required maxlength="500"></textarea></div>

        <section class="onboarding-form-section full-width">
          <div class="dash-tag">Parent / guardian 2 <span class="onboarding-optional">Optional</span></div>
        </section>
        <div class="form-group"><label for="member-guardian2_name">Name</label><input id="member-guardian2_name" name="guardian2_name" maxlength="160"></div>
        <div class="form-group"><label for="member-guardian2_relationship">Relationship to player</label><input id="member-guardian2_relationship" name="guardian2_relationship" maxlength="60"></div>
        <div class="form-group full-width"><label for="member-guardian2_phone">Telephone number</label><input id="member-guardian2_phone" name="guardian2_phone" type="tel" maxlength="40"></div>

        <section class="onboarding-form-section full-width">
          <div class="dash-tag">Parent / guardian consent</div>
          <p class="onboarding-consent-note">Draft wording for club review before this form is used for registrations. Please read each item.</p>
        </section>
        <div class="onboarding-consents full-width">
          ${consent('consent_rugby_risk', 'I understand that rugby is a contact sport and that injuries may occur during training and competition. I understand the ordinary risks involved in participation.', true)}
          ${consent('consent_volunteer_program', 'I understand the rugby programme is volunteer-run and will support its development and enjoyment where I can.', true)}
          ${consent('consent_guardian_presence', 'I will remain present or contactable during activities and accept responsibility for my child’s safety and arrangements outside the activity.', true)}
          ${consent('consent_information_and_rules', 'I confirm the information submitted is accurate and agree to follow the Club’s rules and regulations as updated from time to time.', true)}
          ${consent('consent_fees', 'I understand fees are due before the 8th of each month and payment proof should be sent to the Club Treasurer with my child’s full name and category.', true)}
          ${consent('consent_player_ethics', 'I have read the Player Ethics Code and will support my child in attending on time, following coaches’ instructions, and treating others respectfully.', true)}
          ${consent('consent_parent_ethics', 'I have read the Parents and Guardians Ethics Code and will respect coaches and officials, support players positively, and follow Club conduct guidelines.', true)}
          ${consent('consent_media', 'I consent to the Club using photographs or videos of my child for Club and rugby promotion, development, and marketing.', false)}
          ${consent('consent_marketing_updates', 'I consent to the Club using my contact details to send Club updates, news, promotional materials, or marketing communications.', false)}
        </div>`;
    }

    function consent(name, text, required) {
      return `<label class="onboarding-consent"><input type="checkbox" name="${name}" value="true" ${required ? 'required' : ''}><span>${text} <strong>(${required ? 'required' : 'optional'})</strong></span></label>`;
    }
    if (coachRoles.includes(role)) {
      return field('coaching_category', 'Coaching category', 'text', { placeholder: 'e.g. Community Level 1' }) +
        field('preferred_team', 'Team / age group', 'text', { placeholder: 'e.g. U14 Boys' }) +
        field('coaching_experience', 'Coaching experience', 'textarea', { required: false, placeholder: 'Years coaching, qualifications or relevant experience' });
    }
    return field('department', 'Department / responsibility', 'text', { placeholder: 'e.g. Finance, medical or kit' }) +
      field('emergency_contact_name', 'Emergency contact name', 'text') +
      field('emergency_contact_phone', 'Emergency contact phone', 'tel') +
      field('notes', 'Additional information', 'textarea', { required: false, placeholder: 'Anything the club should know' });
  }

  function showMessage(text, isError) {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle('is-error', Boolean(isError));
  }

  async function initialize() {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) {
        window.location.replace('login.html');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, email, phone, account_status, onboarding_done')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;

      if (profile.account_status === 'active' && profile.onboarding_done) {
        window.location.replace('dashboard.html');
        return;
      }
      if (profile.account_status !== 'approved_pending_profile'
          && !(profile.account_status === 'active' && !profile.onboarding_done)) {
        showMessage(profile.account_status === 'pending_approval'
          ? 'Your application is still waiting for administrator approval.'
          : 'Your account cannot continue onboarding. Please contact the club administrator.', true);
        signOut.hidden = false;
        return;
      }

      const { data: memberships, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .limit(1);
      if (roleError) throw roleError;
      const role = memberships?.[0]?.role;
      if (!role || !roleNames[role]) throw new Error('Your membership role could not be loaded. Please contact the club administrator.');

      let linkedPlayer = null;
      if (role === 'parent') {
        const { data, error } = await supabase.rpc('get_parent_onboarding_details');
        if (error) throw error;
        linkedPlayer = data?.[0];
        if (!linkedPlayer) throw new Error('This parent invitation is not linked to a roster player. Please contact the club administrator.');
      }

      document.getElementById('onboardingIntro').textContent = role === 'parent'
        ? 'Complete your child’s registration and guardian details. Your account will be linked to the roster player selected by the club.'
        : `Tell us a little more about yourself as a ${roleNames[role].toLowerCase()}.`;
      summary.innerHTML = `<strong>${escapeHtml(profile.full_name)}</strong><span>${escapeHtml(roleNames[role])} · ${escapeHtml(profile.email || user.email || '')}</span>`;
      summary.hidden = false;
      fields.innerHTML = renderRoleFields(role, profile, linkedPlayer);
      if (role === 'parent') {
        const dateOfBirth = document.getElementById('member-player_date_of_birth');
        const age = document.getElementById('member-player_age_this_year');
        const updateAge = () => {
          age.value = dateOfBirth.value
            ? String(new Date().getFullYear() - Number(dateOfBirth.value.slice(0, 4)))
            : '';
        };
        dateOfBirth.addEventListener('change', updateAge);
        updateAge();
      }
      form.dataset.role = role;
      form.hidden = false;
    } catch (error) {
      console.error('Onboarding setup failed:', error);
      showMessage(error.message || 'We could not load your profile. Please try again.', true);
      signOut.hidden = false;
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const details = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.role === 'parent') {
      const consentNames = [...form.querySelectorAll('[name^="consent_"]')].map(input => input.name);
      details.consents = Object.fromEntries(consentNames.map(name => [
        name.replace('consent_', ''),
        form.elements.namedItem(name).checked
      ]));
    }
    message.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Saving profile…';
    try {
      const { error } = await supabase.rpc('complete_member_onboarding', { p_details: details });
      if (error) throw error;
      window.location.replace('dashboard.html');
    } catch (error) {
      console.error('Onboarding submission failed:', error);
      showMessage(error.message || 'Your profile could not be saved. Please try again.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Complete profile & open dashboard';
    }
  });

  signOut.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Sign out failed:', error);
      showMessage('Could not sign out. Please try again.', true);
      return;
    }
    window.location.replace('login.html');
  });

  initialize();
})();
