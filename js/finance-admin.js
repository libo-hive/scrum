(function () {
  'use strict';

  let context;
  let invoices = [];
  let players = [];
  let payments = [];
  let currency = 'MYR';

  document.addEventListener('DOMContentLoaded', () => {
    start().catch(error => {
      console.error('Finance dashboard failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load finance records.', true);
    });
  });

  async function start() {
    context = await window.AdminTools.initialize();
    if (!context) return;
    currency = (context.club.currency || 'MYR').trim();
    document.addEventListener('admin-fab-action', event => {
      if (event.detail?.action === 'create-invoice') openInvoice();
    });
    document.getElementById('invoice-form').addEventListener('submit', createInvoice);
    document.getElementById('payment-form').addEventListener('submit', recordPayment);
    document.getElementById('invoice-search').addEventListener('input', renderInvoices);
    document.getElementById('invoice-filter').addEventListener('change', renderInvoices);
    await loadFinance();
    document.getElementById('admin-fab-menu').hidden = false;
    if (new URLSearchParams(window.location.search).get('quick') === 'create-invoice') openInvoice();
  }

  async function loadFinance() {
    const [invoiceResult, playerResult, paymentResult] = await Promise.all([
      fetchAll(() => window.supabase.from('invoices')
        .select('id, invoice_no, player_id, issue_date, due_date, subtotal, total, currency, status, notes, players(full_name)')
        .eq('club_id', context.profile.club_id).order('created_at', { ascending: false })),
      fetchAll(() => window.supabase.from('players').select('id, full_name')
        .eq('club_id', context.profile.club_id).is('deleted_at', null).order('full_name')),
      fetchAll(() => window.supabase.from('payments')
        .select('id, invoice_id, amount, method, reference_no, paid_at, status')
        .eq('club_id', context.profile.club_id).order('paid_at', { ascending: false }))
    ]);
    for (const result of [invoiceResult, playerResult, paymentResult]) {
      if (result.error) throw result.error;
    }
    invoices = invoiceResult.data || [];
    players = playerResult.data || [];
    payments = paymentResult.data || [];
    renderSummary();
    renderInvoices();
    renderPayments();
  }

  async function fetchAll(buildQuery) {
    const pageSize = 1000;
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) return { data: rows, error: null };
    }
  }

  function paidAmount(invoiceId) {
    return payments.filter(payment => payment.invoice_id === invoiceId && payment.status === 'success')
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }

  function effectiveStatus(invoice) {
    const remaining = Number(invoice.total) - paidAmount(invoice.id);
    if (remaining <= 0) return 'paid';
    if (['draft', 'void', 'refunded'].includes(invoice.status)) return invoice.status;
    if (invoice.due_date && new Date(`${invoice.due_date}T23:59:59`) < new Date()) return 'overdue';
    return paidAmount(invoice.id) ? 'partially_paid' : invoice.status;
  }

  function renderSummary() {
    const billed = invoices.reduce((sum, invoice) =>
      sum + (['draft', 'void', 'refunded'].includes(invoice.status) ? 0 : Number(invoice.total || 0)), 0);
    const collected = invoices.reduce((sum, invoice) => sum + Math.min(Number(invoice.total || 0), paidAmount(invoice.id)), 0);
    const outstanding = invoices.reduce((sum, invoice) =>
      sum + (['draft', 'void', 'refunded'].includes(invoice.status) ? 0 : Math.max(0, Number(invoice.total || 0) - paidAmount(invoice.id))), 0);
    const overdue = invoices.filter(invoice => effectiveStatus(invoice) === 'overdue')
      .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.total || 0) - paidAmount(invoice.id)), 0);
    document.getElementById('finance-summary').innerHTML = [
      ['Billed', billed], ['Collected', collected], ['Outstanding', outstanding], ['Overdue', overdue]
    ].map(([label, amount]) => `<div class="summary-card-admin"><span>${label}</span><strong>${window.AdminTools.money(amount, currency)}</strong></div>`).join('');
  }

  function renderInvoices() {
    const search = document.getElementById('invoice-search').value.trim().toLowerCase();
    const filter = document.getElementById('invoice-filter').value;
    const visible = invoices.filter(invoice => {
      const status = effectiveStatus(invoice);
      const matchesStatus = filter === 'all' ||
        (filter === 'outstanding' ? ['sent', 'partially_paid', 'overdue'].includes(status) :
          filter === status || (filter === 'partially_paid' && status === 'partially_paid'));
      const matchesSearch = !search ||
        `${invoice.invoice_no} ${invoice.players?.full_name || ''} ${invoice.notes || ''}`.toLowerCase().includes(search);
      return matchesStatus && matchesSearch;
    });
    const list = document.getElementById('invoice-list');
    if (!visible.length) {
      list.innerHTML = `<div class="admin-empty">${invoices.length ? 'No invoices match these filters.' : 'No invoices yet. Create an invoice for a player to get started.'}</div>`;
      return;
    }
    const e = window.AdminTools.escape;
    list.innerHTML = visible.map(invoice => {
      const paid = paidAmount(invoice.id);
      const remaining = Math.max(0, Number(invoice.total) - paid);
      const status = effectiveStatus(invoice);
      return `<article class="admin-row"><div class="admin-row-main">
        <span class="status-pill ${e(status)}">${e(status.replace('_', ' '))}</span>
        <strong>${e(invoice.invoice_no)} · ${e(invoice.players?.full_name || 'Player')}</strong>
        <span>${e(invoice.notes || 'Club invoice')} · Due ${window.AdminTools.localDate(invoice.due_date)}</span>
        <span>${window.AdminTools.money(paid, invoice.currency || currency)} paid of ${window.AdminTools.money(invoice.total, invoice.currency || currency)}${remaining ? ` · ${window.AdminTools.money(remaining, invoice.currency || currency)} remaining` : ''}</span>
      </div>${remaining > 0 && !['draft', 'void', 'refunded'].includes(status) ? `<button class="admin-button-secondary" type="button" data-payment="${e(invoice.id)}" data-balance="${remaining}">Record payment</button>` : ''}</article>`;
    }).join('');
    list.querySelectorAll('[data-payment]').forEach(button => button.addEventListener('click', () => openPayment(button)));
  }

  function renderPayments() {
    const list = document.getElementById('payment-list');
    if (!payments.length) {
      list.innerHTML = '<div class="admin-empty">No payments have been recorded.</div>';
      return;
    }
    const e = window.AdminTools.escape;
    const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice]));
    list.innerHTML = payments.slice(0, 10).map(payment => {
      const invoice = invoiceById.get(payment.invoice_id);
      return `<article class="admin-row"><div class="admin-row-main">
        <strong>${window.AdminTools.money(payment.amount, invoice?.currency || currency)} · ${e(invoice?.players?.full_name || invoice?.invoice_no || 'Payment')}</strong>
        <span>${window.AdminTools.localDate(payment.paid_at)} · ${e(payment.method.replace('_', ' '))}${payment.reference_no ? ` · Ref ${e(payment.reference_no)}` : ''}</span>
      </div><span class="status-pill ${payment.status === 'success' ? 'paid' : ''}">${e(payment.status)}</span></article>`;
    }).join('');
  }

  function openInvoice() {
    if (!players.length) {
      window.AdminTools.message('Add a player to a team before creating an invoice.', true);
      return;
    }
    const form = document.getElementById('invoice-form');
    form.reset();
    const current = new Date();
    const today = new Date(current.getTime() - current.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    form.elements.issue_date.value = today;
    form.elements.due_date.value = '';
    document.getElementById('invoice-player').innerHTML = players.map(player =>
      `<option value="${window.AdminTools.escape(player.id)}">${window.AdminTools.escape(player.full_name)}</option>`).join('');
    document.getElementById('invoice-dialog').showModal();
  }

  async function createInvoice(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const invoiceNo = `SERC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const { error } = await window.supabase.rpc('create_club_invoice', {
      p_player_id: fields.get('player_id'),
      p_invoice_no: invoiceNo,
      p_issue_date: fields.get('issue_date'),
      p_due_date: fields.get('due_date') || null,
      p_amount: Number(fields.get('amount')),
      p_description: String(fields.get('description')).trim()
    });
    submit.disabled = false;
    if (error) {
      console.error('Invoice creation failed:', error);
      window.AdminTools.message(error.message || 'Could not create the invoice.', true);
      return;
    }
    document.getElementById('invoice-dialog').close();
    window.AdminTools.message(`Invoice ${invoiceNo} created.`);
    await loadFinance();
  }

  function openPayment(button) {
    const invoice = invoices.find(item => item.id === button.dataset.payment);
    const balance = Number(button.dataset.balance);
    const form = document.getElementById('payment-form');
    form.reset();
    form.elements.invoice_id.value = invoice.id;
    form.elements.amount.max = balance.toFixed(2);
    form.elements.amount.value = balance.toFixed(2);
    document.getElementById('payment-balance').textContent =
      `${invoice.invoice_no} · ${invoice.players?.full_name || 'Player'} · Balance ${window.AdminTools.money(balance, invoice.currency || currency)}`;
    document.getElementById('payment-dialog').showModal();
  }

  async function recordPayment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const { error } = await window.supabase.rpc('record_club_invoice_payment', {
      p_invoice_id: fields.get('invoice_id'),
      p_amount: Number(fields.get('amount')),
      p_method: fields.get('method'),
      p_reference_no: fields.get('reference_no') || null
    });
    submit.disabled = false;
    if (error) {
      console.error('Payment recording failed:', error);
      window.AdminTools.message(error.message || 'Could not record payment.', true);
      return;
    }
    document.getElementById('payment-dialog').close();
    window.AdminTools.message('Payment recorded.');
    await loadFinance();
  }
})();
