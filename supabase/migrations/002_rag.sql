-- Optional RAG retrieval. Apply after 001 and ingest approved policy chunks.
create or replace function public.match_policy_chunks(query_embedding vector(1536), match_threshold float default 0.35, match_count int default 5)
returns table(id bigint, document_name text, source_page integer, chunk_text text, similarity float)
language sql stable security invoker set search_path=public as $$
 select pc.id,pc.document_name,pc.source_page,pc.chunk_text,1-(pc.embedding <=> query_embedding) as similarity
 from public.policy_chunks pc where pc.embedding is not null and 1-(pc.embedding <=> query_embedding)>match_threshold
 order by pc.embedding <=> query_embedding limit least(match_count,10);
$$;
revoke all on function public.match_policy_chunks(vector,float,int) from public,anon,authenticated;
grant execute on function public.match_policy_chunks(vector,float,int) to authenticated;
