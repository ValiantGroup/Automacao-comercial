FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 5010

CMD ["pnpm", "start"]
