-- bucket público para fotos de recepción
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos','fotos', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='fotos_anon_insert') then
    create policy fotos_anon_insert on storage.objects for insert to anon with check (bucket_id = 'fotos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='fotos_public_read') then
    create policy fotos_public_read on storage.objects for select to anon, authenticated using (bucket_id = 'fotos');
  end if;
end $$;
