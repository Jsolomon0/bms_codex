Business Management System (BMS) — Local Deployment Guide (Windows)

1) Prereqs
- Windows Server or Windows 10/11 Pro
- Node.js LTS
- PostgreSQL 15+
- Reverse proxy (Caddy or Nginx)
- Domain with DNS control
- SSL certificate (LetsEncrypt)

2) Directory Layout
- C:\bms\app
- C:\bms\data\postgres
- C:\bms\data\files
- C:\bms\archive
- C:\bms\backups

3) PostgreSQL Setup
- Create database: bms
- Create user: bms_app
- Set strong password and store in env vars

4) App Config
- Environment variables:
  - DATABASE_URL
  - JWT_SECRET
  - SMTP_USER, SMTP_PASS
  - STRIPE_SECRET
  - FILE_STORAGE_PATH
  - ARCHIVE_PATH

5) HTTPS
- Install Caddy
- Configure Caddyfile for HTTPS and reverse proxy to API

6) Backups
- Nightly pg_dump to C:\bms\backups
- Daily file manifest + checksum
- Retention: 30 days

7) Archiving
- Nightly job to move files older than 30 days to C:\bms\archive
- Store archive metadata in DB

8) Access Control
- Admin portal exposed to internet
- Rate limiting and optional IP allowlist

9) Monitoring
- Windows Task Scheduler for jobs
- Log rotation for app logs

10) Migration Path
- Swap local Postgres for managed Postgres
- Replace local storage with S3-compatible storage
- Deploy API to managed container hosting
