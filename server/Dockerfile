FROM node:20-alpine

WORKDIR /app

# Prisma needs openssl for its query engine on alpine.
RUN apk add --no-cache openssl

# Dependencies first so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The client is generated against the schema, so it must exist before generate.
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "src/index.js"]
