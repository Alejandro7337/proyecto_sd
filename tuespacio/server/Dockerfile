# Imagen de la API. Contexto de construcción: carpeta tuespacio/ (el servidor importa el dominio
# compartido de app/src/domain). Uso: docker build -f server/Dockerfile -t tu-espacio-api .
FROM node:22-alpine AS deps
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv/server
COPY --from=deps /srv/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY app/src/domain /srv/app/src/domain
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/index.js"]
