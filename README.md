# Pulse Trivia Live

Browser-based trivia game for team events.

This project is designed for the May 5, 2026 launch target:

- up to 30 players
- 10-15 questions
- multiple choice and fill in the blank
- player names on join
- speed-based scoring
- leaderboard shown after each question

## What is in this MVP

- `index.html`: single-page host and player UI
- `styles.css`: phone-friendly event styling
- `app.js`: gameplay logic, question builder, image upload support, scoring, Supabase integration, and demo mode
- `config.js`: local runtime config
- `supabase-schema.sql`: database tables and basic policies

## Modes

The app supports two modes:

- `Demo mode`
  - works with no credentials
  - stores data in browser local storage
  - useful for local testing and UI review
- `Live mode`
  - enabled when `config.js` contains Supabase credentials
  - players can join from their phones through a deployed URL

## Question Setup

The host screen now uses a simple form instead of raw JSON:

- add multiple choice questions with labeled options
- add short-answer questions with comma-separated accepted answers
- optionally upload an image for any question
- drafts autosave in the browser so refreshes do not wipe your question list
- remove or reset questions before creating the room

## Local Run

From this folder:

```bash
python3 -m http.server 4185
```

Then open:

- [http://127.0.0.1:4185](http://127.0.0.1:4185)

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor and run [supabase-schema.sql](/Users/mayurpatel/Documents/New project/team-trivia-online/supabase-schema.sql).
3. Copy [config.example.js](/Users/mayurpatel/Documents/New project/team-trivia-online/config.example.js) over `config.js`.
4. Paste your `supabaseUrl` and `supabaseAnonKey`.
5. Turn on Realtime for the `games`, `players`, and `answers` tables if it is not already enabled.

## Deployment

Recommended setup:

1. Push this folder to a GitHub repo.
2. Import the repo into Vercel as a static site.
3. If the repo contains other projects, set the Vercel root directory to `team-trivia-online`.
4. Publish.
5. Share the live URL with your team.

## Important MVP Note

This first version favors speed and ease of launch over hardened security. The included SQL uses broad anon access so the event team can get live gameplay running quickly from a static website.

For internal team use, that is usually acceptable for an event MVP. If you want to keep using it later, the next step should be adding auth and stricter update rules.
