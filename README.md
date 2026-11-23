# Job Radar PH

A modern, privacy-first job discovery, résumé matching, application drafting, and pipeline tracking workspace built specifically for Philippine and remote opportunities.

[Open the live site](https://job-radar-ph.vercel.app)

## Features

- **Live Employer ATS Radar**: Pulls live postings directly in your browser from 8 active employer ATS endpoints (Lever, Greenhouse, Ashby) with telemetry and manual/auto 5-minute refresh.
- **Smart Workbench & Filter Dock**: Filter by keyword (`/` shortcut), location (Philippines, Metro Manila, Quezon City, Remote, Anywhere), direct ATS source, posted window, and work arrangement (All / Remote / On-site), and sort by Best Match, Newest First, or Company.
- **Local Résumé Intelligence**: Drag and drop a `.pdf` / `.docx` file or paste résumé text to rank listings, surface matched/missing role keywords (`Analyze Job Fit`), and detect top skill categories — with zero server upload (`localStorage`-only).
- **Tailored Application Generator**: Generate editable résumé and cover-letter drafts with tone selection (**Balanced**, **Concise**, **Technical / Structured**), live word counts, and one-click clipboard copy.
- **Application Pipeline Tracker**: Track stages (`Saved`, `Applied`, `Interviewing`, `Offer`, `Closed`) across **List** and **Kanban Board** views, keep editable per-role follow-up notes, filter by stage, and export your pipeline to **CSV**.
- **Signature Eclipse / Sun-Clouds Theme**: Full light & dark mode parity with persistent preferences.

## Local development

Serve this directory with any static HTTP server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Tests

Requires Node.js 20+:

```bash
node --test tests/job-radar.test.mjs
```
