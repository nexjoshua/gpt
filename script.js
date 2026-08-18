/* ============================================================
   Ainex — chat frontend logic
   Vanilla JS. Talks to Supabase for auth + storage, and to the
   "chat" Edge Function (supabase/functions/chat) for AI replies.
   ============================================================ */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     DOM references
     --------------------------------------------------------- */
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const sidebarOpenBtn = document.getElementById('sidebarOpen');
  const sidebarCloseBtn = document.getElementById('sidebarClose');
  const newChatBtn = document.getElementById('newChatBtn');
  const threadList = document.getElementById('threadList');
  const threadListEmpty = document.getElementById('threadListEmpty');

  const themeToggle = document.getElementById('themeToggle');
  const themeToggleLabel = document.getElementById('themeToggleLabel');

  const chatScroll = document.getElementById('chatScroll');
  const messagesEl = document.getElementById('messages');
  const emptyState = document.getElementById('emptyState');
  const typingRow = document.getElementById('typingRow');
  const conversationTitle = document.getElementById('conversationTitle');

  const composerForm = document.getElementById('composerForm');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  const userMessageTpl = document.getElementById('userMessageTpl');
  const aiMessageTpl = document.getElementById('aiMessageTpl');

  const suggestionCards = document.querySelectorAll('.suggestion-card');

  const accountName = document.getElementById('accountName');
  const accountEmail = document.getElementById('accountEmail');
  const accountAvatar = document.getElementById('accountAvatar');

  /* ---------------------------------------------------------
     State
     --------------------------------------------------------- */
  let currentUser = null;
  let currentConversationId = null;
  let conversation = []; // [{ role: 'user' | 'assistant', content: string }, ...]
  let isWaitingForResponse = false;

  /* ---------------------------------------------------------
     Theme handling (persisted to localStorage)
     --------------------------------------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggleLabel.textContent = theme === 'dark' ? 'Dark mode' : 'Light mode';
    swapLogos(theme);
    try {
      localStorage.setItem('ainex-theme', theme);
    } catch (e) {
      /* localStorage unavailable — theme just won't persist */
    }
  }

  function swapLogos(theme) {
    const file = theme === 'light' ? 'logo-black.png' : 'logo-white.png';
    document.querySelectorAll('img[src="logo-white.png"], img[src="logo-black.png"]').forEach((img) => {
      img.src = file;
    });
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem('ainex-theme');
    } catch (e) {
      /* ignore */
    }
    if (saved === 'dark' || saved === 'light') {
      applyTheme(saved);
    } else {
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      applyTheme(prefersLight ? 'light' : 'dark');
    }
  }

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  initTheme();

  /* ---------------------------------------------------------
     Sidebar (mobile collapse)
     --------------------------------------------------------- */
  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }

  sidebarOpenBtn.addEventListener('click', openSidebar);
  sidebarCloseBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  /* ---------------------------------------------------------
     Auth lifecycle — wired up by auth.js via custom events
     --------------------------------------------------------- */
  document.addEventListener('ainex:signed-in', (e) => {
    currentUser = e.detail.user;
    renderAccount(currentUser);
    startNewChat();
    loadThreads();
  });

  document.addEventListener('ainex:signed-out', () => {
    currentUser = null;
    currentConversationId = null;
    conversation = [];
    messagesEl.innerHTML = '';
    threadList.querySelectorAll('.thread-item').forEach((el) => el.remove());
    threadListEmpty.style.display = 'block';
  });

  function renderAccount(user) {
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || user.email || 'Account';
    accountName.textContent = name;
    accountEmail.textContent = user.email || '';
    accountAvatar.textContent = name.trim().charAt(0).toUpperCase() || '?';
  }

  /* ---------------------------------------------------------
     Threads (conversations list, loaded from Supabase)
     --------------------------------------------------------- */
  async function loadThreads() {
    const { data, error } = await supabaseClient
      .from('conversations')
      .select('id, title, updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Failed to load conversations:', error);
      return;
    }

    renderThreadList(data || []);
  }

  function renderThreadList(threads) {
    threadList.querySelectorAll('.thread-item').forEach((el) => el.remove());
    threadListEmpty.style.display = threads.length === 0 ? 'block' : 'none';

    threads.forEach((thread) => {
      threadList.appendChild(buildThreadItem(thread));
    });
  }

  function buildThreadItem(thread) {
    const btn = document.createElement('button');
    btn.className = 'thread-item';
    btn.dataset.id = thread.id;
    if (thread.id === currentConversationId) btn.classList.add('active');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<span></span>';
    btn.querySelector('span').textContent = thread.title;
    return btn;
  }

  threadList.addEventListener('click', (e) => {
    const item = e.target.closest('.thread-item');
    if (!item) return;
    selectConversation(item.dataset.id, item.querySelector('span').textContent);
    if (window.innerWidth <= 860) closeSidebar();
  });

  async function selectConversation(id, title) {
    if (isWaitingForResponse) return;

    currentConversationId = id;
    conversation = [];
    messagesEl.innerHTML = '';
    emptyState.style.display = 'none';
    conversationTitle.textContent = title;
    hideTyping();

    threadList.querySelectorAll('.thread-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const { data, error } = await supabaseClient
      .from('messages')
      .select('role, content')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to load messages:', error);
      return;
    }

    (data || []).forEach((msg) => {
      conversation.push({ role: msg.role, content: msg.content });
      if (msg.role === 'user') {
        renderUserMessage(msg.content);
      } else {
        renderAIMessage(msg.content);
      }
    });

    scrollToBottom();
  }

  /* ---------------------------------------------------------
     New chat
     --------------------------------------------------------- */
  function startNewChat() {
    currentConversationId = null;
    conversation = [];
    messagesEl.innerHTML = '';
    emptyState.style.display = 'flex';
    conversationTitle.textContent = 'New chat';
    threadList.querySelectorAll('.thread-item').forEach((el) => el.classList.remove('active'));
    hideTyping();
    messageInput.value = '';
    autoResizeTextarea();
    messageInput.focus();
  }

  newChatBtn.addEventListener('click', startNewChat);

  /* ---------------------------------------------------------
     Suggestion cards (empty state)
     --------------------------------------------------------- */
  suggestionCards.forEach((card) => {
    card.addEventListener('click', () => {
      messageInput.value = card.dataset.prompt;
      autoResizeTextarea();
      handleSend();
    });
  });

  /* ---------------------------------------------------------
     Textarea: auto-expand + enter-to-send
     --------------------------------------------------------- */
  function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
    sendBtn.disabled = messageInput.value.trim().length === 0 || isWaitingForResponse;
  }

  messageInput.addEventListener('input', autoResizeTextarea);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSend();
  });

  /* ---------------------------------------------------------
     Sending a message
     --------------------------------------------------------- */
  async function handleSend() {
    const text = messageInput.value.trim();
    if (!text || isWaitingForResponse || !currentUser) return;

    emptyState.style.display = 'none';

    conversation.push({ role: 'user', content: text });
    renderUserMessage(text);

    messageInput.value = '';
    autoResizeTextarea();

    setWaiting(true);
    showTyping();
    scrollToBottom();

    try {
      if (!currentConversationId) {
        currentConversationId = await createConversation(text);
      }

      await insertMessage('user', text);

      // ------------------------------------------------------------------
      // Real API call: the "chat" Edge Function forwards `conversation`
      // to Claude and keeps the API key server-side. See
      // supabase/functions/chat/index.ts.
      // ------------------------------------------------------------------
      const { data, error } = await supabaseClient.functions.invoke('chat', {
        body: { messages: conversation },
      });

      if (error) throw error;
      if (data && data.error) throw new Error(data.error);

      const reply = data.reply;
      conversation.push({ role: 'assistant', content: reply });
      await insertMessage('assistant', reply);

      hideTyping();
      renderAIMessage(reply);
    } catch (err) {
      console.error('Send failed:', err);
      hideTyping();
      renderAIMessage('Something went wrong generating a response. Please try again.');
    } finally {
      setWaiting(false);
      scrollToBottom();
    }
  }

  function setWaiting(waiting) {
    isWaitingForResponse = waiting;
    messageInput.disabled = waiting;
    autoResizeTextarea();
  }

  /* ---------------------------------------------------------
     Persistence helpers
     --------------------------------------------------------- */
  async function createConversation(firstMessage) {
    const title = firstMessage.length > 42 ? firstMessage.slice(0, 42) + '…' : firstMessage;

    const { data, error } = await supabaseClient
      .from('conversations')
      .insert({ user_id: currentUser.id, title })
      .select('id, title, updated_at')
      .single();

    if (error) throw error;

    conversationTitle.textContent = data.title;
    threadListEmpty.style.display = 'none';
    const item = buildThreadItem(data);
    item.classList.add('active');
    threadList.querySelectorAll('.thread-item').forEach((el) => el.classList.remove('active'));
    threadList.insertBefore(item, threadList.firstChild);

    return data.id;
  }

  async function insertMessage(role, content) {
    const { error } = await supabaseClient
      .from('messages')
      .insert({ conversation_id: currentConversationId, role, content });
    if (error) throw error;
  }

  /* ---------------------------------------------------------
     Rendering: user messages
     --------------------------------------------------------- */
  function renderUserMessage(text) {
    const node = userMessageTpl.content.cloneNode(true);
    node.querySelector('.message-content').textContent = text;
    messagesEl.appendChild(node);
  }

  /* ---------------------------------------------------------
     Rendering: AI messages (with markdown + code blocks)
     --------------------------------------------------------- */
  function renderAIMessage(text) {
    const node = aiMessageTpl.content.cloneNode(true);
    const contentEl = node.querySelector('.message-content');
    contentEl.innerHTML = renderMarkdown(text);

    const copyBtn = node.querySelector('.copy-msg-btn');
    copyBtn.addEventListener('click', () => copyToClipboard(text, copyBtn));

    messagesEl.appendChild(node);
    wireCodeCopyButtons(messagesEl.lastElementChild);
    swapLogos(document.documentElement.getAttribute('data-theme'));
  }

  function wireCodeCopyButtons(scopeEl) {
    const root = scopeEl || messagesEl;
    root.querySelectorAll('.copy-code-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const codeEl = btn.closest('.code-block').querySelector('code');
        copyToClipboard(codeEl.textContent, btn);
      });
    });
  }

  function copyToClipboard(text, btn) {
    const done = () => {
      const original = btn.innerHTML;
      const label = btn.querySelector('span');
      btn.classList.add('copied');
      if (label) label.textContent = 'Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = original;
      }, 1400);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* no-op */ }
      document.body.removeChild(ta);
      done();
    }
  }

  /* ---------------------------------------------------------
     Minimal markdown renderer
     Supports: fenced code blocks, inline code, bold, and
     ordered/unordered lists. Escapes HTML first so nothing in
     an API response can inject markup.
     --------------------------------------------------------- */
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(raw) {
    const codeBlocks = [];

    let text = raw.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const index = codeBlocks.length;
      codeBlocks.push({ lang: lang || 'text', code: code.replace(/\n$/, '') });
      return '\u0000CODEBLOCK' + index + '\u0000';
    });

    text = escapeHtml(text);
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const lines = text.split('\n');
    let html = '';
    let listBuffer = [];
    let listType = null;

    function flushList() {
      if (listBuffer.length === 0) return;
      const tag = listType === 'ol' ? 'ol' : 'ul';
      html += '<' + tag + '>' + listBuffer.map((li) => '<li>' + li + '</li>').join('') + '</' + tag + '>';
      listBuffer = [];
      listType = null;
    }

    lines.forEach((line) => {
      const ulMatch = line.match(/^\s*[-*]\s+(.*)/);
      const olMatch = line.match(/^\s*\d+\.\s+(.*)/);

      if (ulMatch) {
        if (listType !== 'ul') flushList();
        listType = 'ul';
        listBuffer.push(ulMatch[1]);
      } else if (olMatch) {
        if (listType !== 'ol') flushList();
        listType = 'ol';
        listBuffer.push(olMatch[1]);
      } else if (line.trim() === '') {
        flushList();
      } else if (line.indexOf('\u0000CODEBLOCK') !== -1) {
        flushList();
        html += line;
      } else {
        flushList();
        html += '<p>' + line + '</p>';
      }
    });
    flushList();

    html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (match, index) => {
      const block = codeBlocks[Number(index)];
      return buildCodeBlockHtml(block.lang, block.code);
    });

    return html;
  }

  function buildCodeBlockHtml(lang, code) {
    const highlighted = highlightCode(code);
    return (
      '<div class="code-block">' +
        '<div class="code-block-header">' +
          '<span>' + escapeHtml(lang) + '</span>' +
          '<button type="button" class="copy-code-btn">' +
            '<svg viewBox="0 0 24 24" width="12" height="12"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>' +
            '<span>Copy</span>' +
          '</button>' +
        '</div>' +
        '<pre><code>' + highlighted + '</code></pre>' +
      '</div>'
    );
  }

  const KEYWORDS = /\b(function|return|const|let|var|if|else|for|while|def|class|import|from|export|default|new|async|await|try|catch|self|True|False|None|null|undefined|true|false)\b/g;

  function highlightCode(code) {
    let escaped = escapeHtml(code);

    escaped = escaped.replace(/(^|\n)([ \t]*)(\/\/.*|#.*)/g, (m, pre, indent, comment) => {
      return pre + indent + '<span class="tok-comment">' + comment + '</span>';
    });

    escaped = escaped.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="tok-string">$1</span>');
    escaped = escaped.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
    escaped = escaped.replace(KEYWORDS, '<span class="tok-keyword">$&</span>');

    return escaped;
  }

  /* ---------------------------------------------------------
     Typing indicator + scroll helpers
     --------------------------------------------------------- */
  function showTyping() {
    typingRow.hidden = false;
    typingRow.dataset.visible = 'true';
  }

  function hideTyping() {
    typingRow.hidden = true;
    typingRow.dataset.visible = 'false';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatScroll.scrollTop = chatScroll.scrollHeight;
    });
  }

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */
  autoResizeTextarea();

  // On a fast page refresh, Supabase can restore the session (and auth.js
  // can fire 'ainex:signed-in') before this script has even finished
  // loading — so the event listener above would miss it. auth.js also
  // stamps window.__ainexAuthUser synchronously the moment it knows the
  // answer, so we check that here as a fallback for anything we missed.
  if (typeof window.__ainexAuthUser !== 'undefined' && window.__ainexAuthUser) {
    currentUser = window.__ainexAuthUser;
    renderAccount(currentUser);
    startNewChat();
    loadThreads();
  }
})();