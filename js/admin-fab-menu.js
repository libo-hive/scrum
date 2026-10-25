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
      { label: 'Create an invoice', icon: '+', action: 'dispatch', key: 'create-invoice' },
      { label: 'View invoices', icon: 'RM', action: 'scroll', target: '#invoice-list' },
      { label: 'Recent payments', icon: '$', action: 'scroll', target: '#payment-list' }
    ],
    more: [
      { label: 'Publish announcement', icon: '+', action: 'dispatch', key: 'create-announcement' },
      { label: 'Club profile', icon: 'C', action: 'scroll', target: '#club-settings' },
      { label: 'Quick links', icon: '↗', action: 'scroll', target: '#quick-links' }
    ]
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-fab-menu]').forEach(createMenu);
  });

  function createMenu(container) {
    const page = container.dataset.fabMenu;
    const actions = menus[page];
    if (!actions) {
      console.error(`Unknown admin floating menu: ${page}`);
      return;
    }

    container.innerHTML = `
      <div class="admin-fab-actions" id="admin-fab-actions" role="group" aria-label="Quick actions" aria-hidden="true">
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
      <button class="admin-fab-trigger" type="button" aria-label="Open quick actions" aria-expanded="false" aria-controls="admin-fab-actions" title="Quick actions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      </button>`;

    const trigger = container.querySelector('.admin-fab-trigger');
    const actionPanel = container.querySelector('.admin-fab-actions');
    actionPanel.inert = true;
    const close = () => {
      container.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      actionPanel.setAttribute('aria-hidden', 'true');
      actionPanel.inert = true;
    };
    trigger.addEventListener('click', () => {
      const isOpen = container.classList.toggle('is-open');
      trigger.setAttribute('aria-expanded', String(isOpen));
      actionPanel.setAttribute('aria-hidden', String(!isOpen));
      actionPanel.inert = !isOpen;
      if (isOpen) container.querySelector('.admin-fab-action')?.focus();
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
