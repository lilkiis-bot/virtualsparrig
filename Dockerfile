FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY index.mjs ./
USER node
EXPOSE 9000
CMD ["node", "index.mjs"]
