# Forma runtime for generated apps. No dependencies, so there is nothing to install.
# node:sqlite needs Node 22.13 or newer. Node 24 is the long-term-support line.
FROM node:24-slim

WORKDIR /app
COPY . .

ENV NODE_ENV=production
# Cloud Run sends traffic to the port in $PORT. The server reads it and listens on 0.0.0.0.
ENV PORT=8080
EXPOSE 8080

# The database lives in memory and is rebuilt with demo data on every start.
USER node
CMD ["node", "server.mjs"]
