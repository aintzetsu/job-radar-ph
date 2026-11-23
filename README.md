# Job Radar PH

A modern, privacy-first job discovery, résumé matching, application drafting, and pipeline tracking workspace built specifically for Philippine and remote opportunities — with optional passwordless Gmail OTP cloud sync.

[Open the live site](https://job-radar-ph.vercel.app)

## Features

- **Live Employer ATS Radar**: Pulls live postings directly in your browser from 8 active employer ATS endpoints (Lever, Greenhouse, Ashby) with telemetry and manual/auto 5-minute refresh.
- **Smart Workbench & Filter Dock**: Filter by keyword (`/` shortcut), location, direct ATS source, posted window, and work arrangement (All / Remote / On-site), and sort by Best Match, Newest First, or Company.
- **Local Résumé Intelligence**: Drag and drop a `.pdf` / `.docx` file or paste résumé text to rank listings, surface matched/missing role keywords, and detect top skill categories.
- **Tailored Application Generator**: Generate editable résumé and cover-letter drafts with tone presets (**Balanced**, **Concise**, **Technical / Structured**), live word counts, and one-click clipboard copy.
- **Application Pipeline Tracker**: Track stages (`Saved`, `Applied`, `Interviewing`, `Offer`, `Closed`) across **List** and **Kanban Board** views, keep editable follow-up notes, filter by stage, and export to **CSV**.
- **Gmail OTP Account & Cloud Sync**: Optional passwordless sign-in via 6-digit Gmail verification code (`/api/auth` + `/api/sync`, backed by Neon Postgres) that merges local guest data and syncs your résumé, pipeline, notes, filters, and theme across devices.

## Environment variables (Vercel Serverless `/api/*`)

- `DATABASE_URL` — Neon Postgres connection string (provisioned via Vercel Neon integration)
- `SMTP_USER` — Gmail address used to deliver 6-digit OTP emails
- `SMTP_PASS` — 16-character Google App Password for `SMTP_USER`
- `SESSION_SECRET` — Random server secret for HMAC session token hashing

## Local development & tests

Install serverless dependencies once:

```bash
npm install
```

Run tests (Node.js 20+):

```bash
npm test
```

For static UI preview (guest mode), run `python -m http.server 8000` (or `vercel dev` with `.env.local` configured to test Gmail OTP & Neon sync locally).
