FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY frontend ./
RUN npm run build

FROM oven/bun:1
RUN apt-get update && apt-get install -y zip && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile

COPY backend/src ./src
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 8000
CMD ["bun", "run", "src/index.ts"]
