# Compliance Platform

A dual-folder full-stack compliance and incident response platform.

This project helps security teams manage compliance checks and evidence throughout the year, maintain a full compliance calendar, sign off requirements, and produce exports when the time comes.

- `compliance-platform-api/` — Node.js + Express API, PostgreSQL backend, authentication, audit logging, compliance calendar, requirement tracking, evidence upload, signoff workflows, export generation, and incident/tabletop support.
- `compliance-platform-ui/` — Vite + React + Tailwind UI for managing compliance checks, evidence attachments, calendar instances, case workflows, exercises, notifications, and export packages.

## Features

- JWT-based authentication with refresh tokens
- Full compliance calendar with scheduled requirement instances
- Evidence upload and signoff tracking for each compliance requirement
- Exportable evidence and requirement packages for audits/QSA review
- Incident case lifecycle management with action logging and notifications
- Tabletop exercise mode, gap remediation, and after-action reporting
- PostgreSQL backend with Docker Compose support

## Repository structure

- `compliance-platform-api/`
  - `src/` — server code, routes, middleware, services, exports
  - `migrations/` — schema migration files
  - `docker-compose.yml` — database + API development stack
- `compliance-platform-ui/`
  - `src/` — React application, pages, components, API client
  - `vite.config.js` — dev server and proxy configuration

## Prerequisites

- Node.js 18+ or compatible
- npm
- Docker and Docker Compose

## Start the backend and database

The API project includes a Docker Compose stack that starts PostgreSQL and the API service together.

1. Open a terminal in `compliance-platform-api/`
2. Install dependencies:

```bash
cd compliance-platform-api
npm install
```

3. Start the backend stack:

```bash
docker compose up --build
```

This starts:

- PostgreSQL on `localhost:5432`
- API on `http://localhost:3000`

The API service is configured to use:

- `POSTGRES_USER=iruser`
- `POSTGRES_PASSWORD=password`
- `POSTGRES_DB=irplatform`
- `DATABASE_URL=postgresql://iruser:password@db:5432/irplatform`

## Start the UI

1. Open a terminal in `compliance-platform-ui/`
2. Install dependencies:

```bash
cd compliance-platform-ui
npm install
```

3. Start the UI dev server:

```bash
npm run dev
```

The UI runs on `http://localhost:3001` and proxies API requests to `http://localhost:3000`.

## Development notes

- The UI API client uses `baseURL: '/api'` and relies on the Vite proxy in `vite.config.js`.
- The API server exposes routes under `/api/*` and includes a `/health` endpoint.
- API CORS origin is configured via `CORS_ORIGIN`; by default it allows `http://localhost:3001`.

## Recommended workflow

1. Start Docker Compose from `compliance-platform-api/`
2. Open the UI from `compliance-platform-ui/`
3. Authenticate and use the React app to manage cases, exercises, evidence, and exports

## Useful commands

### API

```bash
cd compliance-platform-api
npm run dev      # start backend in development mode
npm run migrate  # run database migrations
npm test         # run backend tests
npm run lint     # lint backend code
```

### UI

```bash
cd compliance-platform-ui
npm run dev      # start Vite dev server
npm run build    # build the production UI
npm run preview  # preview the built UI
```

## Notes

- The API container mounts the local source tree and reloads code changes when restarted.
- The database volume is persisted in Docker volume `pgdata`.
- If you need different credentials or database settings, update `docker-compose.yml` and the corresponding environment variables.

## Disclaimer

This tool aids PCI-DSS compliance. It does not guarantee compliance. A qualified QSA assessment is still required.

## License

MIT