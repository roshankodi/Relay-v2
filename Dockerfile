FROM node:20-alpine

WORKDIR /app

# No package to install — the app has zero runtime dependencies — but this
# stays here so the image still works if any are ever added.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Basic container healthcheck against the public landing page.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
