-- 검색·수집 속도 개선
-- Supabase SQL Editor에서 전체 실행

begin;

create extension if not exists pg_trgm;

create index if not exists collection_jobs_requester_created_idx
  on public.collection_jobs(requester_hash, created_at desc);

create index if not exists job_patents_job_order_idx
  on public.job_patents(job_id, display_order);

alter table public.patents
  add column if not exists search_text text
  generated always as (
    lower(
      coalesce(invention_title, '') || ' ' ||
      coalesce(applicant_name, '') || ' ' ||
      coalesce(ipc_number, '') || ' ' ||
      coalesce(application_number, '') || ' ' ||
      coalesce(abstract, '')
    )
  ) stored;

create index if not exists patents_search_text_trgm_idx
  on public.patents using gin (search_text gin_trgm_ops)
  where is_public = true;

create index if not exists patents_public_created_idx
  on public.patents(created_at desc)
  where is_public = true;

create or replace function public.search_public_patents(
  p_query text default '',
  p_limit integer default 50
)
returns table (
  id uuid,
  application_number text,
  invention_title text,
  applicant_name text,
  ipc_number text,
  application_date text,
  abstract text,
  register_status text
)
language sql
stable
set search_path = public
as $$
  select
    p.id,
    p.application_number,
    p.invention_title,
    p.applicant_name,
    p.ipc_number,
    p.application_date,
    p.abstract,
    p.register_status
  from public.patents p
  where p.is_public = true
    and (
      btrim(coalesce(p_query, '')) = ''
      or p.search_text ilike '%' || lower(btrim(p_query)) || '%'
    )
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.search_public_patents(text, integer)
  from public;
grant execute on function public.search_public_patents(text, integer)
  to anon, authenticated, service_role;

create or replace function public.bulk_save_patent_results(
  p_job_id uuid,
  p_patents jsonb
)
returns table (
  application_number text,
  patent_id uuid,
  display_order integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  if p_job_id is null then
    raise exception '작업 ID가 비어 있습니다.';
  end if;

  p_patents := coalesce(p_patents, '[]'::jsonb);
  if jsonb_typeof(p_patents) <> 'array' then
    raise exception '특허 결과는 JSON 배열이어야 합니다.';
  end if;

  if not exists (
    select 1
    from public.collection_jobs j
    where j.id = p_job_id
  ) then
    raise exception '대상 작업을 찾을 수 없습니다.';
  end if;

  v_total := jsonb_array_length(p_patents);

  with input_rows as (
    select
      item,
      ordinality::integer as row_order
    from jsonb_array_elements(p_patents)
      with ordinality as source(item, ordinality)
  ),
  normalized as (
    select
      nullif(btrim(item ->> 'application_number'), '') as application_number,
      nullif(btrim(item ->> 'invention_title'), '') as invention_title,
      nullif(btrim(item ->> 'applicant_name'), '') as applicant_name,
      nullif(btrim(item ->> 'ipc_number'), '') as ipc_number,
      nullif(btrim(item ->> 'register_status'), '') as register_status,
      nullif(btrim(item ->> 'register_number'), '') as register_number,
      nullif(btrim(item ->> 'register_date'), '') as register_date,
      nullif(btrim(item ->> 'application_date'), '') as application_date,
      nullif(btrim(item ->> 'open_number'), '') as open_number,
      nullif(btrim(item ->> 'open_date'), '') as open_date,
      nullif(btrim(item ->> 'publication_number'), '') as publication_number,
      nullif(btrim(item ->> 'publication_date'), '') as publication_date,
      nullif(btrim(item ->> 'abstract'), '') as abstract,
      nullif(btrim(item ->> 'drawing_url'), '') as drawing_url,
      nullif(btrim(item ->> 'big_drawing_url'), '') as big_drawing_url,
      coalesce(item -> 'raw_search_json', '{}'::jsonb) as raw_search_json,
      row_order
    from input_rows
    where nullif(btrim(item ->> 'application_number'), '') is not null
  )
  insert into public.patents (
    application_number,
    invention_title,
    applicant_name,
    ipc_number,
    register_status,
    register_number,
    register_date,
    application_date,
    open_number,
    open_date,
    publication_number,
    publication_date,
    abstract,
    drawing_url,
    big_drawing_url,
    raw_search_json,
    is_public,
    first_collected_by
  )
  select
    n.application_number,
    n.invention_title,
    n.applicant_name,
    n.ipc_number,
    n.register_status,
    n.register_number,
    n.register_date,
    n.application_date,
    n.open_number,
    n.open_date,
    n.publication_number,
    n.publication_date,
    n.abstract,
    n.drawing_url,
    n.big_drawing_url,
    n.raw_search_json,
    true,
    j.requested_by
  from normalized n
  cross join public.collection_jobs j
  where j.id = p_job_id
  on conflict on constraint patents_application_number_key do update
  set
    invention_title = coalesce(excluded.invention_title, public.patents.invention_title),
    applicant_name = coalesce(excluded.applicant_name, public.patents.applicant_name),
    ipc_number = coalesce(excluded.ipc_number, public.patents.ipc_number),
    register_status = coalesce(excluded.register_status, public.patents.register_status),
    register_number = coalesce(excluded.register_number, public.patents.register_number),
    register_date = coalesce(excluded.register_date, public.patents.register_date),
    application_date = coalesce(excluded.application_date, public.patents.application_date),
    open_number = coalesce(excluded.open_number, public.patents.open_number),
    open_date = coalesce(excluded.open_date, public.patents.open_date),
    publication_number = coalesce(excluded.publication_number, public.patents.publication_number),
    publication_date = coalesce(excluded.publication_date, public.patents.publication_date),
    abstract = coalesce(excluded.abstract, public.patents.abstract),
    drawing_url = coalesce(excluded.drawing_url, public.patents.drawing_url),
    big_drawing_url = coalesce(excluded.big_drawing_url, public.patents.big_drawing_url),
    raw_search_json = case
      when excluded.raw_search_json <> '{}'::jsonb then excluded.raw_search_json
      else public.patents.raw_search_json
    end,
    is_public = true,
    first_collected_by = coalesce(
      public.patents.first_collected_by,
      excluded.first_collected_by
    );

  with input_rows as (
    select
      nullif(btrim(item ->> 'application_number'), '') as application_number,
      ordinality::integer as row_order
    from jsonb_array_elements(p_patents)
      with ordinality as source(item, ordinality)
  )
  insert into public.job_patents (
    job_id,
    patent_id,
    display_order
  )
  select
    p_job_id,
    p.id,
    i.row_order
  from input_rows i
  join public.patents p
    on p.application_number = i.application_number
  where i.application_number is not null
  on conflict (job_id, patent_id) do update
  set display_order = excluded.display_order;

  update public.collection_jobs
  set
    progress_total = v_total,
    progress_current = 0,
    result_count = (
      select count(*)
      from public.job_patents jp
      where jp.job_id = p_job_id
    )
  where id = p_job_id;

  return query
  with input_rows as (
    select
      nullif(btrim(item ->> 'application_number'), '') as app_number,
      ordinality::integer as row_order
    from jsonb_array_elements(p_patents)
      with ordinality as source(item, ordinality)
  )
  select
    i.app_number,
    p.id,
    i.row_order
  from input_rows i
  join public.patents p
    on p.application_number = i.app_number
  where i.app_number is not null
  order by i.row_order;
end;
$$;

revoke all on function public.bulk_save_patent_results(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.bulk_save_patent_results(uuid, jsonb)
  to service_role;

create or replace function public.record_patent_pdf(
  p_patent_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_name text,
  p_byte_size bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.patent_documents (
    patent_id,
    document_type,
    storage_bucket,
    storage_path,
    original_name,
    byte_size
  )
  values (
    p_patent_id,
    'publication_pdf',
    p_storage_bucket,
    p_storage_path,
    p_original_name,
    p_byte_size
  )
  on conflict (patent_id, document_type) do update
  set
    storage_bucket = excluded.storage_bucket,
    storage_path = excluded.storage_path,
    original_name = excluded.original_name,
    byte_size = excluded.byte_size;

  update public.patents
  set pdf_storage_path = p_storage_path
  where id = p_patent_id;
end;
$$;

revoke all on function public.record_patent_pdf(
  uuid, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.record_patent_pdf(
  uuid, text, text, text, bigint
) to service_role;

commit;
