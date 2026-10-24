// js/auth.js

const loginForm = document.getElementById('loginForm');
const submitBtn = document.getElementById('submitBtn');
const errorMsg = document.getElementById('errorMsg');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  // Reset UI
  errorMsg.style.display = 'none';
  submitBtn.textContent = 'Signing in...';
  submitBtn.disabled = true;

  try {
    // 1. Login ke Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (authError) throw authError;

    // 2. Check account_status dalam table 'profiles'
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_status')
      .eq('id', authData.user.id)
      .single();

    if (profileError) throw profileError;

    // 3. Redirect based on status
    switch (profile.account_status) {
      case 'active':
        window.location.href = 'dashboard.html';
        break;
      case 'approved_pending_profile':
        window.location.href = 'onboarding.html';
        break;
      case 'pending_approval':
        throw new Error('Your account is pending admin approval. Please check back later.');
      case 'rejected':
        throw new Error('Your account application was rejected. Please contact the admin.');
      case 'suspended':
        throw new Error('Your account has been suspended.');
      default:
        throw new Error('Unknown account status. Please contact support.');
    }

  } catch (error) {
    console.error(error);
    errorMsg.textContent = error.message;
    errorMsg.style.display = 'block';
    submitBtn.textContent = 'Sign In';
    submitBtn.disabled = false;
    
    // Logout if failed midway
    await supabase.auth.signOut();
  }
});