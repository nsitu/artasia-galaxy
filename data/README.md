# Runtime Data

This directory is mounted into the production container at:

```text
/data
```

It is used for non-secret JSON configuration and runtime JSON state.

Upload tags, uploader names, and placement data are no longer stored here — they are managed in WordPress via the `wp-artasia-locations` plugin and fetched at runtime through the REST API (`/wp-json/wp/v2/artasia_upload_tag`, `/wp-json/artasia/v1/uploaders`, and `/wp-json/artasia/v1/placements` respectively). Legacy `upload-tags.json` and `uploaders.json` files are ignored by the server if present; safe to remove.

The production data directory is bind-mounted into the container as `/data`.

Runtime-generated settings files such as `settings.playback.json` and `settings.display.json` may also appear here on the VM.

Do not store secrets here. Secrets belong in `/opt/artasia-galaxy/.env` on the VM.
