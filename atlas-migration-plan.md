# Atlas Migration Plan

## Objective

Migrate the Artasia Galaxy application from:

```text
https://galaxy.artsforall.co
```

to:

```text
https://atlas.artsforall.co
```

The migration will be divided into three phases:

1. Architecture and hostname migration
2. User-facing branding
3. Internal code and infrastructure naming

The application, container, and production data do not need to move during the first phase. Atlas can initially point to the existing application on the existing VM.

## Current State

The repository and production VM were inspected on July 30, 2026.

- Both `atlas.artsforall.co` and `galaxy.artsforall.co` resolve to `4.205.176.209`.
- `galaxy.artsforall.co` is healthy and returns HTTP 200.
- At initial inspection, `atlas.artsforall.co` failed TLS hostname validation; the Atlas certificate and nginx server block have since been installed.
- nginx now has active HTTPS server blocks for both `atlas.artsforall.co` and `galaxy.artsforall.co`.
- The application runs from `/opt/artasia-galaxy`.
- Docker exposes the application only on `127.0.0.1:3000`.
- nginx proxies public Galaxy traffic to `http://127.0.0.1:3000`.
- The production Google OAuth redirect still points to Galaxy.
- The WordPress plugin contains hard-coded Galaxy API and viewer URLs.
- Authentication cookies are host-only, so existing Galaxy sessions will not transfer to Atlas.
- Internal `artasia-galaxy` identifiers are used for Immich uploads and deduplication.

The existing nginx configuration is located at:

```text
/opt/bitnami/nginx/conf/server_blocks/galaxy-https-server-block.conf
```

The production application configuration is located under:

```text
/opt/artasia-galaxy/
```

## Migration Principles

- Introduce Atlas alongside Galaxy before redirecting or retiring Galaxy.
- Keep architecture changes separate from visual branding changes.
- Keep branding changes separate from internal identifier changes.
- Avoid renaming persistent identifiers unless there is a clear operational benefit.
- Preserve a quick rollback path throughout Phase 1.
- Do not change `SESSION_SECRET` during the hostname migration.
- Do not use an unqualified global replacement of the word `Galaxy`.

## Phase 1: Architecture and Hostname

### Goal

Make `atlas.artsforall.co` the canonical production hostname while preserving compatibility with `galaxy.artsforall.co`.

### 1. Prepare Rollback Information

Before changing production:

- Back up the current nginx server block.
- Record the currently deployed Docker image.
- Record the current Compose and container state.
- Confirm the application health endpoint returns HTTP 200.
- Preserve the current `/opt/artasia-galaxy/.env`.
- Do not expose environment secrets in logs or migration notes.

Useful checks:

```bash
cd /opt/artasia-galaxy
sudo docker compose ps
sudo docker compose logs --tail=100 artasia
curl -fsS http://127.0.0.1:3000/api/v1/health
```

### 2. Issue an Atlas TLS Certificate

Issue a certificate that covers:

```text
atlas.artsforall.co
```

The preferred result is one certificate whose Subject Alternative Names cover both:

```text
atlas.artsforall.co
galaxy.artsforall.co
```

Certificate issuance must be completed before Atlas is presented as ready for use.

Validate the certificate from outside the VM without disabling certificate verification.

### 3. Add the Atlas nginx Server Block

Add an Atlas HTTPS server block following the existing Galaxy proxy configuration.

It should:

- Listen on port 443 with TLS.
- Use `server_name atlas.artsforall.co`.
- Proxy requests to `http://127.0.0.1:3000`.
- Forward the original host and client IP headers.
- Set `X-Forwarded-Proto` to `https`.
- Preserve WebSocket upgrade behavior.
- Preserve request paths and query strings.

Test nginx before reloading:

```bash
sudo /opt/bitnami/nginx/sbin/nginx -t
```

During initial validation, both Atlas and Galaxy should serve the application.

Rollback consists of restoring the previous nginx configuration and reloading nginx.

### 4. Configure Google OAuth

Add the following authorized redirect URI to the existing Google OAuth client:

```text
https://atlas.artsforall.co/api/v1/auth/google/callback
```

Do this before changing the production environment.

After the Atlas callback is registered and Atlas HTTPS works, update the VM setting:

```dotenv
GOOGLE_REDIRECT_URI=https://atlas.artsforall.co/api/v1/auth/google/callback
```

Restart the application container and test the complete sign-in flow.

The required ordering is:

1. Register the Atlas callback with Google.
2. Configure and validate Atlas HTTPS.
3. Change `GOOGLE_REDIRECT_URI`.
4. Restart the application.
5. Complete an Atlas sign-in test.
6. Make Atlas canonical.

Do not change `SESSION_SECRET`. Changing it would invalidate all current sessions in addition to the unavoidable hostname-specific session change.

Because the application uses host-only cookies, users will need to authenticate once on Atlas. Broadening cookies to `.artsforall.co` is not recommended because that would expose them to unrelated subdomains.

### 5. Update WordPress Integration URLs

The WordPress plugin contains functional Galaxy URLs in:

```text
apps/wp-artasia-locations/includes/import.php
apps/wp-artasia-locations/includes/shortcodes-sites.php
```

The affected behavior includes:

- The reconciliation endpoint
- The gallery-availability endpoint
- Placement gallery links

Introduce a single configurable Atlas base URL rather than replacing several literals independently. For example:

```php
artasia_atlas_base_url()
```

It should default to:

```text
https://atlas.artsforall.co
```

It should support a WordPress filter or configuration option so a future hostname change does not require several code changes.

Deploy the updated plugin before making Galaxy redirect-only.

Validate:

- Gallery availability checks
- Placement gallery links
- Manual reconciliation
- Scheduled reconciliation, if enabled

### 6. Update Repository Configuration and Operations Documentation

Update hostname-bearing architecture references in:

- `.env.example`
- Current deployment documentation
- Health-check instructions
- Operational runbooks
- WordPress integration documentation

Keep the following unchanged during Phase 1:

- `/opt/artasia-galaxy`
- `ghcr.io/nsitu/artasia-galaxy`
- Docker Compose project and container names
- npm package names
- GitHub repository name
- Immich device and device-asset identifiers

### 7. Make Atlas Canonical

After Atlas passes end-to-end testing:

- Update user-facing links to use Atlas.
- Update operational bookmarks and documentation.
- Announce Atlas as the canonical hostname.
- Monitor both hostnames before adding a redirect.

### 8. Redirect Legacy Galaxy Traffic

The recommended long-term behavior is to preserve `galaxy.artsforall.co` as an indefinite redirect to Atlas.

For browser traffic, use a permanent redirect that preserves paths and query strings:

```text
https://galaxy.artsforall.co/sites/example?view=1
```

should become:

```text
https://atlas.artsforall.co/sites/example?view=1
```

HTTP 308 is preferable because it preserves the request method.

API traffic needs additional care. Before redirecting `/api/`:

- Confirm all WordPress integrations have been migrated.
- Confirm no external scripts still call Galaxy.
- Confirm POST clients correctly follow 307 or 308 redirects.

A safe transitional configuration is:

- Redirect normal browser routes from Galaxy to Atlas.
- Continue proxying Galaxy `/api/` requests temporarily.
- Monitor Galaxy API traffic.
- Redirect or retire the compatibility proxy only after traffic has stopped.

### Phase 1 Acceptance Criteria

- Atlas resolves to the production VM.
- The Atlas certificate validates publicly.
- Atlas `/` loads correctly.
- Atlas `/admin` loads correctly.
- Atlas `/sites/<slug>` loads correctly.
- Static assets load without errors.
- API routes work on Atlas.
- Google sign-in completes on Atlas.
- Uploads continue to work.
- Google Drive imports continue to work.
- WordPress gallery links open Atlas.
- WordPress gallery-availability checks succeed.
- Manual and scheduled reconciliation calls succeed.
- Browser consoles show no mixed-content or origin errors.
- Galaxy redirects preserve paths and query strings.
- Remaining Galaxy API callers are migrated or supported by the temporary proxy.
- Application health and logs remain clean.

### Phase 1 Observation Period

Keep both hostnames operational for at least one normal operating cycle, approximately one to two weeks, before tightening the Galaxy compatibility behavior.

Monitor:

- nginx access and error logs
- Requests using the Galaxy hostname
- Google OAuth errors
- WordPress API errors
- Application health
- Upload and reconciliation failures

## Phase 2: User-Facing Branding

### Goal

Rename the product in all user-visible and administrator-visible locations without changing internal identifiers.

### Scope

Likely changes include:

- HTML document title
- Viewer headings
- Admin headings
- Upload-panel help text
- Accessibility and ARIA labels
- WordPress labels and descriptions
- Staff-visible error and status messages
- Current product documentation
- Screenshots
- Metadata and social previews
- Favicon or logo treatment, if required

Examples include changing:

```text
Artasia Galaxy
Galaxy Viewer
```

to the agreed Atlas terminology.

### Branding Decision

Confirm the official user-facing name before Phase 2:

- `Atlas`
- `Artasia Atlas`

Apply the chosen form consistently.

### Historical Documentation

Historical plans and architecture documents do not require blind replacement.

Choose one of:

- Leave historical references unchanged.
- Add a note explaining that Galaxy was renamed Atlas.
- Update only documents that describe the current system.

### Phase 2 Validation

- Inspect the viewer visually.
- Inspect the admin and upload workflows.
- Inspect WordPress screens.
- Test mobile layouts.
- Check browser titles.
- Check accessibility labels.
- Search for remaining user-visible Galaxy terminology.
- Confirm no internal identifiers changed as part of the branding work.

## Phase 3: Internal Code and Infrastructure Naming

### Goal

Remove legacy Galaxy terminology from internal code and infrastructure without disrupting deployment, stored data, or Immich deduplication.

Phase 3 should be divided into small, independently deployable changes.

### 1. Low-Risk Internal Naming

Rename:

- Comments
- Local variables
- Type names
- Test descriptions
- Package metadata
- Current documentation terminology
- Config helper names introduced during Phase 1

Each group should pass the existing build, lint, type-check, and test commands before deployment.

### 2. Deployment Identity

Potential changes include:

- `/opt/artasia-galaxy` to `/opt/artasia-atlas`
- Docker Compose project identity
- Container names
- Deployment workflow temporary directories
- GitHub repository name
- GHCR image/package name
- Root npm package name

These should not be changed together without a migration and rollback procedure.

Renaming the GitHub repository affects:

```yaml
IMAGE_NAME: ghcr.io/${{ github.repository }}
```

That changes the generated GHCR image location. Coordinate:

- Repository rename
- GHCR package availability
- VM `ARTASIA_IMAGE`
- Deployment workflow paths
- GitHub Actions secrets
- Branch protections
- Documentation
- Rollback image availability

The current workflow retains only one GHCR image version. Increase rollback retention before changing repository or image identity.

### 3. VM Directory Migration

If `/opt/artasia-galaxy` is renamed:

- Stop or carefully coordinate the deployment workflow.
- Back up `.env`.
- Preserve the bind-mounted `data/` directory and ownership.
- Update every deployment workflow path.
- Explicitly set or account for the Compose project name.
- Validate that only one production container is running.
- Confirm the new deployment points at the existing data.
- Keep the old directory available until the new deployment is verified.

Do not allow both old and new Compose projects to start competing application containers.

### 4. Immich Persistent Identifiers

The application currently uses identifiers including:

```text
artasia-galaxy
artasia-galaxy:<checksum>
artasia-galaxy:drive:<file-id>
```

These are used as Immich `deviceId` and `deviceAssetId` values.

Changing them can:

- Break upload deduplication
- Make an existing file appear to be a new upload
- Create duplicates
- Complicate tracing existing assets to their original import source

Recommended approach:

- Keep these values permanently as legacy protocol identifiers unless renaming provides a concrete operational benefit.

If they must change:

1. Teach the application to recognize both legacy Galaxy and new Atlas identifiers.
2. Continue checking legacy identifiers during deduplication.
3. Decide when new uploads begin emitting Atlas identifiers.
4. Test normal uploads and Google Drive imports against previously imported files.
5. Document the compatibility behavior.

Do not perform a simple string replacement on these identifiers.

### 5. Cookie Names

Current cookie names use the neutral `artasia_` prefix and do not need to change:

```text
artasia_auth
artasia_oauth
```

Keeping them avoids unnecessary session behavior changes.

### Phase 3 Validation

- Builds, type checks, and tests pass.
- The deployment workflow publishes the expected image.
- The VM pulls the expected image.
- Only one production application stack is active.
- Runtime data is preserved.
- OAuth continues to work.
- Upload deduplication still works.
- Google Drive re-imports do not produce duplicates.
- Rollback to the previous image and deployment path is documented and tested.

## Recommended Rollout Sequence

1. Back up nginx configuration and record the current application state.
2. Issue a certificate covering Atlas.
3. Add the Atlas nginx proxy alongside Galaxy.
4. Validate public Atlas HTTPS and application behavior.
5. Add the Atlas callback to Google OAuth.
6. Update the WordPress integration to use a configurable Atlas base URL.
7. Change the production OAuth redirect to Atlas.
8. Restart the application and validate end-to-end behavior.
9. Announce Atlas and make it canonical.
10. Redirect legacy Galaxy browser traffic.
11. Temporarily preserve Galaxy API compatibility while monitoring callers.
12. Complete Phase 2 user-facing branding.
13. Observe logs and old-host traffic.
14. Complete Phase 3 through separate, controlled internal migrations.

## Open Decisions

### Legacy Hostname Lifetime

Decide whether `galaxy.artsforall.co` will:

- Redirect indefinitely; or
- Be retired after a defined compatibility period.

Recommendation: retain an indefinite redirect because old bookmarks, documentation, and external links may persist.

### Official Product Name

Choose the consistent user-facing form:

- `Atlas`
- `Artasia Atlas`

### Historical Documentation

Decide whether old plans should:

- Remain historically accurate
- Receive a rename notice
- Be updated to current terminology

### Internal Immich Identifiers

Decide whether the legacy `artasia-galaxy` Immich identifiers will:

- Remain permanent compatibility identifiers; or
- Be migrated through dual legacy/new identifier support.

Recommendation: retain them unless a concrete operational need justifies the migration risk.

## Phase 1 Implementation Status

Phase 1 initial cutover was applied on July 30, 2026.

Completed:

- Created a VM backup at `/root/atlas-migration-backup-20260730` containing nginx configuration, certificate files, renewal configuration, the application environment, and the WordPress plugin.
- Issued a new Let's Encrypt certificate covering `atlas.artsforall.co`, `galaxy.artsforall.co`, `photos.artsforall.co`, `audio.artsforall.co`, `www.artsforall.co`, and `artsforall.co`.
- Added `atlas.artsforall.co` to the Bitnami LEGO renewal script.
- Added `/opt/bitnami/nginx/conf/server_blocks/atlas-https-server-block.conf`.
- Kept the Galaxy nginx server block active for compatibility.
- Updated the production `GOOGLE_REDIRECT_URI` to the Atlas callback.
- Updated the WordPress plugin’s default reconcile, availability, and gallery URLs to Atlas.
- Added a filterable `artasia_atlas_base_url()` helper to the WordPress plugin.
- Updated `.env.example` and current deployment documentation to use Atlas.
- Verified Atlas and Galaxy HTTPS responses, Atlas API availability, OAuth redirect generation, application health, and WordPress PHP syntax.

Still pending:

- Observe legacy Galaxy traffic for one to two weeks.
- Decide whether and when to make Galaxy browser routes redirect permanently to Atlas.
- Migrate or verify any remaining external API callers before redirecting Galaxy API requests.
- Phase 2 user-facing branding.
- Phase 3 internal code and infrastructure naming.
