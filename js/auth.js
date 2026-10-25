// js/auth.js

const loginForm = document.getElementById('loginForm');
const submitBtn = document.getElementById('submitBtn');
const errorMsg = document.getElementById('errorMsg');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  // Reset UI
  errorMsg.style.display = 'none';
  errorMsg.textContent = '';
  submitBtn.textContent = 'Signing in...';
  submitBtn.disabled = true;

  try {
    // Semakan asas jika Supabase SDK belum dimuatkan
    if (typeof supabase === 'undefined') {
      throw new Error('Sistem gagal berhubung dengan pelayan. Sila muat semula halaman.');
    }

    // 1. Login ke Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (authError) throw authError;

    // 2. Check account_status dalam table 'profiles'
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('account_status, onboarding_done')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      // Jika profil gagal dibaca, pastikan sesi dibatalkan
      console.error('Profile lookup failed:', profileError);
      await supabase.auth.signOut();
      throw new Error(`Gagal mendapatkan maklumat profil (${profileError.code || 'unknown'}): ${profileError.message}`);
    }

    // 3. Redirect / Batalkan sesi berdasarkan status
    switch (profile.account_status) {
      case 'active':
        if (!profile.onboarding_done) {
          window.location.href = 'onboarding.html';
          break;
        }
        window.location.href = 'dashboard.html';
        break;
        
      case 'approved_pending_profile':
        window.location.href = 'onboarding.html';
        break;
        
      case 'pending_approval':
        await supabase.auth.signOut(); // Batalkan sesi kerana akaun belum diluluskan
        throw new Error('Your account is pending admin approval. Please check back later.');
        
      case 'rejected':
        await supabase.auth.signOut(); // Batalkan sesi
        throw new Error('Your account application was rejected. Please contact the admin.');
        
      case 'suspended':
        await supabase.auth.signOut(); // Batalkan sesi
        throw new Error('Your account has been suspended.');
        
      default:
        await supabase.auth.signOut(); // Batalkan sesi
        throw new Error('Unknown account status. Please contact support.');
    }

  } catch (error) {
    console.error('Login Error:', error);
    
    // Kemaskini UI dengan mesej ralat
    errorMsg.textContent = error.message || 'An error occurred during sign in.';
    errorMsg.style.display = 'block';
  } finally {
    // Menggunakan finally memastikan butang diaktifkan semula walau apa pun berlaku
    submitBtn.textContent = 'Sign In';
    submitBtn.disabled = false;
  }
});