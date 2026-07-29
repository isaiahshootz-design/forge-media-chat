# Forge Media — Website Chat Widget

An embeddable sales/discovery chat widget for the Forge Media website, powered
by Claude. It greets visitors, runs discovery on websites/Meta Ads/Google Ads,
gives pricing ranges once discovery is complete, and hands off qualified leads
— following the agent instructions in `server/system-prompt.md`.

```
forge-media-widget/
├── server/                  Backend (Node/Express) — holds the API key
│   ├── server.js            Proxies chat requests to Claude
│   ├── system-prompt.md     The Forge Media agent instructions (edit here)
│   ├── package.json
│   ├── .env.example         Copy to .env and fill in your key
│   └── public/demo.html     Local test page
└── widget/
    └── forge-chat-widget.js Embeddable script for the real website
```

## Why a backend at all?

The widget can't call the Anthropic API directly from the browser — your API
key would be visible to anyone who views the page source, and they could run
up your bill. The backend in `/server` holds the key privately and is the
only thing that talks to Anthropic. The widget only ever talks to your
backend.

## 1. Get your Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in (or create an account).
2. Add a payment method under **Settings → Billing** (API usage is pay-as-you-go, billed separately from any Claude.ai subscription).
3. Go to **Settings → API Keys → Create Key**. Name it something like `forge-media-widget`.
4. Copy the key immediately — you can't view it again later.

## 2. Run the backend locally

```bash
cd server
cp .env.example .env
# open .env and paste your key into ANTHROPIC_API_KEY=

npm install
npm start
```

You should see:

```
Forge Media chat backend listening on http://localhost:3001
Model: claude-sonnet-4-6
Allowed origins: (all — dev mode)
```

Open **http://localhost:3001/demo.html** in your browser. You'll see a plain
test page with the chat bubble in the bottom-right corner — click it and try
a message like *"I need a new website for my landscaping business."*

If a message fails, check the terminal running `npm start` for the error
(most commonly: missing/invalid API key, or no billing set up on the
Anthropic account).

## 3. Deploy the backend somewhere public

The widget on your live website needs a real, public URL to call — it can't
reach `localhost` on your laptop. Any Node-friendly host works: Render,
Railway, Fly.io, a small DigitalOcean/AWS box, etc. In broad strokes:

1. Push the `server/` folder to a host of your choice.
2. Set the same environment variables from `.env` in that host's dashboard
   (never commit the real `.env` file — it's already in `.gitignore`).
3. Set `ALLOWED_ORIGINS` to your real website domain(s), e.g.
   `https://forgemedia.com,https://www.forgemedia.com` — this stops other
   sites from calling your backend with your API key's budget.
4. Note the public URL the host gives you, e.g. `https://forge-media-chat.onrender.com`.

## 4. Embed the widget on the real website

Add one line before `</body>` on every page you want the chat bubble to
appear on:

```html
<script
  src="https://forge-media-chat.onrender.com/widget/forge-chat-widget.js"
  data-api-url="https://forge-media-chat.onrender.com/api/chat"
></script>
```

(Or copy `widget/forge-chat-widget.js` directly into your website's own
static assets and host it yourself — either works, just make sure
`data-api-url` points at wherever you deployed the backend from step 3.)

Optional attributes:

- `data-agent-name` — label shown in the chat header (default: "Forge Media")
- `data-greeting` — the first message shown when a visitor opens the chat

## 5. Editing the agent's behavior

Everything the agent knows — pricing tables, discovery questions, tone,
guardrails — lives in plain English in `server/system-prompt.md`. Edit that
file and restart the server (`npm start`) to change how the agent talks or
what it quotes. No code changes needed for prompt/pricing updates.

Two placeholders were filled in from the original prompt:

- **Name/title:** Isaiah, Founder
- **Response-time commitment:** 24–48 hours
- **Booking link:** none yet — the agent is instructed not to reference or
  invent one. Once you have a Calendly (or similar) link, add it back into
  the "Hand off for the firm quote" section of `system-prompt.md`.

## 6. Leads

Whenever the agent's reply sounds like a handoff (mentions following up /
being a strategist / "based on what you've told me"), the backend:

- Appends the full transcript to `server/leads.log` (JSON, one entry per lead)
- Optionally POSTs the same transcript to `LEAD_WEBHOOK_URL` in `.env`, if
  you set one (e.g. a Zapier/Make webhook, or a HubSpot forms endpoint) —
  useful for piping leads straight into your CRM instead of reading a log file.

This detection is a simple keyword heuristic, not perfect — treat `leads.log`
as a helpful backstop, not the only place to check for new leads early on.

## Notes & limits

- The backend is intentionally simple (in-memory rate limiting, no database,
  no auth). It's built for a low-to-moderate traffic marketing site, not
  designed to withstand a targeted abuse campaign — if traffic grows, put it
  behind a proper reverse proxy/rate limiter (Cloudflare, nginx) and consider
  moving the rate limiter to Redis.
- Conversation history is kept entirely in the visitor's browser tab (sent
  back to the server on every message) and is lost on page refresh. That's
  intentional for simplicity and privacy — no visitor conversations are
  stored server-side beyond what gets logged as a detected lead.
- Never go below the low end of a pricing range, waive the ad-spend minimum,
  or apply bundle discounts without checking with Isaiah first — this is
  enforced in the prompt's guardrails, not in code, so it depends on the
  model following instructions. Spot-check a few real conversations after
  launch to confirm it's holding the line as expected.
