# Reliable Storage — Truck Rental Automation

Google Apps Script automation for Reliable Storage truck rentals (Bainbridge location).

Integrates: Google Calendar, Google Sheets, Stripe, DocuSeal, SendGrid, Twilio, Bitly.

## Current baseline: v7 (Bainbridge single-location)

`src/Code.js` is the working copy. Paste it into Extensions > Apps Script in the Google Sheet.

## Docs

- [Setup notes](docs/setup-notes.md) — Script Properties, sheet columns, trigger setup
- [Testing plan](docs/testing-plan.md) — Step-by-step Bainbridge flow test checklist

## Repo layout

```
src/Code.js            ← paste this into Apps Script
archive/v7-original.js ← unmodified v7 baseline, never edit
docs/
CLAUDE.md              ← context for Claude Code
```

## No secrets in this repo

All API keys, webhook secrets, and form URLs are stored in Apps Script Script Properties.
See docs/setup-notes.md for the full list.
