/**
 * Forge Media — Embeddable Website Chat Widget
 * ---------------------------------------------
 * Drop this on any page:
 *
 *   <script
 *     src="forge-chat-widget.js"
 *     data-api-url="https://YOUR-BACKEND-DOMAIN.com/api/chat"
 *   ></script>
 *
 * That's it — no other markup needed. The widget builds its own floating
 * bubble + chat panel and injects its own CSS, so it won't collide with the
 * host site's styles (everything is scoped under #forge-chat-widget-root).
 *
 * The widget never talks to Anthropic directly — it only calls the
 * data-api-url above, which should point at your deployed backend
 * (see /server in this project). The API key stays server-side.
 */
(function () {
  'use strict';

  var currentScript = document.currentScript;
  var API_URL = (currentScript && currentScript.getAttribute('data-api-url')) || '/api/chat';
  var AGENT_NAME = (currentScript && currentScript.getAttribute('data-agent-name')) || 'Forge Media';
  var GREETING =
    (currentScript && currentScript.getAttribute('data-greeting')) ||
    "Hey — I'm the Forge Media growth consultant. Are you looking into a new website, Meta Ads, Google Ads, or a mix?";

  var messages = []; // { role: 'user' | 'assistant', content: string }
  var isSending = false;

  // ---------- Styles ----------
  var css = [
    '#forge-chat-widget-root, #forge-chat-widget-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }',
    '#forge-chat-widget-root { position: fixed; bottom: 24px; right: 24px; z-index: 999999; }',
    '.fcw-bubble { width: 60px; height: 60px; border-radius: 50%; background: #1a1f2e; color: #fff; border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; transition: transform 0.15s ease; }',
    '.fcw-bubble:hover { transform: scale(1.06); }',
    '.fcw-bubble svg { width: 26px; height: 26px; }',
    '.fcw-panel { position: fixed; bottom: 96px; right: 24px; width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 140px); background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.22); display: none; flex-direction: column; overflow: hidden; border: 1px solid #e7e9ee; }',
    '.fcw-panel.fcw-open { display: flex; }',
    '.fcw-header { background: #1a1f2e; color: #fff; padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; }',
    '.fcw-header-title { font-size: 15px; font-weight: 600; }',
    '.fcw-header-sub { font-size: 12px; color: #b7bccb; margin-top: 2px; }',
    '.fcw-close { background: transparent; border: none; color: #b7bccb; cursor: pointer; font-size: 20px; line-height: 1; padding: 4px; }',
    '.fcw-close:hover { color: #fff; }',
    '.fcw-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f7f8fa; display: flex; flex-direction: column; gap: 10px; }',
    '.fcw-msg { max-width: 84%; padding: 10px 13px; border-radius: 12px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }',
    '.fcw-msg-assistant { align-self: flex-start; background: #fff; border: 1px solid #e7e9ee; color: #1a1f2e; border-bottom-left-radius: 3px; }',
    '.fcw-msg-user { align-self: flex-end; background: #2f6fed; color: #fff; border-bottom-right-radius: 3px; }',
    '.fcw-typing { align-self: flex-start; display: flex; gap: 4px; padding: 10px 13px; }',
    '.fcw-typing span { width: 6px; height: 6px; border-radius: 50%; background: #b7bccb; display: inline-block; animation: fcw-blink 1.2s infinite ease-in-out; }',
    '.fcw-typing span:nth-child(2) { animation-delay: 0.2s; }',
    '.fcw-typing span:nth-child(3) { animation-delay: 0.4s; }',
    '@keyframes fcw-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }',
    '.fcw-input-row { display: flex; align-items: flex-end; gap: 8px; padding: 12px; border-top: 1px solid #e7e9ee; background: #fff; }',
    '.fcw-input { flex: 1; resize: none; border: 1px solid #dcdfe6; border-radius: 10px; padding: 9px 12px; font-size: 13.5px; max-height: 90px; outline: none; }',
    '.fcw-input:focus { border-color: #2f6fed; }',
    '.fcw-send { background: #1a1f2e; color: #fff; border: none; border-radius: 10px; padding: 0 16px; height: 38px; cursor: pointer; font-size: 13px; font-weight: 600; }',
    '.fcw-send:disabled { opacity: 0.5; cursor: default; }',
    '.fcw-error { align-self: center; font-size: 12px; color: #b3261e; background: #fdecea; border: 1px solid #f6cccb; padding: 6px 10px; border-radius: 8px; }',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- DOM ----------
  var root = document.createElement('div');
  root.id = 'forge-chat-widget-root';

  root.innerHTML =
    '<button class="fcw-bubble" aria-label="Open chat" type="button">' +
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4H20V16H7.5L4 19.5V4Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>' +
    '</button>' +
    '<div class="fcw-panel">' +
      '<div class="fcw-header">' +
        '<div>' +
          '<div class="fcw-header-title">' + escapeHtml(AGENT_NAME) + '</div>' +
          '<div class="fcw-header-sub">Growth Consultant</div>' +
        '</div>' +
        '<button class="fcw-close" aria-label="Close chat" type="button">&times;</button>' +
      '</div>' +
      '<div class="fcw-messages"></div>' +
      '<div class="fcw-input-row">' +
        '<textarea class="fcw-input" rows="1" placeholder="Type a message..."></textarea>' +
        '<button class="fcw-send" type="button">Send</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(root);

  var bubbleBtn = root.querySelector('.fcw-bubble');
  var panelEl = root.querySelector('.fcw-panel');
  var closeBtn = root.querySelector('.fcw-close');
  var messagesEl = root.querySelector('.fcw-messages');
  var inputEl = root.querySelector('.fcw-input');
  var sendBtn = root.querySelector('.fcw-send');

  bubbleBtn.addEventListener('click', function () {
    var opening = !panelEl.classList.contains('fcw-open');
    panelEl.classList.toggle('fcw-open');
    if (opening && messages.length === 0) {
      appendMessage('assistant', GREETING);
      messages.push({ role: 'assistant', content: GREETING });
    }
    if (opening) inputEl.focus();
  });

  closeBtn.addEventListener('click', function () {
    panelEl.classList.remove('fcw-open');
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 90) + 'px';
  });

  sendBtn.addEventListener('click', handleSend);

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function appendMessage(role, text) {
    var el = document.createElement('div');
    el.className = 'fcw-msg ' + (role === 'user' ? 'fcw-msg-user' : 'fcw-msg-assistant');
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'fcw-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function showError(text) {
    var el = document.createElement('div');
    el.className = 'fcw-error';
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function handleSend() {
    var text = inputEl.value.trim();
    if (!text || isSending) return;

    appendMessage('user', text);
    messages.push({ role: 'user', content: text });
    inputEl.value = '';
    inputEl.style.height = 'auto';

    isSending = true;
    sendBtn.disabled = true;
    var typingEl = showTyping();

    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Request failed');
          return data;
        });
      })
      .then(function (data) {
        typingEl.remove();
        appendMessage('assistant', data.reply);
        messages.push({ role: 'assistant', content: data.reply });
      })
      .catch(function (err) {
        typingEl.remove();
        showError("Sorry — I couldn't send that. " + (err.message || 'Please try again.'));
      })
      .finally(function () {
        isSending = false;
        sendBtn.disabled = false;
      });
  }
})();
