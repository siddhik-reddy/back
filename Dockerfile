FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm install --production --no-audit --no-fund

COPY . .

RUN mkdir -p /app/data

EXPOSE 5000

USER node

CMD ["node", "server.js"]
