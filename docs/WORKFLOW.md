# Workflow and class diagram mapping

| PDF class | Database representation | Notes |
|---|---|---|
| User | `auth.users` + `public.profiles` | Supabase Auth owns credentials; profiles store app role/name. Public signup always becomes STUDENT. |
| Complaint | `public.complaints` | Includes tracking code, category, priority, status, created/due/resolved timestamps. |
| Assignment | `public.assignments` + `complaints.assigned_officer` | Assignment history is preserved. |
| Attachment | `public.attachments` + private Storage bucket | Table stores metadata/path; binary files are not stored in PostgreSQL. |
| SLAPolicy | `public.sla_policies` | Priority-based resolution hours. Current insert uses illustrative values; replace with college-approved policy. |
| AuditEvent | `public.audit_events` | Event data, actor, previous hash, entry hash. Status changes and assignments use trusted database functions. |
| Notification | `public.notifications` | In-app notification table. Real-time delivery requires enabling Supabase Realtime and a tested client subscription. |
| EscalationService | `public.escalations` + `due_at` query | A scheduled job is not enabled by default. Overdue display is not the same as automatic escalation. |
| Policy assistant | `public.policy_chunks` + Edge Function | Optional. Requires approved policy documents, embeddings, and server-side OpenAI API key. |

## State machine

- FILED → ASSIGNED or ESCALATED
- ASSIGNED → IN_REVIEW or ESCALATED
- IN_REVIEW → RESOLVED or ESCALATED
- ESCALATED → ASSIGNED, IN_REVIEW, or RESOLVED

Status changes are made through `transition_complaint` rather than direct table updates. The UI should not be considered an authorization boundary; PostgreSQL policies/functions are the boundary.

## Audit hashing

The RPC computes SHA-256 from the preceding hash (or `GENESIS`) concatenated with the event JSON text, and inserts the event in the same database transaction as the status change. Hash chaining detects changed entries/links but cannot stop a privileged database administrator from rewriting the entire chain. Independent checkpoints are needed for stronger evidence.
