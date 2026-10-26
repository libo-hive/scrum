(function () {
  'use strict';

  let context;
  let invoices = [];
  let players = [];
  let payments = [];
  let transactions = [];
  let currency = 'MYR';
  let canWriteFinance = false;

  document.addEventListener('DOMContentLoaded', () => {
    start().catch(error => {
      console.error('Finance dashboard failed to load:', error);
      window.AdminTools.message(error.message || 'Could not load finance records.', true);
    });
  });

  async function start() {
    context = await window.AdminTools.initialize(['admin', 'manager', 'finance']);
    if (!context) return;
    canWriteFinance = context.roles.some(role => ['admin', 'manager', 'finance'].includes(role));
    currency = (context.club.currency || 'MYR').trim();
    document.addEventListener('admin-fab-action', event => {
      if (event.detail?.action === 'create-invoice') openInvoice();
    });
    document.getElementById('invoice-form').addEventListener('submit', createInvoice);
    document.getElementById('payment-form').addEventListener('submit', recordPayment);
    document.getElementById('transaction-form').addEventListener('submit', recordTransaction);
    document.getElementById('create-invoice-button').hidden = !canWriteFinance;
    document.getElementById('create-invoice-button').addEventListener('click', () => openInvoice());
    document.getElementById('receive-funds-button').hidden = !canWriteFinance;
    document.getElementById('receive-funds-button').addEventListener('click', () => openTransaction('income'));
    document.getElementById('record-expense-button').hidden = !canWriteFinance;
    document.getElementById('record-expense-button').addEventListener('click', () => openTransaction('expense'));
    document.getElementById('invoice-search').addEventListener('input', renderInvoices);
    document.getElementById('invoice-filter').addEventListener('change', renderInvoices);
    document.getElementById('player-search').addEventListener('input', renderPlayers);
    document.getElementById('transaction-search').addEventListener('input', renderTransactions);
    document.getElementById('transaction-filter').addEventListener('change', renderTransactions);
    document.querySelectorAll('.finance-currency').forEach(element => element.textContent = currency);
    await loadFinance();
    document.getElementById('admin-fab-menu').hidden = false;
    const quickAction = new URLSearchParams(window.location.search).get('quick');
    if (canWriteFinance && quickAction === 'create-invoice') openInvoice();
    if (canWriteFinance && quickAction === 'receive-funds') openTransaction('income');
    if (canWriteFinance && quickAction === 'record-expense') openTransaction('expense');
  }

  async function loadFinance() {
    const [invoiceResult, playerResult, paymentResult, transactionResult] = await Promise.all([
      fetchAll(() => window.supabase.from('invoices')
        .select('id, invoice_no, player_id, issue_date, due_date, subtotal, total, currency, status, notes')
        .eq('club_id', context.profile.club_id).order('created_at', { ascending: false })),
      fetchAll(() => window.supabase.rpc('list_finance_players')),
      fetchAll(() => window.supabase.from('payments')
        .select('id, invoice_id, amount, method, reference_no, paid_at, status')
        .eq('club_id', context.profile.club_id).order('paid_at', { ascending: false })),
      fetchAll(() => window.supabase.from('finance_records')
        .select('id, transaction_type, category, title, description, amount, transaction_date, method, reference_no')
        .eq('club_id', context.profile.club_id).order('transaction_date', { ascending: false }))
    ]);
    for (const result of [invoiceResult, playerResult, paymentResult, transactionResult]) {
      if (result.error) throw result.error;
    }
    invoices = invoiceResult.data || [];
    players = playerResult.data || [];
    payments = paymentResult.data || [];
    transactions = transactionResult.data || [];
    renderSummary();
    renderPlayers();
    renderInvoices();
    renderPayments();
    renderTransactions();
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
    const otherIncome = transactions.filter(record => record.transaction_type === 'income')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const expenses = transactions.filter(record => record.transaction_type === 'expense')
      .reduce((sum, record) => sum + Number(record.amount || 0), 0);
    document.getElementById('finance-summary').innerHTML = [
      ['Player invoices', billed], ['Invoice payments', collected], ['Other income', otherIncome],
      ['Expenses', expenses], ['Net cash flow', collected + otherIncome - expenses],
      ['Outstanding', outstanding], ['Overdue', overdue]
    ].map(([label, amount]) => `<div class="summary-card-admin"><span>${label}</span><strong>${window.AdminTools.money(amount, currency)}</strong></div>`).join('');
  }

  function renderPlayers() {
    const search = document.getElementById('player-search').value.trim().toLowerCase();
    const visible = players.filter(player => player.full_name.toLowerCase().includes(search));
    const list = document.getElementById('player-list');
    if (!visible.length) {
      list.innerHTML = `<div class="admin-empty">${players.length ? 'No players match this search.' : 'No players found.'}</div>`;
      return;
    }
    const e = window.AdminTools.escape;
    list.innerHTML = visible.map(player => {
      const playerInvoices = invoices.filter(invoice => invoice.player_id === player.id &&
        !['draft', 'void', 'refunded'].includes(invoice.status));
      const balance = playerInvoices.reduce((sum, invoice) =>
        sum + Math.max(0, Number(invoice.total || 0) - paidAmount(invoice.id)), 0);
      return `<article class="admin-row"><div class="admin-row-main">
        <strong>${e(player.full_name)}</strong>
        <span>${playerInvoices.length} invoice${playerInvoices.length === 1 ? '' : 's'} · ${window.AdminTools.money(balance, currency)} outstanding</span>
      </div>${canWriteFinance ? `<button class="admin-button-secondary" type="button" data-player-invoice="${e(player.id)}">Create invoice</button>` : ''}</article>`;
    }).join('');
    list.querySelectorAll('[data-player-invoice]').forEach(button =>
      button.addEventListener('click', () => openInvoice(button.dataset.playerInvoice)));
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
        `${invoice.invoice_no} ${playerName(invoice.player_id)} ${invoice.notes || ''}`.toLowerCase().includes(search);
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
        <strong>${e(invoice.invoice_no)}${invoice.player_id ? ` · ${e(playerName(invoice.player_id))}` : ''}</strong>
        <span>${e(invoice.notes || 'Club invoice')} · Due ${window.AdminTools.localDate(invoice.due_date)}</span>
        <span>${window.AdminTools.money(paid, invoice.currency || currency)} paid of ${window.AdminTools.money(invoice.total, invoice.currency || currency)}${remaining ? ` · ${window.AdminTools.money(remaining, invoice.currency || currency)} remaining` : ''}</span>
      </div>${canWriteFinance && remaining > 0 && !['draft', 'void', 'refunded'].includes(status) ? `<button class="admin-button-secondary" type="button" data-payment="${e(invoice.id)}" data-balance="${remaining}">Record payment</button>` : ''}</article>`;
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
        <strong>${window.AdminTools.money(payment.amount, invoice?.currency || currency)} · ${e(invoice ? `${invoice.invoice_no} · ${playerName(invoice.player_id)}` : 'Payment')}</strong>
        <span>${window.AdminTools.localDate(payment.paid_at)} · ${e(payment.method.replace('_', ' '))}${payment.reference_no ? ` · Ref ${e(payment.reference_no)}` : ''}</span>
      </div><span class="status-pill ${payment.status === 'success' ? 'paid' : ''}">${e(payment.status)}</span></article>`;
    }).join('');
  }

  function renderTransactions() {
    const search = document.getElementById('transaction-search').value.trim().toLowerCase();
    const filter = document.getElementById('transaction-filter').value;
    const visible = transactions.filter(record => {
      const searchable = `${record.title} ${record.category} ${record.description || ''} ${record.reference_no || ''}`.toLowerCase();
      return (filter === 'all' || record.transaction_type === filter) && (!search || searchable.includes(search));
    });
    const list = document.getElementById('transaction-list');
    if (!visible.length) {
      list.innerHTML = `<div class="admin-empty">${transactions.length ? 'No transactions match these filters.' : 'No sponsorship, grant, income or expense records yet.'}</div>`;
      return;
    }
    const e = window.AdminTools.escape;
    list.innerHTML = visible.map(record => {
      const income = record.transaction_type === 'income';
      return `<article class="admin-row"><div class="admin-row-main">
        <span class="status-pill ${income ? 'paid' : 'overdue'}">${income ? 'Income' : 'Expense'} · ${e(record.category.replaceAll('_', ' '))}</span>
        <strong>${e(record.title)}</strong>
        <span>${window.AdminTools.localDate(record.transaction_date)} · ${e(record.method.replaceAll('_', ' '))}${record.reference_no ? ` · Ref ${e(record.reference_no)}` : ''}</span>
        ${record.description ? `<span>${e(record.description)}</span>` : ''}
      </div><strong class="finance-transaction-amount ${income ? 'is-income' : 'is-expense'}">${income ? '+' : '−'}${window.AdminTools.money(record.amount, currency)}</strong></article>`;
    }).join('');
  }

  function playerName(playerId) {
    return players.find(player => player.id === playerId)?.full_name || 'Player';
  }

  function openInvoice(playerId = '') {
    if (!canWriteFinance) {
      window.AdminTools.message('Your role cannot create invoices.', true);
      return;
    }
    if (!players.length) {
      window.AdminTools.message('Add a player record before creating an invoice.', true);
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
    if (playerId) form.elements.player_id.value = playerId;
    document.getElementById('invoice-dialog').showModal();
  }

  function openTransaction(type) {
    if (!canWriteFinance) return;
    const form = document.getElementById('transaction-form');
    const isIncome = type === 'income';
    const current = new Date();
    const today = new Date(current.getTime() - current.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const category = document.getElementById('transaction-category');
    const categories = isIncome
      ? [['sponsorship', 'Sponsorship'], ['grant', 'Grant'], ['donation', 'Donation'], ['fundraising', 'Fundraising'], ['other_income', 'Other income']]
      : [['equipment', 'Equipment'], ['travel', 'Travel'], ['competition', 'Competition'], ['facilities', 'Facilities'], ['medical', 'Medical'], ['administration', 'Administration'], ['other_expense', 'Other expense']];
    form.reset();
    form.elements.transaction_type.value = type;
    form.elements.transaction_date.value = today;
    category.innerHTML = categories.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    document.getElementById('transaction-dialog-title').textContent = isIncome ? 'Receive funds' : 'Record expense';
    document.getElementById('transaction-title-label').firstChild.textContent = isIncome ? 'Source / sponsor / grantor' : 'Payee / vendor';
    form.elements.title.placeholder = isIncome ? 'e.g. Local sports grant' : 'e.g. Team travel';
    document.getElementById('transaction-submit').textContent = isIncome ? 'Record income' : 'Save expense';
    document.getElementById('transaction-dialog').showModal();
  }

  async function recordTransaction(event) {
    event.preventDefault();
    if (!canWriteFinance) return;
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    try {
      const { error } = await window.supabase.rpc('record_finance_transaction', {
        p_transaction_type: fields.get('transaction_type'),
        p_category: fields.get('category'),
        p_title: String(fields.get('title')).trim(),
        p_description: String(fields.get('description') || '').trim() || null,
        p_transaction_date: fields.get('transaction_date'),
        p_amount: Number(fields.get('amount')),
        p_method: fields.get('method'),
        p_reference_no: String(fields.get('reference_no') || '').trim() || null
      });
      if (error) throw error;
    } catch (error) {
      console.error('Finance transaction recording failed:', error);
      window.AdminTools.message(error.message || 'Could not save this finance transaction.', true);
      return;
    } finally {
      submit.disabled = false;
    }
    document.getElementById('transaction-dialog').close();
    window.AdminTools.message(fields.get('transaction_type') === 'income' ? 'Income recorded.' : 'Expense recorded.');
    await refreshFinance();
  }

  async function createInvoice(event) {
    event.preventDefault();
    if (!canWriteFinance) return;
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    const invoiceNo = `SERC-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    try {
      const { error } = await window.supabase.rpc('create_club_invoice', {
        p_player_id: fields.get('player_id'),
        p_invoice_no: invoiceNo,
        p_issue_date: fields.get('issue_date'),
        p_due_date: fields.get('due_date') || null,
        p_amount: Number(fields.get('amount')),
        p_description: String(fields.get('description')).trim()
      });
      if (error) throw error;
    } catch (error) {
      console.error('Invoice creation failed:', error);
      window.AdminTools.message(error.message || 'Could not create the invoice.', true);
      return;
    } finally {
      submit.disabled = false;
    }
    document.getElementById('invoice-dialog').close();
    window.AdminTools.message(`Invoice ${invoiceNo} created.`);
    await refreshFinance();
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
      `${invoice.invoice_no}${invoice.player_id ? ` · ${playerName(invoice.player_id)}` : ''} · Balance ${window.AdminTools.money(balance, invoice.currency || currency)}`;
    document.getElementById('payment-dialog').showModal();
  }

  async function recordPayment(event) {
    event.preventDefault();
    if (!canWriteFinance) return;
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const fields = new FormData(form);
    try {
      const { error } = await window.supabase.rpc('record_club_invoice_payment', {
        p_invoice_id: fields.get('invoice_id'),
        p_amount: Number(fields.get('amount')),
        p_method: fields.get('method'),
        p_reference_no: fields.get('reference_no') || null
      });
      if (error) throw error;
    } catch (error) {
      console.error('Payment recording failed:', error);
      window.AdminTools.message(error.message || 'Could not record payment.', true);
      return;
    } finally {
      submit.disabled = false;
    }
    document.getElementById('payment-dialog').close();
    window.AdminTools.message('Payment recorded.');
    await refreshFinance();
  }

  async function refreshFinance() {
    try {
      await loadFinance();
    } catch (error) {
      console.error('Finance records refresh failed:', error);
      window.AdminTools.message('The record was saved, but the finance view could not refresh. Reload the page to see it.', true);
    }
  }
})();
