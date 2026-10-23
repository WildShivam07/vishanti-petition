import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.LLM_API_KEY;
const baseUrl = (process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
if (!url || !serviceKey || !apiKey) {
  console.error('Set VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and LLM_API_KEY in your local .env first.');
  process.exit(1);
}
const db = createClient(url, serviceKey);
function splitIntoChunks(text, maxChars = 900) {
  const paragraphs = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const chunks = []; let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) chunks.push(current), current = '';
      for (let i = 0; i < paragraph.length; i += maxChars) chunks.push(paragraph.slice(i, i + maxChars));
    } else if ((current + '\n\n' + paragraph).trim().length > maxChars) {
      if (current) chunks.push(current); current = paragraph;
    } else current = [current, paragraph].filter(Boolean).join('\n\n');
  }
  if (current) chunks.push(current);
  return chunks;
}
async function embed(input) {
  const response = await fetch(`${baseUrl}/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
  if (!response.ok) throw new Error(`Embedding API failed (${response.status}): ${await response.text()}`);
  const body = await response.json(); const vector = body?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== 1536) throw new Error('Expected 1536-dimensional embeddings; check EMBEDDING_MODEL.');
  return `[${vector.join(',')}]`;
}
const { data: docs, error } = await db.from('policy_documents').select('id,title,section,content').eq('approved', true);
if (error) throw error;
if (!docs?.length) { console.log('No approved policy documents found. Add and approve documents in Supabase first.'); process.exit(0); }
let total = 0;
for (const doc of docs) {
  const chunks = splitIntoChunks(doc.content);
  const { error: deleteError } = await db.from('policy_chunks').delete().eq('document_id', doc.id);
  if (deleteError) throw deleteError;
  for (let index = 0; index < chunks.length; index++) {
    const embedding = await embed(`${doc.title}\n${doc.section || ''}\n${chunks[index]}`);
    const { error: insertError } = await db.from('policy_chunks').insert({ document_id: doc.id, chunk_index: index, content: chunks[index], embedding });
    if (insertError) throw insertError;
    total++;
  }
  console.log(`Indexed ${doc.title}: ${chunks.length} chunks`);
}
console.log(`Done. Indexed ${total} chunks from ${docs.length} approved document(s).`);
