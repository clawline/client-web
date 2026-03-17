# ---- build ----
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx vite build --outDir dist

# ---- production ----
FROM node:22-alpine
RUN npm i -g serve
WORKDIR /app
COPY --from=build /build/dist ./dist

ENV PORT=3000

EXPOSE 3000

CMD ["serve", "-s", "dist", "-l", "3000"]
