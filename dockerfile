FROM node:20-alpine
WORKDIR /app

# Kurulum betiğini kopyala ve tüm alt dosyaları (src, public, migrations) otomatik üret
COPY setup_full_production.js ./
RUN node setup_full_production.js

# Bağımlılıkları kur ve derle
RUN npm install
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
