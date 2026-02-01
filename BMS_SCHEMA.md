Business Management System (BMS) — Detailed Database Schema (Phase-1)

Notes
- PostgreSQL syntax and data types assumed.
- Primary keys use UUIDs.
- Timestamps are UTC.

Extensions
- pgcrypto (for gen_random_uuid)

Tables

1) roles
- id UUID PK default gen_random_uuid()
- name TEXT UNIQUE NOT NULL
- description TEXT NULL
- created_at TIMESTAMP NOT NULL default now()

2) permissions
- id UUID PK default gen_random_uuid()
- feature TEXT NOT NULL
- action TEXT NOT NULL
- description TEXT NULL
- created_at TIMESTAMP NOT NULL default now()
- UNIQUE(feature, action)

3) role_permissions
- role_id UUID FK roles(id) ON DELETE CASCADE
- permission_id UUID FK permissions(id) ON DELETE CASCADE
- created_at TIMESTAMP NOT NULL default now()
- PRIMARY KEY (role_id, permission_id)

4) users
- id UUID PK default gen_random_uuid()
- role_id UUID FK roles(id) NOT NULL
- email TEXT UNIQUE NOT NULL
- password_hash TEXT NULL
- name TEXT NOT NULL
- phone TEXT NULL
- status TEXT NOT NULL default 'active'  -- active, disabled, pending
- last_login_at TIMESTAMP NULL
- created_at TIMESTAMP NOT NULL default now()
- updated_at TIMESTAMP NOT NULL default now()

5) customers
- id UUID PK default gen_random_uuid()
- user_id UUID FK users(id) NULL  -- long-term customers
- type TEXT NOT NULL  -- short_term, long_term
- name TEXT NOT NULL
- email TEXT NOT NULL
- status TEXT NOT NULL default 'active'  -- active, expired, converted
- expires_at TIMESTAMP NULL  -- for short-term inactivity expiry
- created_at TIMESTAMP NOT NULL default now()
- updated_at TIMESTAMP NOT NULL default now()

6) customer_approvals
- id UUID PK default gen_random_uuid()
- customer_id UUID FK customers(id) NOT NULL
- approved_by UUID FK users(id) NOT NULL
- approved_at TIMESTAMP NOT NULL default now()
- status TEXT NOT NULL  -- approved, rejected
- notes TEXT NULL

7) access_tokens
- id UUID PK default gen_random_uuid()
- token TEXT UNIQUE NOT NULL
- project_id UUID FK projects(id) NOT NULL
- purpose TEXT NOT NULL  -- share_view, share_comment
- expires_at TIMESTAMP NULL
- created_by UUID FK users(id) NULL
- created_at TIMESTAMP NOT NULL default now()

8) project_requests
- id UUID PK default gen_random_uuid()
- customer_id UUID FK customers(id) NOT NULL
- request_data JSONB NOT NULL
- status TEXT NOT NULL default 'new'  -- new, reviewed, converted
- created_at TIMESTAMP NOT NULL default now()

9) projects
- id UUID PK default gen_random_uuid()
- customer_id UUID FK customers(id) NOT NULL
- name TEXT NOT NULL
- description TEXT NULL
- status TEXT NOT NULL default 'pending_approval'  -- pending_approval, active, completed, archived
- created_by UUID FK users(id) NOT NULL
- approved_by UUID FK users(id) NULL
- approved_at TIMESTAMP NULL
- start_date DATE NULL
- end_date DATE NULL
- created_at TIMESTAMP NOT NULL default now()
- updated_at TIMESTAMP NOT NULL default now()

10) project_assignments
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) ON DELETE CASCADE
- user_id UUID FK users(id) NOT NULL
- role_in_project TEXT NOT NULL  -- employee, subcontractor
- assigned_at TIMESTAMP NOT NULL default now()

11) project_updates
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) ON DELETE CASCADE
- author_id UUID FK users(id) NOT NULL
- note TEXT NOT NULL
- created_at TIMESTAMP NOT NULL default now()

12) project_images
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) ON DELETE CASCADE
- file_id UUID FK files(id) NOT NULL
- caption TEXT NULL
- created_at TIMESTAMP NOT NULL default now()

13) comments
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) ON DELETE CASCADE
- author_type TEXT NOT NULL  -- user, external
- author_id UUID FK users(id) NULL
- external_name TEXT NULL
- body TEXT NOT NULL
- created_at TIMESTAMP NOT NULL default now()

14) documents
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) ON DELETE CASCADE
- file_id UUID FK files(id) NOT NULL
- category TEXT NOT NULL  -- contract, receipt, invoice, other
- created_by UUID FK users(id) NOT NULL
- created_at TIMESTAMP NOT NULL default now()

15) files
- id UUID PK default gen_random_uuid()
- path TEXT NOT NULL
- size_bytes BIGINT NOT NULL
- mime_type TEXT NULL
- checksum TEXT NULL
- stored_at TIMESTAMP NOT NULL default now()
- archived_at TIMESTAMP NULL
- archive_path TEXT NULL

16) invoices
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) NOT NULL
- customer_id UUID FK customers(id) NOT NULL
- amount_cents BIGINT NOT NULL
- currency TEXT NOT NULL default 'USD'
- status TEXT NOT NULL default 'draft'  -- draft, sent, paid, overdue, void
- due_date DATE NULL
- created_by UUID FK users(id) NOT NULL
- created_at TIMESTAMP NOT NULL default now()

17) payments
- id UUID PK default gen_random_uuid()
- invoice_id UUID FK invoices(id) NOT NULL
- provider TEXT NOT NULL  -- stripe
- provider_ref TEXT NOT NULL
- amount_cents BIGINT NOT NULL
- currency TEXT NOT NULL default 'USD'
- status TEXT NOT NULL  -- pending, succeeded, failed
- created_at TIMESTAMP NOT NULL default now()

18) time_entries
- id UUID PK default gen_random_uuid()
- project_id UUID FK projects(id) NOT NULL
- user_id UUID FK users(id) NOT NULL
- start_time TIMESTAMP NOT NULL
- end_time TIMESTAMP NULL
- minutes INT NULL
- created_at TIMESTAMP NOT NULL default now()

19) audit_log
- id UUID PK default gen_random_uuid()
- actor_id UUID FK users(id) NULL
- action TEXT NOT NULL
- target_type TEXT NOT NULL
- target_id UUID NULL
- meta JSONB NULL
- created_at TIMESTAMP NOT NULL default now()

20) archive_jobs
- id UUID PK default gen_random_uuid()
- status TEXT NOT NULL  -- queued, running, completed, failed
- started_at TIMESTAMP NULL
- finished_at TIMESTAMP NULL
- details JSONB NULL

Indexes (Recommended)
- users(email)
- customers(email)
- projects(status, customer_id)
- project_updates(project_id, created_at)
- invoices(status, due_date)
- time_entries(user_id, project_id, start_time)
- files(archived_at)

Constraints & Rules
- Short-term customers must have expires_at populated.
- Long-term customers must have user_id populated.
- Projects require approval by Owner/Admin to move to active.
- Comments from external viewers require a valid access_token.
