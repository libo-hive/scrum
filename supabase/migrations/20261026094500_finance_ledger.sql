create table public.finance_records (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  category text not null check (
    (transaction_type = 'income' and category in ('sponsorship', 'grant', 'donation', 'fundraising', 'other_income'))
    or
    (transaction_type = 'expense' and category in ('equipment', 'travel', 'competition', 'facilities', 'medical', 'administration', 'other_expense'))
  ),
  title text not null,
  description text,
  transaction_date date not null default current_date,
  amount numeric(10,2) not null check (amount > 0),
  method public.payment_method not null,
  reference_no text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index finance_records_club_date_idx
  on public.finance_records (club_id, transaction_date desc, created_at desc);
create index finance_records_club_type_idx
  on public.finance_records (club_id, transaction_type);

alter table public.finance_records enable row level security;

create policy finance_records_finance_read on public.finance_records for select
  using (
    public.is_active()
    and club_id = public.current_club_id()
    and public.can_manage_finance()
  );

revoke all on public.finance_records from public, anon, authenticated;
grant select on public.finance_records to authenticated;

create or replace function public.record_finance_transaction(
  p_transaction_type text,
  p_category text,
  p_title text,
  p_description text,
  p_transaction_date date,
  p_amount numeric,
  p_method public.payment_method,
  p_reference_no text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id uuid;
  v_transaction_type text := lower(trim(coalesce(p_transaction_type, '')));
  v_category text := lower(trim(coalesce(p_category, '')));
begin
  if auth.uid() is null or not public.can_manage_finance() then
    raise exception 'Only club administrators, managers or finance staff can record finance transactions';
  end if;
  if v_transaction_type not in ('income', 'expense') then
    raise exception 'Transaction type must be income or expense';
  end if;
  if (v_transaction_type = 'income' and v_category not in ('sponsorship', 'grant', 'donation', 'fundraising', 'other_income'))
    or (v_transaction_type = 'expense' and v_category not in ('equipment', 'travel', 'competition', 'facilities', 'medical', 'administration', 'other_expense')) then
    raise exception 'Select a valid category for this transaction type';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Source or payee is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'Amount can have at most two decimal places';
  end if;
  if p_method is null then
    raise exception 'Payment method is required';
  end if;

  insert into public.finance_records (
    club_id, transaction_type, category, title, description,
    transaction_date, amount, method, reference_no, recorded_by
  ) values (
    public.current_club_id(), v_transaction_type, v_category, trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(p_transaction_date, current_date), p_amount, p_method,
    nullif(trim(coalesce(p_reference_no, '')), ''), auth.uid()
  ) returning id into v_record_id;

  return v_record_id;
end;
$$;

revoke all on function public.record_finance_transaction(text, text, text, text, date, numeric, public.payment_method, text) from public;
grant execute on function public.record_finance_transaction(text, text, text, text, date, numeric, public.payment_method, text) to authenticated;
