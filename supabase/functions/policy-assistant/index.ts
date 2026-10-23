// Optional RAG policy assistant. Deploy with Supabase CLI after configuring secrets.
// Secrets: OPENAI_API_KEY. Never expose this key to Vite/client code.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL')!; const anon = Deno.env.get('SUPABASE_ANON_KEY')!; const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) throw new Error('Policy assistant is not configured: OPENAI_API_KEY is missing.');
    const auth = req.headers.get('Authorization'); if (!auth) return new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser(); if (userErr || !user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    const body = await req.json(); const question = String(body.question || '').trim(); if (question.length < 4 || question.length > 1200) throw new Error('Question must be 4–1200 characters.');
    const embeddingRes = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'text-embedding-3-small', input: question }) });
    if (!embeddingRes.ok) throw new Error('Could not create a policy-search embedding. Check the AI provider configuration.');
    const embeddingJson = await embeddingRes.json(); const embedding = embeddingJson.data?.[0]?.embedding;
    const { data: chunks, error: searchErr } = await userClient.rpc('match_policy_chunks', { query_embedding: embedding, match_threshold: 0.35, match_count: 5 });
    if (searchErr) throw new Error('Policy search is not configured. Apply the RAG migration and ingest approved policy documents.');
    if (!chunks?.length) return new Response(JSON.stringify({ answer: 'I could not find a sufficiently relevant passage in the approved policy documents. Please contact the authorized college office.', sources: [] }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const context = chunks.map((c: any, i: number) => `[${i + 1}] ${c.document_name}${c.source_page ? `, page ${c.source_page}` : ''}: ${c.chunk_text}`).join('\n\n');
    const completion = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.1, messages: [{ role: 'system', content: 'Answer only using the supplied approved policy passages. Cite sources as [1], [2]. If the passages do not support an answer, say so. Do not reveal or infer private complaint information.' }, { role: 'user', content: `Question: ${question}\n\nApproved policy passages:\n${context}` }] }) });
    if (!completion.ok) throw new Error('The language model request failed. Check provider quota and configuration.');
    const result = await completion.json(); return new Response(JSON.stringify({ answer: result.choices?.[0]?.message?.content || 'No answer was returned.', sources: chunks.map((c: any, i: number) => ({ citation: `[${i + 1}]`, document: c.document_name, page: c.source_page, excerpt: c.chunk_text })) }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) { return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unexpected error' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }); }
});
