# Runtime Data

This directory is mounted into the production container at:

```text
/data
```

It is used for non-secret JSON configuration and runtime JSON state.

The committed JSON files are examples only:

- `locations.json`: example partner/site options.
- `upload-tags.json`: example upload tags.
- `uploaders.json`: example uploader dropdown options.

Production values should be copied manually to `/opt/artasia-galaxy/data/` on the VM. The production data directory is bind-mounted into the container as `/data`.

Runtime-generated settings files such as `settings.playback.json` and `settings.display.json` may also appear here on the VM.

Do not store secrets here. Secrets belong in `/opt/artasia-galaxy/.env` on the VM.
