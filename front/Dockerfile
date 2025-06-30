# Dockerfile optimisé pour éviter les blocages npm
FROM node:20-alpine AS builder

WORKDIR /app

# Configuration npm pour éviter les blocages
ENV NPM_CONFIG_PROGRESS=false
ENV NPM_CONFIG_LOGLEVEL=warn
ENV NPM_CONFIG_AUDIT=false
ENV NPM_CONFIG_FUND=false
ENV CI=true

# Mise à jour npm et nettoyage
RUN npm install -g npm@latest && npm cache clean --force

# Copier seulement package.json d'abord
COPY package.json ./

# Générer package-lock.json s'il n'existe pas
RUN npm install --package-lock-only

# Copier package-lock.json s'il existe
COPY package-lock.json* ./

# Installation avec options de robustesse
RUN npm ci --prefer-offline --no-audit --no-fund --legacy-peer-deps || \
    npm install --prefer-offline --no-audit --no-fund --legacy-peer-deps

# Copier le reste du code
COPY . .

# Build
RUN npm run build

# Production stage
FROM nginx:alpine

RUN apk add --no-cache curl

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]