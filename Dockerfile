FROM node:24-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG VITE_DEMO_LOGIN_ENABLED=false
ENV VITE_DEMO_LOGIN_ENABLED=$VITE_DEMO_LOGIN_ENABLED

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM ghcr.io/nginx/nginx-unprivileged:1.30.6-alpine-slim AS runtime

# Refresh Alpine packages in the pinned upstream image so the final runtime does
# not retain OS fixes that were published after the upstream tag was built.
USER root
RUN apk upgrade --no-cache
USER nginx

ENV BACKEND_URL=http://localhost:8080 \
    PORT=8080

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker/entrypoint.sh /docker-entrypoint.d/40-pfi-env.sh
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080
USER nginx
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/env.js" >/dev/null || exit 1
