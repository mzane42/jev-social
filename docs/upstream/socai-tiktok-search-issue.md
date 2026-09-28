<!-- Draft issue for socai-io/socai. Not posted yet (2026-09-28). -->

# `tiktok search` returns `search_navigation_timeout` with 0 cards on TikTok's sidebar search layout (0.6.1)

**Version:** socai 0.6.1 (macOS, managed Chrome profile, logged in)

**Command:** `socai tiktok search "football ai" --num 12 --pretty`

**Result:** `ok: false`, `reason: "search_navigation_timeout"`, `cards: []` after the full wait.

**Observed state:** `url: https://www.tiktok.com/search?q=football%20ai`,
`title: "Trouve 'football ai' sur TikTok | Recherche TikTok"`, `card_count: 3`,
`login_required: false`, `query_visible: false`, `visible_query: ""`.

**What's on screen:** the results page is fully rendered (a `--debug-snapshot`
screenshot shows the Top tab with video cards, and the DOM contains all the
`/@handle/video/id` links). TikTok now puts the search box in the left sidebar:
`<input data-e2e="search-user-input" name="q" type="search">`. `searchState()` in
`core/src/sites/tiktok/page_scripts.js` reads `searchInput.value`, which is empty,
so `query_visible` never becomes true and `search_transition_ok` waits until the
timeout.

**Suggested fix:** also accept the `q` URL parameter as proof of the query, as
`dy/page_scripts.js` already does (`decodeURIComponent(location.href).includes(query)`).

**Expected:** cards returned when the results URL matches the query and result
cards are present, even if the input value cannot be read.

Also seen on the same version: `instagram search_accounts` returns
`search_control_not_found` on an authenticated home page.

**Patch:** https://github.com/mzane42/socai/tree/fix/tiktok-sidebar-search (commit 551fc8f), verified live: 8 cards, no timeout.
