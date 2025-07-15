# Étape 1 : Build de l'application
FROM node:20-slim AS builder

WORKDIR /app

# Copie des fichiers de dépendances
COPY package.json package-lock.json ./

# Installation des dépendances
RUN npm ci --prefer-offline --include=optional

# Copie du reste des fichiers
COPY . .

# Build de l'application
RUN npm run build

# Étape 2 : Serveur NGINX
FROM nginx:stable-alpine AS stage-1

RUN apk add --no-cache curl

# Supprime la config par défaut
RUN rm /etc/nginx/conf.d/default.conf

# Copie de ta config NGINX
COPY nginx.conf /etc/nginx/conf.d/

# Copie du build
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]