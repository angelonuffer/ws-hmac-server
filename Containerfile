FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY src/ ./src/

EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["node", "src/index.js"]
