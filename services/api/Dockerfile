FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci --workspace=services/api --include-workspace-root

FROM dependencies AS build
COPY services/api/tsconfig.json services/api/tsconfig.json
COPY services/api/src services/api/src
RUN npm run build --workspace=services/api

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
RUN npm ci --omit=dev --workspace=services/api --include-workspace-root
COPY --from=build /app/services/api/dist services/api/dist

USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "services/api/dist/server.js"]
