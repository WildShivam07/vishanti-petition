import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return Response.json({ error: 'Sign in required' }, { status: 401, headers: cors });
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors });
    const body = await req.json();
    const complaintId = String(body.complaintId || ''); const nextStatus = String(body.nextStatus || ''); const assignedTo = body.assignedTo ? String(body.assignedTo) : null;
    if (!complaintId || !['FILED','ASSIGNED','IN_REVIEW','RESOLVED','ESCALATED'].includes(nextStatus)) return Response.json({ error: 'Invalid request' }, { status: 400, headers: cors });
    // The database function re-checks the actor role, locks the ticket row, validates the transition,
    // and writes status + assignment + audit event + notifications atomically.
    const { data, error } = await client.rpc('apply_complaint_transition', { p_complaint_id: complaintId, p_next_status: nextStatus, p_assigned_to: assignedTo, p_note: body.note ? String(body.note).slice(0, 500) : null });
    if (error) return Response.json({ error: error.message }, { status: 400, headers: cors });
    return Response.json({ ok: true, result: data }, { headers: cors });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, { status: 500, headers: cors }); }
});
