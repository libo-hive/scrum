(function () {
  'use strict';

  let context;

  document.addEventListener('DOMContentLoaded', () => {
    start().catch(error => {
      console.error('Club tools failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load club tools.', true);
    });
  });

  async function start() {
    context = await window.AdminTools.initialize();
    if (!context) return;
    renderClub();
    document.getElementById('announcement-form').addEventListener('submit', publishAnnouncement);
    document.addEventListener('admin-fab-action', event => {
      if (event.detail?.action === 'create-announcement') {
        document.getElementById('announcement-dialog').showModal();
      }
    });
    document.getElementById('announcement-list').addEventListener('click', removeAnnouncement);
    await loadAnnouncements();
    document.getElementById('admin-fab-menu').hidden = false;
    if (new URLSearchParams(window.location.search).get('quick') === 'create-announcement') {
      document.getElementById('announcement-dialog').showModal();
    }
  }

  function renderClub() {
    const club = context.club;
    const values = [
      ['Club', club.name], ['Sport', (club.sport_types || []).join(', ') || '—'],
      ['Slug', club.slug], ['Domain', club.domain || 'Not set'],
      ['Timezone', club.timezone], ['Currency', (club.currency || 'MYR').trim()]
    ];
    document.getElementById('club-settings').innerHTML = values.map(([label, value]) =>
      `<div class="club-setting"><span>${window.AdminTools.escape(label)}</span><strong>${window.AdminTools.escape(value)}</strong></div>`
    ).join('');
  }

  async function loadAnnouncements() {
    const { data, error } = await window.supabase.from('announcements')
      .select('id, title, body, target_roles, pinned, published_at')
      .eq('club_id', context.profile.club_id).is('deleted_at', null)
      .order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(50);
    if (error) throw error;
    renderAnnouncements(data || []);
  }

  function renderAnnouncements(items) {
    const list = document.getElementById('announcement-list');
    if (!items.length) {
      list.innerHTML = '<div class="admin-empty">No announcements published yet.</div>';
      return;
    }
    const e = window.AdminTools.escape;
    list.innerHTML = items.map(item => {
      const audience = item.target_roles?.length
        ? item.target_roles.map(role => window.AdminTools.roleNames[role] || role).join(', ')
        : 'All club members';
      return `<article class="announcement-card">
        <div class="admin-panel-head"><h3>${item.pinned ? '📌 ' : ''}${e(item.title)}</h3><button class="admin-button-secondary" type="button" data-remove="${e(item.id)}">Archive</button></div>
        <p>${e(item.body)}</p><div class="announcement-meta">${e(audience)} · ${window.AdminTools.localDate(item.published_at)}</div>
      </article>`;
    }).join('');
  }

  async function publishAnnouncement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const roleMap = {
      all: [],
      coaches: ['head_coach', 'coach', 'assistant_coach'],
      players: ['adult_player', 'junior_player']
    };
    const { error } = await window.supabase.from('announcements').insert({
      club_id: context.profile.club_id,
      title: String(fields.get('title')).trim(),
      body: String(fields.get('body')).trim(),
      target_roles: roleMap[fields.get('audience')] || [],
      pinned: fields.get('pinned') === 'on',
      created_by: context.user.id
    });
    submit.disabled = false;
    if (error) {
      console.error('Announcement publishing failed:', error);
      window.AdminTools.message(error.message || 'Could not publish the announcement.', true);
      return;
    }
    form.reset();
    document.getElementById('announcement-dialog').close();
    window.AdminTools.message('Announcement published.');
    await loadAnnouncements();
  }

  async function removeAnnouncement(event) {
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    if (!window.confirm('Archive this announcement? Members will no longer see it.')) return;
    button.disabled = true;
    const { error } = await window.supabase.from('announcements')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', button.dataset.remove).eq('club_id', context.profile.club_id);
    if (error) {
      console.error('Announcement archive failed:', error);
      window.AdminTools.message(error.message || 'Could not archive the announcement.', true);
      button.disabled = false;
      return;
    }
    window.AdminTools.message('Announcement archived.');
    await loadAnnouncements();
  }
})();
