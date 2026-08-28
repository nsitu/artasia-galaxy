# Import navigation regression fixture

Run `node apps/web/tests/import-navigation.fixture.mjs` from the repository root,
then open `http://127.0.0.1:5187/admin`. This serves the real UI with synthetic
API responses; no requests are forwarded to Google Drive, Immich, or Atlas.
Beta's folder response and Alpha's listings are deliberately delayed.

Browser regression checks:

1. Click Alpha site's **Import \***, wait for `alpha media.jpg`, return to
   **Sites**, and click Beta site's **Import \***. The URL must remain
   `/admin/import?site=202`, the title must remain **Beta site**, and only Beta's
   folder/media should appear after loading. Repeat in the opposite direction.
2. Open Beta, then immediately return to Sites and open Alpha. After Beta's late
   response arrives, the URL, title, folder, and media must still belong to Alpha.
   Also leave Import for Browse while a folder is loading; no late response may
   change the route or restore the Import workspace.
3. After visiting Alpha, click **Import** on **No folder site** and **Import \***
   on **Unavailable folder site**. They must keep `site=303` and `site=404`
   respectively, displaying the Drive chooser rather than Alpha's old folder.
4. From a loaded import page, use the **My Drive** breadcrumb and explicitly open
   the other site's Drive folder. This intentional navigation must still update
   the site URL/title. Open **Week 1**, use **Back** and breadcrumbs, and confirm
   activity matching still works.
5. Reload `/admin/import?site=202&activity=10`. Beta's Week 1 folder must open,
   with **Collage** selected. Check browser history between different site URLs.

The first scenario reproduced the pre-fix bug: Beta's card briefly selected
202, then stale Alpha folder state overwrote the URL with `site=101`.

## Process backfill Tools fixture

Run `node apps/web/tests/process-backfill.fixture.mjs`, then open
`http://127.0.0.1:5188/admin/tools`. All API responses are synthetic.

Check the confirmation and Back buttons, starting, inventory/checking progress,
reload reconnection, completion with issues, and the 100 + 3 result pages. Start
a second run and cancel it; the page should retain partial counts and explain
that completed changes remain. The first run completes after 12 seconds;
subsequent runs remain active until cancelled.
