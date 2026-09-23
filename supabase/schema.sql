-- Resell Tracker: Datenbank für Supabase
-- Einmal komplett im Supabase SQL Editor ausführen ("Run").
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.
--
-- Geldbeträge sind ganze Cent-Beträge (bigint), damit nichts falsch rundet.
-- Jede Tabelle ist per Row Level Security auf den angemeldeten Nutzer beschränkt.

-- ============================================================== Tabellen

create table if not exists public.hauls (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  source        text not null default '' check (char_length(source) <= 120),
  date          date,
  total_price   bigint check (total_price between 0 and 10000000),
  shipping_cost bigint not null default 0 check (shipping_cost between 0 and 10000000),
  notes         text not null default '' check (char_length(notes) <= 4000),
  created_at    timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.articles (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  article_no     integer not null default 0,
  haul_id        bigint,
  title          text not null check (char_length(title) between 1 and 160),
  category       text not null default 'Sonstiges' check (char_length(category) <= 60),
  brand          text not null default '' check (char_length(brand) <= 80),
  size           text not null default '' check (char_length(size) <= 40),
  color          text not null default '' check (char_length(color) <= 40),
  condition      text not null default '' check (char_length(condition) <= 40),
  notes          text not null default '' check (char_length(notes) <= 4000),
  location       text not null default '' check (char_length(location) <= 60),
  purchase_input bigint check (purchase_input between 0 and 10000000),
  purchase_price bigint not null default 0 check (purchase_price between 0 and 10000000),
  shipping_in    bigint not null default 0 check (shipping_in between 0 and 10000000),
  purchase_date  date,
  status         text not null default 'lager' check (status in ('lager', 'gelistet', 'verkauft')),
  listed_price   bigint check (listed_price between 0 and 10000000),
  listings       text[] not null default '{}',
  sale_price     bigint check (sale_price between 0 and 10000000),
  sale_date      date,
  sale_platform  text not null default '' check (char_length(sale_platform) <= 60),
  sale_fees      bigint not null default 0 check (sale_fees between 0 and 10000000),
  shipping_out   bigint not null default 0 check (shipping_out between 0 and 10000000),
  images         text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, article_no),
  check (status <> 'verkauft' or sale_price is not null),
  check (cardinality(images) <= 12),
  -- Ein Artikel kann nur in einem Haul desselben Nutzers liegen.
  foreign key (haul_id, user_id) references public.hauls (id, user_id) on delete set null (haul_id)
);

create table if not exists public.expenses (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  date        date not null default current_date,
  category    text not null default 'Sonstiges' check (char_length(category) <= 60),
  description text not null default '' check (char_length(description) <= 200),
  amount      bigint not null check (amount between 0 and 10000000),
  created_at  timestamptz not null default now()
);

-- Zähler für die fortlaufende Artikelnummer pro Nutzer (nur über den Trigger erreichbar).
create table if not exists public.article_counters (
  user_id uuid primary key references auth.users on delete cascade,
  next_no integer not null
);

create index if not exists articles_user_idx on public.articles (user_id);
create index if not exists articles_haul_idx on public.articles (haul_id);
create index if not exists hauls_user_idx on public.hauls (user_id);
create index if not exists expenses_user_idx on public.expenses (user_id);

-- ============================================================== Kostenverteilung
-- Muss exakt dasselbe rechnen wie distribute()/allocateHaul() in public/js/shared.js.

-- Verteilt `total` auf die Gewichte, Summe stimmt exakt (größte Reste,
-- bei Gleichstand gewinnt der vordere). Alle Gewichte 0 -> gleichmäßig.
create or replace function public.distribute(total bigint, weights bigint[])
returns bigint[]
language plpgsql immutable
set search_path = ''
as $$
declare
  n    int := coalesce(array_length(weights, 1), 0);
  w    bigint[];
  s    bigint;
  res  bigint[] := '{}';
  rems bigint[] := '{}';
  rest bigint;
  r    record;
begin
  if n = 0 then return '{}'; end if;
  w := array(select greatest(coalesce(x, 0), 0) from unnest(weights) with ordinality t(x, o) order by o);
  select sum(x) into s from unnest(w) x;
  if s = 0 then
    w := array_fill(1::bigint, array[n]);
    s := n;
  end if;
  for i in 1..n loop
    res  := res  || ((total * w[i]) / s);
    rems := rems || ((total * w[i]) % s);
  end loop;
  select total - sum(x) into rest from unnest(res) x;
  for r in select o from unnest(rems) with ordinality t(x, o) order by x desc, o asc limit rest loop
    res[r.o] := res[r.o] + 1;
  end loop;
  return res;
end $$;

-- Rechnet Einkaufspreis und Versandanteil aller Artikel eines Hauls neu aus.
create or replace function public.reallocate_haul(p_haul bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  h         public.hauls;
  ids       bigint[];
  inputs    bigint[];
  n         int;
  given_sum bigint;
  missing   int;
  purchase  bigint[] := '{}';
  shares    bigint[];
  ship      bigint[];
  k         int := 0;
begin
  select * into h from public.hauls where id = p_haul;
  if not found then return; end if;

  select array_agg(id order by article_no), array_agg(purchase_input order by article_no)
    into ids, inputs
    from public.articles where haul_id = p_haul;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then return; end if;

  select coalesce(sum(x), 0), count(*) filter (where x is null)
    into given_sum, missing
    from unnest(inputs) x;

  if h.total_price is null then
    -- Kein Gesamtpreis: Einzelpreis, leer = 0
    for i in 1..n loop purchase := purchase || coalesce(inputs[i], 0); end loop;
  elsif missing > 0 and given_sum <= h.total_price then
    -- Artikel mit Preis behalten ihn, der Rest geht gleichmäßig auf die ohne Preis
    shares := public.distribute(h.total_price - given_sum, array_fill(1::bigint, array[missing]));
    for i in 1..n loop
      if inputs[i] is null then
        k := k + 1;
        purchase := purchase || shares[k];
      else
        purchase := purchase || inputs[i];
      end if;
    end loop;
  else
    -- Alle mit Preis (oder zu viel): anteilig auf den Gesamtpreis skalieren
    purchase := public.distribute(h.total_price, array(select coalesce(x, 0) from unnest(inputs) with ordinality t(x, o) order by o));
  end if;

  ship := public.distribute(h.shipping_cost, purchase);

  for i in 1..n loop
    update public.articles
       set purchase_price = purchase[i], shipping_in = ship[i]
     where id = ids[i]
       and (purchase_price, shipping_in) is distinct from (purchase[i], ship[i]);
  end loop;
end $$;

-- ============================================================== Trigger

-- Vergibt die Artikelnummer. Security definer, damit die Zählertabelle
-- selbst nicht für Nutzer freigegeben werden muss.
create or replace function public.articles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.article_counters (user_id, next_no) values (new.user_id, 2)
  on conflict (user_id) do update set next_no = public.article_counters.next_no + 1
  returning next_no - 1 into new.article_no;
  if new.haul_id is null then
    new.purchase_price := coalesce(new.purchase_input, 0);
  end if;
  return new;
end $$;

create or replace function public.articles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.article_no := old.article_no;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  if new.haul_id is null then
    new.purchase_price := coalesce(new.purchase_input, 0);
  end if;
  return new;
end $$;

create or replace function public.articles_after_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.haul_id is not null and (tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.haul_id is distinct from new.haul_id)) then
    perform public.reallocate_haul(old.haul_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.haul_id is not null
     and (tg_op = 'INSERT' or new.haul_id is distinct from old.haul_id or new.purchase_input is distinct from old.purchase_input) then
    perform public.reallocate_haul(new.haul_id);
  end if;
  return null;
end $$;

create or replace function public.hauls_after_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.reallocate_haul(new.id);
  return null;
end $$;

drop trigger if exists articles_before_insert on public.articles;
create trigger articles_before_insert before insert on public.articles
  for each row execute function public.articles_before_insert();

drop trigger if exists articles_before_update on public.articles;
create trigger articles_before_update before update on public.articles
  for each row execute function public.articles_before_update();

-- Nur bei Änderungen, die die Verteilung betreffen. reallocate_haul() ändert
-- purchase_price/shipping_in und löst diesen Trigger deshalb nicht erneut aus.
drop trigger if exists articles_after_change on public.articles;
create trigger articles_after_change after insert or delete or update of purchase_input, haul_id on public.articles
  for each row execute function public.articles_after_change();

drop trigger if exists hauls_after_update on public.hauls;
create trigger hauls_after_update after update of total_price, shipping_cost on public.hauls
  for each row execute function public.hauls_after_update();

-- ============================================================== Funktionen für die App

-- Legt einen Haul samt Artikeln in einer Transaktion an.
create or replace function public.create_haul(haul jsonb, items jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  hid bigint;
  it  jsonb;
begin
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'Ein Haul braucht mindestens einen Artikel';
  end if;
  if jsonb_array_length(items) > 200 then
    raise exception 'Maximal 200 Artikel pro Haul';
  end if;

  insert into public.hauls (name, source, date, total_price, shipping_cost, notes)
  values (
    haul->>'name',
    coalesce(haul->>'source', ''),
    nullif(haul->>'date', '')::date,
    (haul->>'total_price')::bigint,
    coalesce((haul->>'shipping_cost')::bigint, 0),
    coalesce(haul->>'notes', '')
  ) returning id into hid;

  for it in select value from jsonb_array_elements(items) with ordinality t(value, o) order by o loop
    insert into public.articles (haul_id, title, category, brand, size, color, condition, notes, location,
                                 purchase_input, purchase_date, images)
    values (
      hid,
      it->>'title',
      coalesce(it->>'category', 'Sonstiges'),
      coalesce(it->>'brand', ''),
      coalesce(it->>'size', ''),
      coalesce(it->>'color', ''),
      coalesce(it->>'condition', ''),
      coalesce(it->>'notes', ''),
      coalesce(it->>'location', ''),
      (it->>'purchase_input')::bigint,
      coalesce(nullif(it->>'purchase_date', '')::date, nullif(haul->>'date', '')::date),
      coalesce(array(select jsonb_array_elements_text(it->'images')), '{}')
    );
  end loop;

  return hid;
end $$;

-- Löst einen Haul auf: Artikel bleiben mit ihren aktuellen Kosten als Einzelartikel.
create or replace function public.dissolve_haul(p_haul bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.articles set purchase_input = purchase_price, haul_id = null where haul_id = p_haul;
  delete from public.hauls where id = p_haul;
end $$;

-- Löscht einen Haul samt Artikeln und gibt die Bildpfade zurück, damit die App sie aufräumen kann.
create or replace function public.delete_haul(p_haul bigint)
returns text[]
language plpgsql
set search_path = ''
as $$
declare imgs text[];
begin
  select coalesce(array_agg(i), '{}') into imgs
    from public.articles a, unnest(a.images) i where a.haul_id = p_haul;
  delete from public.articles where haul_id = p_haul;
  delete from public.hauls where id = p_haul;
  return imgs;
end $$;

-- ============================================================== Rechte & Row Level Security

alter table public.hauls enable row level security;
alter table public.articles enable row level security;
alter table public.expenses enable row level security;
alter table public.article_counters enable row level security; -- bewusst ohne Policies

revoke all on public.article_counters from anon, authenticated;
grant select, insert, update, delete on public.hauls, public.articles, public.expenses to authenticated;
revoke all on public.hauls, public.articles, public.expenses from anon;

revoke execute on function public.create_haul(jsonb, jsonb), public.dissolve_haul(bigint), public.delete_haul(bigint),
  public.reallocate_haul(bigint), public.distribute(bigint, bigint[]) from public, anon;
grant execute on function public.create_haul(jsonb, jsonb), public.dissolve_haul(bigint), public.delete_haul(bigint) to authenticated;
revoke execute on function public.articles_before_insert() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hauls', 'articles', 'expenses'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ============================================================== Bilder

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Jeder darf nur in seinem eigenen Ordner <user-id>/... lesen und schreiben.
drop policy if exists "images own select" on storage.objects;
drop policy if exists "images own insert" on storage.objects;
drop policy if exists "images own update" on storage.objects;
drop policy if exists "images own delete" on storage.objects;

create policy "images own select" on storage.objects for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "images own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "images own update" on storage.objects for update to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "images own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);
