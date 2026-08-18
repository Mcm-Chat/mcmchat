create or replace function public.record_ledger_payment(_ledger uuid, _amount numeric, _method text, _note text, _paid_at timestamptz)
returns public.ledgers language plpgsql security definer set search_path = public as $$
declare l public.ledgers; rem numeric;
begin
  if _amount is null or _amount <= 0 then raise exception 'Nominal pembayaran harus lebih dari nol'; end if;
  select * into l from public.ledgers where id = _ledger for update;
  if not found then raise exception 'Catatan tidak ditemukan'; end if;
  if not (l.owner_id = auth.uid() or l.counterpart_user_id = auth.uid()) then raise exception 'Tidak diizinkan'; end if;
  if l.status in ('cancelled','rejected') then raise exception 'Catatan sudah tidak aktif'; end if;
  rem := l.amount - l.paid_amount;
  if _amount > rem then raise exception 'Nominal melebihi sisa tagihan'; end if;
  insert into public.ledger_payments (ledger_id, recorded_by, amount, method, note, paid_at)
  values (_ledger, auth.uid(), _amount, coalesce(_method,'cash'), coalesce(_note,''), coalesce(_paid_at, now()));
  update public.ledgers
     set paid_amount = paid_amount + _amount,
         status = case when paid_amount + _amount >= amount then 'paid'::public.ledger_status else 'partially_paid'::public.ledger_status end
   where id = _ledger returning * into l;
  insert into public.ledger_events (ledger_id, actor_id, label, detail)
  values (_ledger, auth.uid(), case when l.status = 'paid' then 'Pelunasan dicatat' else 'Pembayaran dicatat' end, coalesce(_method,'cash'));
  return l;
end $$;
revoke all on function public.record_ledger_payment(uuid, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.record_ledger_payment(uuid, numeric, text, text, timestamptz) to authenticated;

create or replace function public.delete_ledger_payment(_payment uuid)
returns public.ledgers language plpgsql security definer set search_path = public as $$
declare p public.ledger_payments; l public.ledgers; next_paid numeric;
begin
  select * into p from public.ledger_payments where id = _payment;
  if not found then raise exception 'Pembayaran tidak ditemukan'; end if;
  select * into l from public.ledgers where id = p.ledger_id for update;
  if not found then raise exception 'Catatan tidak ditemukan'; end if;
  if not (l.owner_id = auth.uid() or l.counterpart_user_id = auth.uid()) then raise exception 'Tidak diizinkan'; end if;
  delete from public.ledger_payments where id = _payment;
  next_paid := greatest(0, l.paid_amount - p.amount);
  update public.ledgers
     set paid_amount = next_paid,
         status = case
           when l.status in ('cancelled','rejected','pending_approval','disputed') then l.status
           when next_paid >= l.amount then 'paid'::public.ledger_status
           when next_paid > 0 then 'partially_paid'::public.ledger_status
           else 'active'::public.ledger_status end
   where id = l.id returning * into l;
  insert into public.ledger_events (ledger_id, actor_id, label, detail)
  values (l.id, auth.uid(), 'Pembayaran dihapus', to_char(p.amount, 'FM999999999990'));
  return l;
end $$;
revoke all on function public.delete_ledger_payment(uuid) from public, anon;
grant execute on function public.delete_ledger_payment(uuid) to authenticated;