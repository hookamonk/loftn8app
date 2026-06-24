FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run prisma:generate && npm run build

RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# Applies pending migrations (prisma migrate deploy) then starts the API.
CMD ["./docker-entrypoint.sh"]