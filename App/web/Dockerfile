FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ARG AUTH_MODE=all
ARG BRAND_NAME=Forge Fitness Server
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY frontend/ ./
RUN AUTH_MODE=${AUTH_MODE} BRAND_NAME="${BRAND_NAME}" npm run build

FROM nginx:alpine
# ── Non-root user (UID/GID 1000): listening on port 8080 avoids CAP_NET_BIND_SERVICE ──
RUN addgroup -g 1000 -S appgroup && \
    adduser  -u 1000 -S appuser -G appgroup && \
    sed -i '/^user /d' /etc/nginx/nginx.conf && \
    chown -R appuser:appgroup \
        /var/cache/nginx \
        /var/log/nginx \
        /etc/nginx/conf.d \
        /usr/share/nginx/html && \
    touch /var/run/nginx.pid && \
    chown appuser:appgroup /var/run/nginx.pid
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
