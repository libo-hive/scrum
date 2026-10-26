create or replace function public.can_manage_finance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active()
    and public.has_any_role(array['admin','manager','finance']::public.user_role[])
$$;

revoke all on function public.can_manage_finance() from public;
grant execute on function public.can_manage_finance() to authenticated;

create or replace function public.list_finance_players()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.can_manage_finance() then
    raise exception 'Only club administrators, managers or finance staff can view the invoice player list';
  end if;

  return query
  select p.id, p.full_name
  from public.players p
  where p.club_id = public.current_club_id()
    and p.deleted_at is null
  order by p.full_name;
end;
$$;

revoke all on function public.list_finance_players() from public;
grant execute on function public.list_finance_players() to authenticated;

create or replace function public.create_club_invoice(
  p_player_id uuid,
  p_invoice_no text,
  p_issue_date date,
  p_due_date date,
  p_amount numeric,
  p_description text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid := public.current_club_id();
  v_invoice_id uuid;
  v_currency char(3);
begin
  if auth.uid() is null or not public.can_manage_finance() then
    raise exception 'Only club administrators, managers or finance staff can create invoices';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invoice amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Invoice amount can have at most two decimal places';
  end if;
  if nullif(trim(p_invoice_no), '') is null or nullif(trim(p_description), '') is null then
    raise exception 'Invoice number and description are required';
  end if;
  if not exists (
    select 1 from public.players
    where id = p_player_id and club_id = v_club_id and deleted_at is null
  ) then
    raise exception 'Player was not found in this club';
  end if;
  if p_due_date is not null and p_due_date < coalesce(p_issue_date, current_date) then
    raise exception 'Due date cannot be before the invoice date';
  end if;

  select currency into v_currency from public.clubs where id = v_club_id;
  insert into public.invoices (
    club_id, invoice_no, player_id, issue_date, due_date,
    subtotal, tax, total, currency, status, notes
  ) values (
    v_club_id, trim(p_invoice_no), p_player_id, coalesce(p_issue_date, current_date),
    p_due_date, p_amount, 0, p_amount, coalesce(v_currency, 'MYR'), 'sent',
    trim(p_description)
  ) returning id into v_invoice_id;

  insert into public.invoice_items (invoice_id, description, qty, unit_price, amount)
  values (v_invoice_id, trim(p_description), 1, p_amount, p_amount);

  return v_invoice_id;
end;
$$;

revoke all on function public.create_club_invoice(uuid, text, date, date, numeric, text) from public;
grant execute on function public.create_club_invoice(uuid, text, date, date, numeric, text) to authenticated;

create or replace function public.record_club_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference_no text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_paid numeric;
begin
  if auth.uid() is null or not public.can_manage_finance() then
    raise exception 'Only club administrators, managers or finance staff can record payments';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Payment amount can have at most two decimal places';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and club_id = public.current_club_id()
  for update;
  if not found then
    raise exception 'Invoice was not found in this club';
  end if;
  if v_invoice.status in ('draft','void','refunded') then
    raise exception 'Payments cannot be recorded against a draft, void or refunded invoice';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments where invoice_id = p_invoice_id and status = 'success';
  if p_amount > v_invoice.total - v_paid then
    raise exception 'Payment exceeds the outstanding invoice balance';
  end if;

  insert into public.payments (
    club_id, invoice_id, amount, method, reference_no, received_by, status
  ) values (
    v_invoice.club_id, p_invoice_id, p_amount, p_method,
    nullif(trim(p_reference_no), ''), auth.uid(), 'success'
  );

  v_paid := v_paid + p_amount;
  update public.invoices
  set status = case
    when v_paid >= total then 'paid'::public.invoice_status
    else 'partially_paid'::public.invoice_status
  end
  where id = p_invoice_id;
end;
$$;

revoke all on function public.record_club_invoice_payment(uuid, numeric, public.payment_method, text) from public;
grant execute on function public.record_club_invoice_payment(uuid, numeric, public.payment_method, text) to authenticated;
