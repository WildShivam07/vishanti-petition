# The Vishanti Petition — enhanced project build

React + Vite frontend with Supabase Auth/Postgres, role-aware grievance workflows, staff assignment/status controls, case-history view, in-app notifications, privacy-safe aggregate metrics, and an FAQ assistant that can optionally call the policy RAG Edge Function.

> **Important:** The uploaded ZIP did not contain the abstract PDF/class diagram, so this enhancement follows the class/schema/workflow documented in the supplied project source (`docs/WORKFLOW.md`, migrations 001/002), not a direct PDF diagram review. Upload the PDF separately if exact diagram alignment is required.

## Included frontend features
- Landing page, registration, login, sign out, responsive navigation.
- Student dashboard to file and search petitions, filter by status, inspect the assigned officer, due date, status, and case history.
- Staff dashboard (OFFICER/ADMIN role only) to see the permitted complaint queue, assign officers, and change status through database RPC functions.
- In-app notification list and read marking.
- Transparency page using a privacy-safe aggregate SQL function; it does not expose complaint descriptions or student identities.
- Help/FAQ chatbot with deterministic answers for common questions. If the policy assistant Edge Function is deployed and authenticated, it tries RAG first.
- SLA values are labelled illustrative; the shown average is calculated from resolved records only when aggregate SQL migration 003 is applied.

## Setup on Windows / VS Code
1. Extract this ZIP and open the folder in VS Code.
2. In the terminal run `npm.cmd install`.
3. Copy `.env.example` to `.env` and set your Supabase project URL and publishable/anon key:
   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
   ```
4. Run `npm.cmd run dev` and open the local URL Vite prints.

Never add Supabase service-role/secret keys or an OpenAI API key to a `VITE_` variable. The ZIP intentionally excludes `.env` and `node_modules`.

## Database setup
In Supabase SQL Editor, apply in order to the project that already has the schema:
1. `supabase/migrations/001_initial_schema.sql` — base schema and role-aware workflow.
2. `supabase/migrations/002_rag.sql` — vector retrieval function.
3. `supabase/migrations/003_public_metrics_and_officer_lookup.sql` — privacy-safe public aggregate metrics and safe lookup of an assigned officer for the current student's own cases.

Migration 001 is labelled for a new project and creates base tables/functions. If you already applied it, do not repeatedly rerun the whole migration blindly; run only the new migration 003 and confirm previous migrations are in place.

### Roles
Public registration always creates a STUDENT profile. To test staff functions, an administrator/project owner must promote a known test account to `OFFICER` or `ADMIN` in the Supabase SQL Editor after verifying its auth user UUID. Do not expose role promotion in the public UI.

### Workflow
Allowed status changes:
- FILED → ASSIGNED or ESCALATED
- ASSIGNED → IN_REVIEW or ESCALATED
- IN_REVIEW → RESOLVED or ESCALATED
- ESCALATED → ASSIGNED, IN_REVIEW, or RESOLVED
- RESOLVED is terminal in the current state machine

Staff assignment uses `assign_complaint`; status changes use `transition_complaint`. Database functions/RLS, not UI buttons, enforce permissions.

## FAQ and optional RAG/LLM
The FAQ chatbot works without an LLM. For policy-grounded RAG answers, deploy `supabase/functions/policy-assistant/index.ts`, set `OPENAI_API_KEY` as a Supabase Function secret, and ingest institution-approved policy document chunks with `text-embedding-3-small` embeddings into `public.policy_chunks`. The RAG function should answer only from approved policy chunks; if the documents do not specify an actual average resolution time, it must say so. Do not index private complaints as policy documents.

## Privacy / project limitations to address before production
- Students must not see other students' private complaint descriptions. The “all complaints” staff queue is available only to staff roles. The transparency page is aggregate-only.
- The anonymous-display checkbox is not true anonymity: the system retains the submitter account link.
- SLA hours in migration 001 are illustrative, not approved college policy. Change them only after the college confirms the actual policy.
- Due-date display does not mean an automatic escalation scheduler is running.
- Audit hash chaining detects many alterations but is not protection against a privileged database administrator rewriting the entire chain.
- This is a project prototype, not a production security certification. Test RLS, Storage, staff roles, backups, email settings, and privacy requirements before real complaint data is used.

## Checks
Run `npm.cmd run build` and `npm.cmd test` after installing dependencies. This archive's source syntax was checked; a full production build should be run on your Windows machine after `npm.cmd install` so npm installs the correct platform-specific optional dependencies.
