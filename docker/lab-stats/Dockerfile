
FROM node:22.16.0-alpine3.22

ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/certs/pve-ca.pem

WORKDIR /app

COPY --chown=node:node server.js ./server.js
COPY --chown=node:node public ./public

USER node

EXPOSE 8080

CMD ["node", "server.js"]
