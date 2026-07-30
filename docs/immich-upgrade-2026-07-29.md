# Immich v3 upgrade — 2026-07-29

Immich on `Wordpress2025` was upgraded successfully from `v2.7.5` to `v3.0.3`, then to `v3.1.0`. The Docker Compose deployment is in `/opt/immich-app`; media is stored in `/mnt/immich/upload` and PostgreSQL data in `/mnt/immich/postgres`.

Post-upgrade checks passed:

- All Compose services were healthy.
- `immich-admin version` reported `v3.1.0`.
- `immich-admin schema-check` reported current migrations and no schema drift.
- The existing PostgreSQL 14/VectorChord 0.4.3 image remained compatible.
- Immich and the Artasia Atlas integration were tested successfully.

## Recovery

A verified pre-upgrade backup was created at:

```text
/var/tmp/immich-backup-20260729T141841Z
```

An encrypted copy was downloaded off the VM and its SHA-256 checksums, encryption, archive contents, database dump, and media archive were verified. The temporary HTTP-accessible WordPress copy should remain deleted. A separate Azure Recovery Services vault backup was also configured; confirm that it has a validated vault recovery point before relying on it.

For a full application recovery:

1. Provision or reset a clean Immich deployment.
2. Decrypt and extract the verified off-VM archive.
3. Restore the backed-up `/mnt/immich/upload` contents.
4. Restore `immich-database.sql.gz` into a fresh PostgreSQL data directory using the credentials and Compose configuration included in the archive.
5. Start the matching backed-up Immich version (`v2.7.5`) and verify the library and schema.
6. Repeat the tested upgrade path to `v3.0.3`, then `v3.1.0`, verifying health and schema after each step.

Do not attempt recovery by simply starting an older container against the migrated v3 database. Prefer an Azure VM restore for whole-VM loss, and the independent archive for application-level or database recovery.
