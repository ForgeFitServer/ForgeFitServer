FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js db.js docker-entrypoint.sh ./

# node:alpine ships a pre-created 'node' user (UID 1000 / GID 1000).
# su-exec is the Alpine equivalent of gosu/setpriv for privilege dropping.
# The container starts as root so the entrypoint can chown /data (which may be
# root-owned from a previous run), then drops to the 'node' user.
RUN apk add --no-cache su-exec && \
    chown -R node:node /app && \
    chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health',r=>{process.exit(r.statusCode<500?0:1)}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
