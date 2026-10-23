import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = req.headers.get('Authorization'); if (!authorization) return json({ error: 'Sign in required' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await supabase.auth.getUser(); if (!user) return json({ error: 'Invalid session' }, 401);
    const { title, description, category } = await req.json();
    if (typeof title !== 'string' || typeof description !== 'string' || description.trim().length < 20 || title.length > 140 || description.length > 8000) return json({ error: 'Enter a title and at least 20 characters of description.' }, 400);
    const apiKey = Deno.env.get('LLM_API_KEY'); const baseUrl = (Deno.env.get('LLM_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
    if (!apiKey) return json({ error: 'Duplicate suggestions require LLM_API_KEY in Edge Function secrets.' }, 503);
    const r = await fetch(`${baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: Deno.env.get('EMBEDDING_MODEL') || 'text-embedding-3-small', input: `${category || ''}\n${title}\n${description}` }) });
    if (!r.ok) return json({ error: `Embedding provider error (${r.status}).` }, 502);
    const payload = await r.json(); const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== 1536) return json({ error: 'Embedding model must return 1536 dimensions.' }, 502);
    const { data, error } = await supabase.rpc('match_similar_complaints', { query_embedding: `[${vector.join(',')}]`, p_category: category || null, match_count: 5 });
    if (error) return json({ error: `Similarity search failed: ${error.message}` }, 500);
    return json({ suggestions: data || [], note: 'Similarity is a suggestion only. Review the existing petition; do not copy private details into a new report.' });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500); }
});
