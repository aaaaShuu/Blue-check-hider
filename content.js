
(function () {
  'use strict';

  const LOG_PREFIX = '[BlueCheckHider]';
  let enabled = true;
  let hiddenCount = 0;
  let hideReplies = true;
  let hideRetweets = true;
  let whitelistedUsers = new Set();

  // ── Cached URL state (updated on navigation, not per-tweet) ────────
  let cachedUrl = location.href;
  let cachedIsStatusPage = false;
  let cachedStatusId = null;
  let cachedProfileUser = null;

  const NON_PROFILE_PATHS = new Set([
    'home', 'explore', 'search', 'notifications', 'messages',
    'settings', 'compose', 'i', 'login', 'signup', 'tos', 'privacy',
  ]);

  function updateUrlCache() {
    cachedUrl = location.href;
    const path = window.location.pathname;

    const statusMatch = path.match(/\/status\/(\d+)/);
    cachedIsStatusPage = !!statusMatch;
    cachedStatusId = statusMatch ? statusMatch[1] : null;

    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0 && !NON_PROFILE_PATHS.has(segments[0].toLowerCase())) {
      cachedProfileUser = segments[0].toLowerCase();
    } else {
      cachedProfileUser = null;
    }
  }

  updateUrlCache();

  // ── Load settings ──────────────────────────────────────────────────
  function loadSettings() {
    chrome.storage.sync.get(
      { enabled: true, hideReplies: true, hideRetweets: true, whitelistedUsers: [] },
      (settings) => {
        enabled = settings.enabled;
        hideReplies = settings.hideReplies;
        hideRetweets = settings.hideRetweets;
        whitelistedUsers = new Set(
          settings.whitelistedUsers.map((u) => u.toLowerCase().replace('@', ''))
        );
        console.log(`${LOG_PREFIX} Settings loaded – enabled=${enabled}, whitelist=${whitelistedUsers.size}`);
        if (enabled) processAll();
        else showAll();
      }
    );
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) enabled = changes.enabled.newValue;
    if (changes.hideReplies) hideReplies = changes.hideReplies.newValue;
    if (changes.hideRetweets) hideRetweets = changes.hideRetweets.newValue;
    if (changes.whitelistedUsers) {
      whitelistedUsers = new Set(
        (changes.whitelistedUsers.newValue || []).map((u) =>
          u.toLowerCase().replace('@', '')
        )
      );
    }
    hiddenCount = 0;
    showAll();
    resetProcessed();
    if (enabled) processAll();
  });

  // ── Selectors ──────────────────────────────────────────────────────
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  // Single combined selector is faster than 3 separate querySelector calls
  const VERIFIED_SELECTOR =
    '[data-testid="icon-verified"], svg[aria-label="Verified account"], svg[aria-label="Verified"]';

  // ── Helpers ────────────────────────────────────────────────────────

  function getTweetArticle(el) {
    return el.closest('[data-testid="cellInnerDiv"]') || el.closest(TWEET_SELECTOR);
  }

  function getUsername(tweetEl) {
    const links = tweetEl.querySelectorAll('a[role="link"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('/') && !href.includes('/status/')) {
        const handle = href.replace('/', '').toLowerCase();
        if (handle && !handle.includes('/')) return handle;
      }
    }
    return null;
  }

  function isVerified(tweetEl) {
    return !!tweetEl.querySelector(VERIFIED_SELECTOR);
  }

  function isRetweet(tweetEl) {
    const cell = tweetEl.closest('[data-testid="cellInnerDiv"]');
    if (!cell) return false;
    return !!cell.querySelector('[data-testid="socialContext"]');
  }

  function isFocalTweet(tweetEl) {
    if (!cachedStatusId) return false;
    const timeLinks = tweetEl.querySelectorAll('a[href*="/status/"] time');
    for (const time of timeLinks) {
      const link = time.closest('a');
      if (link && link.href.includes(cachedStatusId)) return true;
    }
    return false;
  }

  function isReply(tweetEl) {

    if (cachedIsStatusPage) {
      return !isFocalTweet(tweetEl);
    }

    const cell = tweetEl.closest('[data-testid="cellInnerDiv"]');
    const container = cell || tweetEl;

    if (container.querySelector('[data-testid="TextReplyIndicator"]')) return true;

    const spans = container.querySelectorAll('span');
    for (const span of spans) {
      const t = span.textContent;
      if (t.length < 30 && /replying to/i.test(t)) return true;
    }

    return false;
  }

  // ── Core logic ─────────────────────────────────────────────────────

  function processTweet(tweetEl) {
    if (!enabled) return;

    const cell = getTweetArticle(tweetEl);
    if (!cell) return;

    if (cell.dataset.bchProcessed) return;
    cell.dataset.bchProcessed = 'true';

    if (!isVerified(tweetEl)) return;

    const handle = getUsername(tweetEl);

    // Don't hide if we're on this user's profile page
    if (handle && cachedProfileUser && handle === cachedProfileUser) return;

    // Whitelist
    if (handle && whitelistedUsers.has(handle)) return;

    const rt = isRetweet(tweetEl);
    const reply = isReply(tweetEl);

    if (rt && !hideRetweets) return;
    // "Hide replies" toggle only applies on status/thread pages
    if (reply && !hideReplies && cachedIsStatusPage) return;

    cell.classList.add('bch-hidden');
    hiddenCount++;
    updateBadge();
  }

  function processAll() {
    document.querySelectorAll(TWEET_SELECTOR).forEach(processTweet);
  }

  function showAll() {
    document.querySelectorAll('.bch-hidden').forEach((el) => {
      el.classList.remove('bch-hidden');
    });
  }

  function resetProcessed() {
    document.querySelectorAll('[data-bch-processed]').forEach((el) => {
      delete el.dataset.bchProcessed;
    });
  }

  function updateBadge() {
    try {
      chrome.runtime.sendMessage({ type: 'BCH_COUNT', count: hiddenCount });
    } catch (_) {}
  }


  let pendingNodes = [];
  let rafId = null;

  function flushPending() {
    rafId = null;

    // Check for SPA navigation
    if (location.href !== cachedUrl) {
      updateUrlCache();
      console.log(`${LOG_PREFIX} URL changed → ${cachedUrl}, reprocessing...`);
      hiddenCount = 0;
      showAll();
      resetProcessed();
      if (enabled) processAll();
      pendingNodes = [];
      return;
    }

    if (!enabled || pendingNodes.length === 0) {
      pendingNodes = [];
      return;
    }

    for (const node of pendingNodes) {
      if (node.matches?.(TWEET_SELECTOR)) {
        processTweet(node);
      }
      node.querySelectorAll?.(TWEET_SELECTOR)?.forEach(processTweet);
    }
    pendingNodes = [];
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) pendingNodes.push(node);
      }
    }
    if (!rafId) {
      rafId = requestAnimationFrame(flushPending);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ── Listen for messages from popup ─────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'BCH_GET_COUNT') {
      sendResponse({ count: hiddenCount });
    }
    if (msg.type === 'BCH_REPROCESS') {
      hiddenCount = 0;
      showAll();
      resetProcessed();
      processAll();
      sendResponse({ count: hiddenCount });
    }
  });

  // ── Init ───────────────────────────────────────────────────────────
  loadSettings();
  console.log(`${LOG_PREFIX} Content script loaded.`);
})();
