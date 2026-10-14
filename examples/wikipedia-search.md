# Parity report: Article search

| | Android | iOS |
|---|---|---|
| Summary | Search runs in SearchActivity, which hosts SearchFragment. That fragment switches between a recent-searches panel (RecentSearchesFragment) and a Compose results panel (SearchResultsFragment and SearchResultsScreen). Results come from a Paging 3 flow, debounced by 200 ms, that fetches a prefix search plus a full-text fallback from the MediaWiki API. The prefix page can also be prepended with one match each from open tabs, history and reading lists. Recent searches are stored in Room. I did not inspect the analytics wiring beyond the Test Kitchen events, the voice-search launcher, or the main-screen search bar. | iOS search is a UISearchController in SearchViewController. Its results controller, SearchResultsViewController, switches between a recent-searches list and a SwiftUI results list. Typing triggers a 100 ms delayed async search. Each search is a prefix search (generator=prefixsearch, limit 24), followed by a full-text search when the prefix search returns fewer than 12 results. Recent searches are stored in a plist-backed MWKRecentSearchList, saved only when a result is tapped. Entry points: the search tab, the article toolbar, widgets via a wikipedia://search deep link, and NSUserActivity. I did not read the language bar controller, the results view model's highlighting and image loading, or the recent-search entry and plist storage details. |

## Summary

| Category | Count |
|---|---|
| 🔴 Behavior differences | 11 |
| 🟠 Possible bugs or gaps | 1 |
| 🟣 Only on one platform | 4 |
| 🟡 UI differences | 1 |
| ✅ Same on both platforms | 3 |

## 🔴 Behavior differences

| # | Severity | Finding | Android | iOS |
|---|---|---|---|---|
| 1 | high | Android pages results (10 per page); iOS shows a single page of up to 24 | Paging 3 with batch size 10; continuation via gsroffset loads more results on scroll. (`app/src/main/java/org/wikipedia/search/SearchResultsViewModel.kt:29`, `app/src/main/java/org/wikipedia/search/StandardSearchRepository.kt:59`) | No paging; offset always 0 and at most 24 results shown. (`Wikipedia/Code/WMFSearchFetcher.m:89`, `Wikipedia/Code/WMFSearchFetcher.m:8`) |
| 2 | medium | Full-text fallback threshold differs (batch size 10 vs 12) | Full-text search runs when prefix plus local results are fewer than the batch size (10); it is also used for paging. (`app/src/main/java/org/wikipedia/search/StandardSearchRepository.kt:54`) | Full-text search runs when prefix results are fewer than 12, with limit 24, and is merged into the prefix results. (`Wikipedia/Code/SearchResultsLoader.swift:9`) |
| 3 | medium | Debounce differs: 200 ms vs 100 ms | Search term debounced 200 ms. (`app/src/main/java/org/wikipedia/search/SearchResultsViewModel.kt:30`) | 100 ms delay after each text change. (`Wikipedia/Code/SearchResultsViewController.swift:522`) |
| 4 | medium | Query trimming: Android trims, iOS sends the term as typed | Query is trimmed on every text change. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:73`) | Whitespace-only is treated as empty, but the term is not trimmed otherwise. (`Wikipedia/Code/SearchResultsViewController.swift:508`) |
| 5 | medium | Recent searches saved at different times | Saved when search closes (result opened), and also when the close button is pressed before clearing. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:288`) | Saved only on result tap or semantic entry tap. (`Wikipedia/Code/SearchResultsViewController.swift:387`) |
| 6 | medium | Language selection UI and persistence differ | Language tabs with 2+ languages, else a language button; selected tab persisted in Prefs. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:169`) | Language bar only if config and user setting are on; language bar controller not read, so persistence is unknown. (`Wikipedia/Code/SearchResultsViewController.swift:260`) |
| 7 | medium | Long-press menu and swipe actions on results differ | Long press shows LongPressMenu; save opens SaveArticleSheetDialog; no swipe actions described. (`app/src/main/java/org/wikipedia/search/SearchResultsFragment.kt:82`) | Context menu with open, new/background tab, save, view on map and share, plus trailing swipe Share/Save. (`WMFComponents/Sources/WMFComponents/Components/Search/Results/WMFSearchResultRow.swift:62`) |
| 8 | low | Idle state: Android shows namespace chips and add-language button; iOS shows history behind search | Recent list with delete-all, namespace chips (User, Portal, Help, Project, Template) and empty message. (`app/src/main/java/org/wikipedia/search/RecentSearchesFragment.kt:43`) | Recent list with Clear and empty message; history list is the background when inactive with a Clear history button. (`Wikipedia/Code/SearchResultsViewController.swift:530`) |
| 9 | low | Search entry points are platform-specific; Android also handles share and process-text intents | Share and text-selection intents prefill the query; widget launches search. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:157`) | Widgets use a deep link; NSUserActivity restores search and Handoff. (`Wikipedia/Code/WMFAppViewController.swift:1341`) |
| 10 | low | Android delays intent-started searches by 500 ms; iOS has no equivalent | PLACES, VOICE and share/process-text sources start search after 500 ms. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:366`) | Prefilled term searches on appear unless returning from an article. (`Wikipedia/Code/SearchViewController.swift:425`) |
| 11 | low | Submit/keyboard behavior: Android submit only hides keyboard; iOS never dismisses keyboard on scroll | Submit hides the keyboard without a new search. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:67`) | Scrolling never dismisses the keyboard. (`WMFComponents/Sources/WMFComponents/Components/Search/Results/WMFSearchResultsView.swift:68`) |

## 🟠 Possible bugs or gaps

| # | Severity | Finding | Android | iOS |
|---|---|---|---|---|
| 1 | high | iOS has no retry button and no loading indicator; Android has both | Progress bar while loading; WikiErrorView with retry and back buttons on error. (`app/src/main/java/org/wikipedia/search/SearchResultsScreen.kt:81`) | Network error shows a no-internet empty state with no retry; no explicit loading indicator found. (`WMFComponents/Sources/WMFComponents/Components/Search/Results/WMFSearchResultsView.swift:38`) |

## 🟣 Only on one platform

| # | Severity | Finding | Android | iOS |
|---|---|---|---|---|
| 1 | high | Local matches (open tabs, history, reading lists) only on Android | On the first page, up to one match each from tabs, history and reading lists is prepended (term of 2+ characters, not PLACES), with a type icon. (`app/src/main/java/org/wikipedia/search/StandardSearchRepository.kt:42`) | — |
| 2 | medium | Per-language result counts when empty are Android-only | With no results, other app languages are queried and a tappable per-language count list is shown. (`app/src/main/java/org/wikipedia/search/StandardSearchRepository.kt:63`) | Just a 'No results found' empty view. (`Wikipedia/Code/SearchResultsViewController+ResultsList.swift:12`) |
| 3 | medium | Semantic search entry point exists only on iOS | Optional cirrusSemanticSearch parameter exists but is not passed; SemanticSearchService use not traced. (`app/src/main/java/org/wikipedia/dataclient/Service.kt:88`) | Experiment-gated semantic search entry above results opens a semantic sheet. (`Wikipedia/Code/SearchResultsViewController+ResultsList.swift:115`) |
| 4 | medium | Return-link mode and Places-restricted search only on Android | Return-link mode returns the title to the caller; PLACES source filters to results with coordinates and changes the hint. (`app/src/main/java/org/wikipedia/search/SearchFragment.kt:218`) | The edit link screen pushes search with source unknown; no equivalent return or Places mode described. (`Wikipedia/Code/EditLinkViewController.swift:162`) |

## 🟡 UI differences

| # | Severity | Finding | Android | iOS |
|---|---|---|---|---|
| 1 | medium | Result row: thumbnail size, request width and line limits differ | 56dp thumbnail, 8dp radius, 330px requested; subtitle up to 2 lines at 14sp; title has no line limit; 16dp padding. (`app/src/main/java/org/wikipedia/search/SearchResultsScreen.kt:283`) | 40x40 thumbnail at trailing edge, 3pt radius, 120px requested; title and description limited to one line. (`WMFComponents/Sources/WMFComponents/Components/Search/Results/WMFSearchResultRow.swift:168`) |

## ✅ Same on both platforms

| # | Severity | Finding | Android | iOS |
|---|---|---|---|---|
| 1 | info | Recent searches: dedupe to front, swipe delete, confirm clear-all, no max count found | Replace on conflict, ordered by timestamp desc, swipe delete, clear-all with confirmation. (`app/src/main/java/org/wikipedia/search/db/RecentSearchDao.kt:14`) | Remove existing and insert at index 0, swipe delete, clear-all with alert. (`Wikipedia/Code/MWKRecentSearchList.m:50`) |
| 2 | info | Both use prefix search in namespace 0 plus full-text fallback, cancel in-flight requests, and have no offline cache | generator=prefixsearch ns 0; flatMapLatest cancels previous search. (`app/src/main/java/org/wikipedia/search/SearchResultsViewModel.kt:58`) | generator=prefixsearch ns 0; new search cancels previous fetches. (`Wikipedia/Code/SearchResultsViewController.swift:367`) |
| 3 | info | Duplicate searches suppressed and RTL layout follows search language on both | Skips if term and language unchanged; RTL layout direction by language. (`app/src/main/java/org/wikipedia/search/SearchResultsFragment.kt:116`) | Skips if text and site URL unchanged; RTL via view model flag. (`Wikipedia/Code/SearchResultsViewController.swift:511`) |

## Questions for the team

1. Is the lack of load-more on iOS intentional?
2. Should iOS trim leading/trailing whitespace before searching?
3. Should Android save the query when the user presses the close button?
4. Is semantic search planned for Android?
5. How does iOS return a selected title in the edit-link flow?

## How this was checked

- **Android:** 69 of 69 items verified against the source
- **iOS:** 71 of 71 items verified against the source
- **Findings:** 41 of 41 source references verified
- **Looked for but not found:** Android: Maximum count for recent searches (no limit found in the DAO or fragment); Android: Explicit max query length; Android: Explicit request timeout or retry policy specific to search; Android: Voice search launcher code (not inspected); Android: SemanticSearchService usage (file not read); Android: Long-press menu contents (LongPressMenu not read); iOS: Maximum number of recent search entries (no limit found in MWKRecentSearchList or MWKList); iOS: Explicit request timeout or retry for search; iOS: Explicit loading indicator during search; iOS: Retry button on error state; iOS: Text highlighting of the query inside result titles (not confirmed; the view model was not read); iOS: Use of the 'did you mean' suggestion in the UI; iOS: Paging or load-more of results
- **Model:** `claude-sonnet-5-5` via Claude Code · **Tokens:** 603,543 in, 49,304 out · **Plan usage:** 5-hour window OK, resets 2026-10-14 10:40 UTC
- **Generated:** 2026-10-14 05:57 UTC by driftcheck
