/**
 * Blue Check Hider - Popup Script
 */

const $enabled = document.getElementById('enabled');
const $hideReplies = document.getElementById('hideReplies');
const $hideRetweets = document.getElementById('hideRetweets');
const $count = document.getElementById('count');
const $whitelistInput = document.getElementById('whitelistInput');
const $addBtn = document.getElementById('addBtn');
const $whitelistTags = document.getElementById('whitelistTags');
const $emptyMsg = document.getElementById('emptyMsg');

let whitelistedUsers = [];

// ── Load stored settings ─────────────────────────────────────────────
chrome.storage.sync.get(
  {
    enabled: true,
    hideReplies: true,
    hideRetweets: true,
    whitelistedUsers: [],
  },
  (s) => {
    $enabled.checked = s.enabled;
    $hideReplies.checked = s.hideReplies;
    $hideRetweets.checked = s.hideRetweets;
    whitelistedUsers = s.whitelistedUsers || [];
    renderTags();
  }
);

// ── Get hidden count from content script ─────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: 'BCH_GET_COUNT' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.count != null) $count.textContent = res.count;
  });
});

// Live count updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BCH_COUNT') {
    $count.textContent = msg.count;
  }
});

// ── Persist a setting ────────────────────────────────────────────────
function save(key, value) {
  chrome.storage.sync.set({ [key]: value });
}

function reprocessTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'BCH_REPROCESS' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res?.count != null) $count.textContent = res.count;
    });
  });
}

// ── Toggle listeners ─────────────────────────────────────────────────
$enabled.addEventListener('change', () => {
  save('enabled', $enabled.checked);
  reprocessTab();
});

$hideReplies.addEventListener('change', () => {
  save('hideReplies', $hideReplies.checked);
  reprocessTab();
});

$hideRetweets.addEventListener('change', () => {
  save('hideRetweets', $hideRetweets.checked);
  reprocessTab();
});

// ── Whitelist management ─────────────────────────────────────────────
function renderTags() {
  $whitelistTags.innerHTML = '';
  if (whitelistedUsers.length === 0) {
    const em = document.createElement('span');
    em.className = 'empty-msg';
    em.textContent = 'No accounts whitelisted';
    $whitelistTags.appendChild(em);
    return;
  }
  whitelistedUsers.forEach((user) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `@${user} <span class="remove" data-user="${user}">&times;</span>`;
    $whitelistTags.appendChild(tag);
  });
}

function addUser() {
  let handle = $whitelistInput.value.trim().toLowerCase().replace('@', '');
  if (!handle) return;
  if (whitelistedUsers.includes(handle)) {
    $whitelistInput.value = '';
    return;
  }
  whitelistedUsers.push(handle);
  save('whitelistedUsers', whitelistedUsers);
  renderTags();
  $whitelistInput.value = '';
  reprocessTab();
}

$addBtn.addEventListener('click', addUser);
$whitelistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addUser();
});

$whitelistTags.addEventListener('click', (e) => {
  const user = e.target.dataset?.user;
  if (!user) return;
  whitelistedUsers = whitelistedUsers.filter((u) => u !== user);
  save('whitelistedUsers', whitelistedUsers);
  renderTags();
  reprocessTab();
});
