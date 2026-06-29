# Runtime Data

This directory is mounted into the production container at:

```text
/data
```

It is used for non-secret JSON configuration and runtime JSON state.

The committed JSON files are examples only:

- `uploaders.json`: example uploader dropdown options (production values live on the VM).

Upload tags and placement data are no longer stored here — they are managed in WordPress via the `wp-artasia-locations` plugin and fetched at runtime through the REST API (`/wp-json/wp/v2/artasia_upload_tag` and `/wp-json/artasia/v1/placements` respectively). The legacy `upload-tags.json` is ignored by the server if present; safe to remove.

Production values should be copied manually to `/opt/artasia-galaxy/data/` on the VM. The production data directory is bind-mounted into the container as `/data`.

Runtime-generated settings files such as `settings.playback.json` and `settings.display.json` may also appear here on the VM.

Do not store secrets here. Secrets belong in `/opt/artasia-galaxy/.env` on the VM.
