# Dockerfile corrigé pour Vite
FROM node:20-alpine AS builder

WORKDIR /app

# Augmenter la mémoire Node.js
ENV NODE_OPTIONS="--max_old_space_size=4096"

# Copier package.json et package-lock.json séparément pour le cache
COPY package.json ./
COPY package-lock.json* ./

# Installer TOUTES les dépendances (dev incluses) car Vite est en devDependencies
RUN npm ci --timeout=300000 || npm install --timeout=300000

# Copier le reste du code
COPY . .

# Build avec Vite
RUN npm run build

# Production stage avec Nginx
FROM nginx:alpine

RUN apk add --no-cache curl

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]