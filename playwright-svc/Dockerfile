FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install
# Install the exact chromium version required by playwright 1.44.0
RUN npx playwright install chromium
COPY . .
RUN npm run build
EXPOSE 3002
CMD ["node", "dist/server.js"]

