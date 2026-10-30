# Single-service image for free hosting (Render, Koyeb, Railway...).
# One container serves the website, the API and WebSockets. No Redis, and code
# runs through the Judge0 API instead of the local runner service.
#
# For the full multi-container setup (2 API instances, Redis, own sandbox), use
# docker-compose.yml instead.

# ---- build the React app ----
FROM node:22-alpine AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- build the API ----
FROM node:22-alpine AS server
WORKDIR /server
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    STATIC_DIR=/app/public \
    REDIS_URL= \
    RUNNER_MODE=judge0
COPY --from=server /server/node_modules ./node_modules
COPY --from=server /server/dist ./dist
COPY --from=server /server/package.json ./
COPY --from=client /client/dist ./public
USER node
EXPOSE 10000
CMD ["node", "dist/index.js"]
