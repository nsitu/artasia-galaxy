# Atlas Naming Migration Plan
Recently we began using atlas.artsforall.co instead of galaxy.artsforall.co, and this migration is largely complete, but there may be some opportunity remaining to rename internal identifiers to avoid confusion. 


## Objective
Internal code and infrastructure naming to reflect atlas instead of galaxy


## Internal Code and Infrastructure Naming

### Goal

Remove legacy Galaxy terminology from internal code and infrastructure without disrupting deployment, stored data, or Immich deduplication.
 

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

The consistent user-facing form will be  `Artasia Atlas` 

### Internal Immich Identifiers

Decide whether the legacy `artasia-galaxy` Immich identifiers will:

- Remain permanent compatibility identifiers; or
- Be migrated through dual legacy/new identifier support.

Recommendation: retain them unless a concrete operational need justifies the migration risk.
