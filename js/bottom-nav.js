(function () {
  'use strict';

  const navigation = {
    admin: [
      ['dashboard.html', 'Home', 'home'],
      ['members.html', 'Members', 'members'],
      ['teams.html', 'Teams', 'teams'],
      ['events.html', 'Events', 'events'],
      ['finance.html', 'Finance', 'finance'],
      ['more.html', 'More', 'more']
    ],
    coach: [
      ['dashboard.html', 'Home', 'home'],
      ['squad.html', 'Squad', 'squad'],
      ['training.html', 'Train', 'training'],
      ['matches.html', 'Match', 'matches']
    ],
    member: [
      ['dashboard.html', 'Home', 'home']
    ]
  };

  const icons = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    members: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    teams: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    events: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    finance: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    squad: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    training: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    matches: '<circle cx="12" cy="12" r="10"/><path d="M12 2a15 15 0 0 0 0 20M2 12h20"/>'
  };

  function render(role, nav = document.getElementById('app-dock')) {
    const items = navigation[role];
    if (!nav || !items) return;
    const currentPage = location.pathname.split('/').pop() || 'dashboard.html';
    nav.className = 'dock app-bottom-nav';
    nav.setAttribute('aria-label', `${role === 'admin' ? 'Admin' : role === 'coach' ? 'Coach' : 'Member'} navigation`);
    nav.innerHTML = items.map(([href, label, icon]) => `
      <a href="${href}" class="dock-item${currentPage === href ? ' active' : ''}"${currentPage === href ? ' aria-current="page"' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg>
        <span class="dock-item-label">${label}</span>
      </a>`).join('');
    nav.hidden = false;
  }

  window.BottomNav = { render };
})();
