import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function toHex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function sha256(value: string) { return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return Response.json({ error: 'Sign in required' }, { status: 401, headers: cors });
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await client.auth.getUser(); if (!user) return Response.json({ error: 'Invalid session' }, { status: 401, headers: cors });
    const { complaintId } = await req.json(); if (!complaintId) return Response.json({ error: 'complaintId is required' }, { status: 400, headers: cors });
    const { data: rows, error } = await client.rpc('get_audit_verification_rows', { p_complaint_id: complaintId });
    if (error) return Response.json({ error: error.message }, { status: 403, headers: cors });
    let expectedPrevious = 'GENESIS'; let checked = 0;
    for (const row of rows || []) {
      if (row.previous_hash !== expectedPrevious) return Response.json({ valid: false, checked, message: 'Previous-hash link mismatch' }, { headers: cors });
      const calculated = await sha256(row.canonical_payload);
      if (calculated !== row.event_hash) return Response.json({ valid: false, checked, message: 'SHA-256 hash mismatch' }, { headers: cors });
      expectedPrevious = row.event_hash; checked++;
    }
    return Response.json({ valid: checked > 0, checked, message: checked ? 'SHA-256 chain verified' : 'No audit events found', algorithm: 'Web Crypto API SHA-256' }, { headers: cors });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Unexpected error' }, { status: 500, headers: cors }); }
});
