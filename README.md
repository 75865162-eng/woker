# Amazon Bulk Ad Operation

Next.js 15 + Prisma + PostgreSQL + Redis operations workspace for Amazon advertising, listing AI, product, file, and logistics workflows.

## Project Definitions

- Advertising data file definitions: [docs/amazon-ppc-advertising-data-definitions.md](docs/amazon-ppc-advertising-data-definitions.md)

## Getting Started

For a local database restore, create the bootstrap super account after migrations:

```bash
npm run db:seed-admin
```

The development bootstrap account follows `.env.example`: account `1`, password `1`. Change `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` before real company use.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Production Deployment

See [docs/server-deployment.md](docs/server-deployment.md) for the production server checklist.

Production on `108.61.0.221` uses a lightweight native layout:

- PostgreSQL and Redis run in Docker via `docker-compose.yml`.
- Next.js web runs on the server with systemd as `amazon-web`.
- Worker runs on the server with systemd as `amazon-worker`.
- Caddy runs in Docker with host networking and proxies HTTPS to the local web process.
- Production file storage uses Cloudflare R2 from the server `.env`.

Deploy from this repository:

```bash
npm run lint
npm run build
bash scripts/deploy-native-server.sh
```

Server-side release command:

```bash
cd /opt/amazon-ad-bulk-operation
bash scripts/server-native-release.sh
```

Do not sync `.env`, `uploads`, `.next*`, `node_modules*`, or historical broken build directories to the server.
When `package-lock.json` is unchanged, the server release script skips `npm ci` and only regenerates Prisma, builds, and restarts services.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Useful Production Checks

```bash
systemctl status amazon-web amazon-worker
journalctl -u amazon-web -u amazon-worker -n 100 --no-pager
docker compose ps
df -h /
```

See `AGENTS.md` for the full deployment and update rules.
