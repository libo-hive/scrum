(function () {
  'use strict';

  const menus = {
    dashboard: [
      { label: 'Invite a member', icon: '+', href: 'members.html?quick=create-invite' },
      { label: 'Create a team', icon: 'T', href: 'teams.html?quick=create-team' },
      { label: 'Create an event', icon: 'C', href: 'events.html?quick=create-event' },
      { label: 'Create an invoice', icon: 'RM', href: 'finance.html?quick=create-invoice' },
      { label: 'Publish announcement', icon: 'A', href: 'more.html?quick=create-announcement' }
    ],
    members: [
      { label: 'Create an invitation', icon: '+', action: 'scroll', target: '#inviteRole', focus: true },
      { label: 'Add a player record', icon: 'P', action: 'dispatch', key: 'create-player' },
      { label: 'View all members', icon: 'M', action: 'scroll', target: '#memberDirectory' },
      { label: 'Review applications', icon: '✓', action: 'scroll', target: '#pendingMembers' },
      { label: 'Recent invitation links', icon: '↗', action: 'scroll', target: '#invitationList' }
    ],
    teams: [
      { label: 'Create a team', icon: '+', action: 'dispatch', key: 'create-team' },
      { label: 'View team rosters', icon: 'T', action: 'scroll', target: '#team-list' }
    ],
    events: [
      { label: 'Create an event', icon: '+', action: 'dispatch', key: 'create-event' },
      { label: 'Open calendar', icon: 'C', action: 'scroll', target: '#calendar-grid' },
      { label: 'This month’s events', icon: '↗', action: 'scroll', target: '#event-list' }
    ],
    finance: [
      { label: 'Create an invoice', icon: '+', href: 'finance.html?quick=create-invoice' },
      { label: 'Receive sponsorship / grant', icon: '+', href: 'finance.html?quick=receive-funds' },
      { label: 'Record an expense', icon: '−', href: 'finance.html?quick=record-expense' },
      { label: 'View invoices', icon: 'RM', action: 'scroll', target: '#invoice-list' },
      { label: 'Recent payments', icon: '$', action: 'scroll', target: '#payment-list' }
    ],
    'finance-dashboard': [
      { label: 'Open invoices & payments', icon: 'RM', href: 'finance.html' },
      { label: 'Create an invoice', icon: '+', href: 'finance.html?quick=create-invoice' },
      { label: 'Receive sponsorship / grant', icon: '+', href: 'finance.html?quick=receive-funds' },
      { label: 'Record an expense', icon: '−', href: 'finance.html?quick=record-expense' },
      { label: 'Outstanding invoices', icon: '!', action: 'scroll', target: '#finance-outstanding-list' },
      { label: 'Recent payments', icon: '$', action: 'scroll', target: '#finance-recent-payments' }
    ],
    more: [
      { label: 'Publish announcement', icon: '+', action: 'dispatch', key: 'create-announcement' },
      { label: 'Club profile', icon: 'C', action: 'scroll', target: '#club-settings' },
      { label: 'Quick links', icon: '↗', action: 'scroll', target: '#quick-links' }
    ],
    'coach-dashboard': [
      { label: 'View squad', icon: 'S', href: 'squad.html' },
      { label: 'Plan training', icon: 'T', href: 'training.html?quick=create-session' },
      { label: 'Add a fixture', icon: 'M', href: 'matches.html?quick=create-match' }
    ],
    'coach-squad': [
      { label: 'View roster', icon: 'S', action: 'scroll', target: '#player-list' },
      { label: 'Training calendar', icon: 'T', href: 'training.html' },
      { label: 'Matches', icon: 'M', href: 'matches.html' }
    ],
    'coach-training': [
      { label: 'Add a training session', icon: '+', action: 'dispatch', key: 'create-session' },
      { label: 'Go to selected day', icon: 'T', action: 'scroll', target: '#session-list' }
    ],
    'coach-matches': [
      { label: 'Create a fixture', icon: '+', action: 'dispatch', key: 'create-match' },
      { label: 'Past results', icon: 'R', action: 'click', target: '.segment-btn[data-filter="past"]' },
      { label: 'Upcoming fixtures', icon: 'M', action: 'click', target: '.segment-btn[data-filter="upcoming"]' }
    ],
    player: [
      { label: 'Upcoming sessions & matches', icon: 'S', action: 'scroll', target: '#member-upcoming-list' },
      { label: 'Attendance & results', icon: 'A', action: 'scroll', target: '#member-activity-list' },
      { label: 'Invoices', icon: 'I', action: 'scroll', target: '#member-invoice-list' }
    ]
  };
  const navigation = {
    admin: [
      { label: 'Dashboard', icon: 'H', href: 'dashboard.html' },
      { label: 'Members', icon: 'M', href: 'members.html' },
      { label: 'Teams', icon: 'T', href: 'teams.html' },
      { label: 'Events', icon: 'E', href: 'events.html' },
      { label: 'Finance', icon: 'F', href: 'finance.html' },
      { label: 'More', icon: '…', href: 'more.html' }
    ],
    coach: [
      { label: 'Dashboard', icon: 'H', href: 'dashboard.html' },
      { label: 'Squad', icon: 'S', href: 'squad.html' },
      { label: 'Training', icon: 'T', href: 'training.html' },
      { label: 'Matches', icon: 'M', href: 'matches.html' }
    ],
    member: [
      { label: 'Dashboard', icon: 'H', href: 'dashboard.html' }
    ],
    finance: [
      { label: 'Dashboard', icon: 'H', href: 'dashboard.html' },
      { label: 'Invoices & payments', icon: 'F', href: 'finance.html' }
    ]
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-fab-menu]').forEach(createMenu);
  });

  function createMenu(container) {
    const page = container.dataset.fabMenu;
    const actions = menus[page];
    if (!actions) {
      console.error(`Unknown quick actions menu: ${page}`);
      return;
    }
    const navItems = page.startsWith('coach-') ? navigation.coach
      : page === 'player' ? navigation.member
        : page === 'finance-dashboard' || page === 'finance' ? navigation.finance : navigation.admin;
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
    const navMarkup = navItems.map(item => {
      const current = currentPage === item.href ? ' is-current' : '';
      const currentAttr = current ? ' aria-current="page"' : '';
      return `<a class="admin-fab-action${current}" href="${item.href}"${currentAttr}>
        <span class="admin-fab-action-icon" aria-hidden="true">${escape(item.icon)}</span>
        <span>${escape(item.label)}</span>
      </a>`;
    }).join('');

    container.innerHTML = `
      <div class="admin-fab-actions" id="quick-actions-${escape(page)}" role="group" aria-label="Navigation and quick actions" aria-hidden="true">
        <div class="admin-fab-heading">Navigation</div>
        ${navMarkup}
        ${actions.length ? '<div class="admin-fab-heading admin-fab-heading-actions">Quick actions</div>' : ''}
        ${actions.map(item => {
          const tag = item.href ? 'a' : 'button';
          const attrs = item.href
            ? `href="${escape(item.href)}"`
            : `type="button" data-action="${escape(item.action)}" ${item.target ? `data-target="${escape(item.target)}"` : ''} ${item.key ? `data-key="${escape(item.key)}"` : ''} ${item.focus ? 'data-focus="true"' : ''}`;
          return `<${tag} class="admin-fab-action" ${attrs}>
            <span class="admin-fab-action-icon" aria-hidden="true">${escape(item.icon)}</span>
            <span>${escape(item.label)}</span>
          </${tag}>`;
        }).join('')}
      </div>
      <button class="admin-fab-trigger" type="button" aria-label="Open navigation and quick actions" aria-expanded="false" aria-controls="quick-actions-${escape(page)}" title="Navigation and quick actions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        <span>Menu</span>
      </button>`;

    const trigger = container.querySelector('.admin-fab-trigger');
    const actionPanel = container.querySelector('.admin-fab-actions');
    actionPanel.inert = true;
    const close = () => {
      container.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('aria-label', 'Open navigation and quick actions');
      actionPanel.setAttribute('aria-hidden', 'true');
      actionPanel.inert = true;
    };
    trigger.addEventListener('click', () => {
      const isOpen = container.classList.toggle('is-open');
      trigger.setAttribute('aria-expanded', String(isOpen));
      trigger.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open navigation and quick actions');
      actionPanel.setAttribute('aria-hidden', String(!isOpen));
      actionPanel.inert = !isOpen;
      if (isOpen) actionPanel.querySelector('.admin-fab-action')?.focus();
    });
    container.addEventListener('click', event => {
      const item = event.target.closest('.admin-fab-action');
      if (!item || item.tagName === 'A') return;
      close();
      if (item.dataset.action === 'dispatch') {
        document.dispatchEvent(new CustomEvent('admin-fab-action', {
          detail: { action: item.dataset.key }
        }));
        return;
      }
      const target = document.querySelector(item.dataset.target);
      if (!target) {
        console.error(`Floating menu target not found: ${item.dataset.target}`);
        return;
      }
      if (item.dataset.action === 'click') {
        target.click();
        return;
      }
      if (item.dataset.action === 'scroll') {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (item.dataset.focus === 'true') target.focus({ preventScroll: true });
      }
    });
    document.addEventListener('click', event => {
      if (!container.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && container.classList.contains('is-open')) {
        close();
        trigger.focus();
      }
    });
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
})();
