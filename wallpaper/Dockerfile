FROM node:18-alpine

# Installer curl pour les healthchecks
RUN apk add --no-cache curl

WORKDIR /app

# Copier les fichiers de configuration
COPY package*.json ./
COPY tsconfig.json ./

# Installer les dépendances
RUN npm install

# Copier le code source
COPY src/ ./src/

# Compiler TypeScript
RUN npm run build

# Créer le dossier images
RUN mkdir -p dist/images

# Exposer le port
EXPOSE 3301

# Commande de démarrage
CMD ["npm", "start"]