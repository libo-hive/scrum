(async function () {
  'use strict';

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.location.replace('login.html');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_status, onboarding_done')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;
    if (profile.account_status !== 'active' || !profile.onboarding_done) {
      window.location.replace(profile.account_status === 'approved_pending_profile'
        ? 'onboarding.html'
        : 'login.html');
      return;
    }

    document.getElementById('dashboardMain')?.removeAttribute('hidden');
    document.getElementById('app-dock')?.removeAttribute('hidden');
  } catch (error) {
    console.error('Dashboard access check failed:', error);
    await supabase.auth.signOut();
    window.location.replace('login.html');
  }
})();
