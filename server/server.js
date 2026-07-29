/**
 * Forge Media — Chat Widget Backend
 * ----------------------------------
 * Small proxy server that sits between the public website chat widget and
 * the Anthropic API. The API key lives ONLY here (in .env), never in the
 * browser, so it can't be stolen via view-source or dev tools.
 *
 * Flow:
 *   Browser widget --POST /api/chat--> this server --> Anthropic API --> Claude
 *   response streamed back down to the widget.
 *
 * Setup:
 *   1. cp .env.example .env   (then fill in your real ANTHROPIC_API_KEY)
 *   2. npm install
 *   3. npm start
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = process.env.PORT || 3001;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '\n[forge-media-widget] WARNING: ANTHROPIC_API_KEY is not set.\n' +
    'Copy .env.example to .env and add your key from https://console.anthropic.com/settings/keys\n' +
    'The server will start, but /api/chat requests will fail until you do.\n'
  );
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Load the Forge Media system prompt once at startup.
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, 'system-prompt.md'),
  'utf-8'
);

const app = express();
app.use(express.json({ limit: '1mb' }));

// Local testing helpers: serve the widget script itself and a demo page so
// you can try the whole thing at http://localhost:3001/demo.html before
// embedding it on the real site. Safe to remove both lines in production.
app.use('/widget', express.static(path.join(__dirname, '..', 'widget')));
app.use(express.static(path.join(__dirname, 'public')));

// CORS: only allow requests from the domains you list in ALLOWED_ORIGINS.
app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server / curl requests with no origin header,
      // and allow anything when ALLOWED_ORIGINS is left empty (dev mode).
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);

// Very small in-memory rate limiter (per IP) to avoid runaway API cost from
// abuse/bots. For real production traffic, put this behind a proper
// rate-limiting layer (Cloudflare, nginx, express-rate-limit + Redis, etc.)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitBuckets = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || [];
  const recent = bucket.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitBuckets.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL });
});

/**
 * POST /api/chat
 * Body: { messages: [{ role: 'user' | 'assistant', content: string }, ...] }
 *
 * The client (widget) is responsible for keeping the running conversation
 * history and sending the whole thing back each turn. This server is
 * stateless — nothing about the conversation is stored between requests
 * except whatever you choose to log/forward as a lead (see below).
 */
app.post('/api/chat', async (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request body must include a non-empty "messages" array.' });
  }

  // Basic shape validation — every entry needs a role + string content.
  const cleanMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })); // guard against huge payloads

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: 'No valid messages found in request.' });
  }

  try {
    const completion = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: cleanMessages,
    });

    const textBlock = completion.content.find((block) => block.type === 'text');
    const reply = textBlock ? textBlock.text : '';

    maybeForwardLead(cleanMessages, reply).catch((err) =>
      console.error('[forge-media-widget] lead webhook error:', err.message)
    );

    res.json({ reply });
  } catch (err) {
    console.error('[forge-media-widget] Anthropic API error:', err.message);
    res.status(502).json({
      error: 'The assistant is temporarily unavailable. Please try again shortly.',
    });
  }
});

/**
 * Very lightweight lead detection: once the assistant's reply contains
 * contact-collection language, log the full transcript so a human can
 * follow up. Swap this for a real CRM/webhook integration (HubSpot, Zapier,
 * email) by setting LEAD_WEBHOOK_URL in .env.
 */
async function maybeForwardLead(messages, latestReply) {
  const signalsLeadCapture = /follow up|strategist will|based on what you.?ve told me/i.test(latestReply);
  if (!signalsLeadCapture) return;

  const transcript = [...messages, { role: 'assistant', content: latestReply }];
  const logLine = `\n[LEAD @ ${new Date().toISOString()}]\n${JSON.stringify(transcript, null, 2)}\n`;
  fs.appendFileSync(path.join(__dirname, 'leads.log'), logLine);

  if (process.env.LEAD_WEBHOOK_URL) {
    await fetch(process.env.LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, capturedAt: new Date().toISOString() }),
    });
  }
}

app.listen(PORT, () => {
  console.log(`Forge Media chat backend listening on http://localhost:${PORT}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '(all — dev mode)'}`);
});
