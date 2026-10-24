// js/app.js

// --- 1. INIT SUPABASE ---
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://mtopqypcrmzihmfueujy.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10b3BxeXBjcm16aWhtZnVldWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMDQ2OTMsImV4cCI6MjEwNzU4MDY5M30.oocXGBr6pBA7GS1KjOhWIPejHausQ3k9UgRxKQ0fgh4'; // Ganti dengan anon key ko

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 2. MOBILE MENU ---
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('mobileNav').classList.toggle('open');
});
document.querySelectorAll('.mobile-nav a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('mobileNav').classList.remove('open'));
});

// --- 3. FETCH NEXT MATCH ---
async function getNextMatch() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('type', 'match')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)
    .single();

  const box = document.getElementById('nextMatchBox');
  
  if (error || !data) {
    box.innerHTML = `<div class="loading" style="color: var(--gray)">No upcoming matches scheduled.</div>`;
    return;
  }

  const date = new Date(data.starts_at).toLocaleDateString('en-MY', { 
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' 
  });
  const time = new Date(data.starts_at).toLocaleTimeString('en-MY', {
    hour: '2-digit', minute: '2-digit'
  });
  
  box.innerHTML = `
    <div class="next-card">
      <div class="next-head">
        <div class="next-lbl">FIXTURE</div>
        <div class="next-badges"><span class="chip">Rugby</span></div>
      </div>
      <div class="next-title">${data.title}</div>
      <div class="next-meta">
        <div class="next-meta-row">📍 ${data.venue || 'TBA'}</div>
        <div class="next-meta-row">📅 ${date} · ${time}</div>
      </div>
    </div>
  `;
}

// --- 4. FETCH RECENT RESULTS ---
async function getRecentResults() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('type', 'match')
    .lt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
    .limit(3);

  const list = document.getElementById('resultsList');
  
  if (error || !data || data.length === 0) {
    list.innerHTML = `<div class="loading" style="color: var(--gray)">No recent results.</div>`;
    return;
  }

  // Placeholder UI (Nanti kita tambah field score dalam DB)
  list.innerHTML = data.map(match => `
    <div class="result-card win">
      <div class="result-head">
        <span class="result-team">${new Date(match.starts_at).toLocaleDateString()}</span>
        <span class="result-badge win">WIN</span>
      </div>
      <div class="result-score">
        <div class="result-side">
          <div class="result-side-lbl">Home</div>
          <div class="result-side-name">Serdang Eagles</div>
        </div>
        <div class="result-nums">
          <span class="win">24</span><span class="sep">-</span><span class="lose">12</span>
        </div>
        <div class="result-side away">
          <div class="result-side-lbl">Away</div>
          <div class="result-side-name">${match.title}</div>
        </div>
      </div>
    </div>
  `).join('');
}

// Run functions
getNextMatch();
getRecentResults();