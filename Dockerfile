# One image for both Railway services (.railway/railway.ts): the web app and the worker. Each
# service sets its own start command; this default starts the web app.
# Node and pnpm match the repo: Node 24 (engines), pnpm 12.16.1 (packageManager).
FROM node:24.9.0-bookworm-slim
RUN npm install -g pnpm@12.16.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @proofofclaim/web build
ENV NODE_ENV=production
CMD ["sh", "-c", "cd apps/web && exec node_modules/.bin/next start -p ${PORT:-3100}"]
