Business Management System (BMS) — API Map (Phase-1)

Auth
- POST /auth/login
  - request: { email, password }
  - response: { access_token, user }
- POST /auth/logout

Users & Roles (Owner/Admin)
- GET /users
- POST /users
- GET /users/:id
- PATCH /users/:id
- POST /users/:id/disable
- GET /roles
- GET /permissions

Customers
- POST /customers/request
  - request: { name, email, request_data, images[] }
- POST /customers/approve
  - request: { customer_id }
- GET /customers
- GET /customers/:id

Projects
- POST /projects
  - request: { customer_id, name, description }
- POST /projects/:id/approve
- GET /projects
- GET /projects/:id
- PATCH /projects/:id
- POST /projects/:id/assignments
- GET /projects/:id/updates
- POST /projects/:id/updates
- GET /projects/:id/comments
- POST /projects/:id/comments  -- external allowed via share token

Share Links
- POST /projects/:id/share
  - request: { purpose, expires_at }
- GET /share/:token

Files & Documents
- POST /files/upload
- GET /files/:id
- POST /projects/:id/documents
- GET /projects/:id/documents

Invoices & Payments
- POST /invoices
- GET /invoices
- GET /invoices/:id
- POST /invoices/:id/send
- POST /payments/stripe/checkout
- POST /payments/stripe/webhook

Time Tracking
- POST /time/start
- POST /time/stop
- GET /time/entries

Reports
- GET /reports/summary

Archive
- POST /archive/run
- POST /archive/restore

Audit
- GET /audit
