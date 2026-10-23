import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = req.headers.get('Authorization'); if (!authorization) return json({ error: 'Sign in required' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await userClient.auth.getUser(); if (!user) return json({ error: 'Invalid session' },  401);
    const { complaintId } = await req.json(); if (typeof complaintId !== 'string') return json({ error: 'complaintId is required' }, 400);
    const { data: complaint, error: readError } = await userClient.from('complaints').select('id,title,category,description,created_by').eq('id', complaintId).single();
    if (readError || complaint?.created_by !== user.id) return json({ error: 'Petition not found or not permitted' }, 403);
    const apiKey = Deno.env.get('LLM_API_KEY'); if (!apiKey) return json({ indexed: false, message: 'AI indexing is not configured. Core petition workflow is unaffected.' });
    const baseUrl = (Deno.env.get('LLM_API_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
    const r = await fetch(`${baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: Deno.env.get('EMBEDDING_MODEL') || 'text-embedding-3-small', input: `${complaint.category}\n${complaint.title}\n${complaint.description}` }) });
    if (!r.ok) return json({ indexed: false, message: `Embedding provider returned ${r.status}.` });
    const payload = await r.json(); const embedding = payload?.data?.[0]?.embedding; if (!Array.isArray(embedding) || embedding.length !== 1536) return json({ indexed: false, message: 'Embedding dimensions do not match the database.' });
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await admin.from('complaint_embeddings').upsert({ complaint_id: complaint.id, embedding: `[${embedding.join(',')}]` });
    if (error) return json({ indexed: false, message: `Embedding storage failed: ${error.message}` });
    return json({ indexed: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500); }
});
