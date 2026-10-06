# ---- build
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: static app + /api (Claude proxy)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8787
CMD ["node", "dist-server/index.mjs"]
