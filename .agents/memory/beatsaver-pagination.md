---
name: BeatSaver search pagination
description: BeatSaver search result counts and page counts can disagree when requesting a larger page size.
---

When requesting BeatSaver search results with `pageSize=100`, `info.total` can report the true result count while `info.pages` still reflects the default page size. For example, `total=156` and `pages=8` requires only two requests at 100 results per page.

**Why:** Trusting `info.pages` would over-fetch and make artist scans slower; ignoring pagination would omit maps.

**How to apply:** Derive the page count from `ceil(info.total / requestedPageSize)` and stop when the final page is shorter than the requested size.
