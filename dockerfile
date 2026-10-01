FROM node:20-alpine
WORKDIR /app

COPY setup_full_production.js ./
RUN node setup_full_production.js

RUN npm install
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
