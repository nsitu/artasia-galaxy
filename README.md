# Artasia Galaxy

Run the project from the repo root with two terminals:

```powershell
npm run dev --workspace @artasia/server
```

```powershell
npm run dev --workspace @artasia/web
```

The server runs on `http://localhost:3000`. The web app runs on the Vite URL printed in the second terminal, usually `http://localhost:5173`.

## Documentation

Current system documentation lives in [docs/](docs/). Future work plans live in [plans/](plans/).

## Docker

Build the production image:

```powershell
docker build -t artasia-galaxy:local .
```

Run it locally:

```powershell
$env:ARTASIA_IMAGE="artasia-galaxy:local"; docker compose up -d
```
