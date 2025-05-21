# Events Website with Cloudflare Workers & Notion

This project connects Cloudflare Workers to your Notion events table and generates a website for every event in Notion. Each event gets its own HTML page, dynamically served from the worker.

## Setup Steps
1. Add your Notion integration token and database ID to the worker's environment variables.
2. Deploy the worker to Cloudflare.
3. Visit `/events/<event-id>` to view each event's page.

---

- `/` — Home page
- `/events/:eventId` — Individual event pages (auto-generated from Notion)

---

### Requirements
- Cloudflare account
- Notion integration with access to your events table
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI

See the source files for more details.
