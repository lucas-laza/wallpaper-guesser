# Wallpaper Guessr - Architecture Dockerisée

## 🚀 Démarrage en une commande

```bash
# Tout est configuré pour fonctionner directement
docker-compose up --build
```

## 🏗️ Architecture

### Structure des fichiers attendue
```
.
├── .env                    # Variables d'environnement (à la racine)
├── countries.json          # Données des pays (à la racine)
├── docker-compose.yml      # Configuration Docker
├── README.md
├── api/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── Wallpaper.ts
│       ├── User.ts
│       ├── Game.ts
│       ├── Party.ts
│       ├── Round.ts
│       ├── GameController.ts
│       ├── WebSocketService.ts
│       ├── GameService.ts
│       ├── SoloGameController.ts
│       ├── auth-middleware.ts
│       ├── Data.ts
│       ├── Guess.ts
│       └── types.ts
├── wallpaper/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── WallpaperService.ts
└── db/
    └── init.sql
```

### Services Docker

**API Service** (port 3300)
- API principale avec toutes les routes
- Authentification JWT
- Gestion des jeux et parties
- WebSocket pour les parties en temps réel
- Base de données MySQL via TypeORM

**Wallpaper Service** (port 3301)
- Scraping Microsoft Spotlight
- Téléchargement et stockage des images
- Analyse géographique des wallpapers
- Communication avec l'API service

**Database Service** (MySQL 8.0)
- Base de données centralisée
- Port 3306 exposé pour debug
- Volume persistant

## ⚙️ Configuration

### Variables d'environnement (.env)
```bash
# Base de données
DB_HOST=db
DB_PORT=3306
DB_NAME=wallpaper_guessr
DB_USER=wallpaper_user
DB_PASSWORD=wallpaper_password

# JWT Secret - CHANGEZ EN PRODUCTION
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Services
NODE_ENV=production
WALLPAPER_SERVICE_URL=http://wallpaper:3301
API_SERVICE_URL=http://api:3300
```

### Fichier countries.json
Ce fichier doit contenir la structure suivante pour le mapping géographique :
```json
[
  {
    "name": "France",
    "code3": "FRA",
    "continent": "Europe",
    "states": [
      {"code": "75", "name": "Paris"},
      {"code": "13", "name": "Provence"}
    ]
  }
]
```

## 🔄 Workflow de scraping

1. **Déclenchement** : `POST /wallpaper` → API Service
2. **Proxy** : API Service → `POST /scrape` → Wallpaper Service  
3. **Scraping** : Wallpaper Service → Microsoft Spotlight API
4. **Téléchargement** : Image stockée dans volume partagé
5. **Analyse** : Détection du pays/région via countries.json
6. **Envoi** : `POST /wallpaper/receive` → API Service
7. **Sauvegarde** : Wallpaper + tags générés → MySQL

## 📡 Endpoints principaux

### API Service (localhost:3300)
```bash
# Authentification
POST /user/register   # Inscription
POST /user/login      # Connexion
GET  /user/profile    # Profil (auth required)

# Wallpapers
POST /wallpaper                    # Déclencher 1 scraping
POST /wallpaper/bulk              # Scraping en masse
GET  /wallpaper/by-tags?tags=...  # Recherche par tags
GET  /wallpaper/tags              # Liste des tags
GET  /maps                        # Continents disponibles

# Jeux
POST /game/solo/start            # Démarrer partie solo
POST /game/party/create          # Créer une partie multijoueur
GET  /game/party/:code/join      # Rejoindre une partie

# Status
GET  /health                     # Santé du service
GET  /websocket/stats           # Stats WebSocket
```

### Wallpaper Service (localhost:3301)
```bash
POST /scrape                     # Scraping simple
POST /scrape/bulk               # Scraping en masse
GET  /health                    # Santé du service
```

## 🏷️ Système de tags

Les tags sont générés automatiquement à partir de countries.json :

- **Continent** : `Europe`, `Asia`, `Americas`, `Africa`, `Oceania`
- **Pays** : `France`, `Japan`, `United States`, etc.
- **Région/État** : `California`, `Provence`, etc. (si détecté)
- **World** : Ajouté à tous les wallpapers

Exemple : Wallpaper de Provence → `["Europe", "France", "Provence", "World"]`

## 🛠️ Commandes Docker

```bash
# Démarrage
docker-compose up --build        # Premier démarrage
docker-compose up                # Démarrage normal
docker-compose up -d             # En arrière-plan

# Monitoring
docker-compose logs -f           # Tous les logs
docker-compose logs -f api       # Logs API uniquement
docker-compose logs -f wallpaper # Logs scraper uniquement
docker-compose logs -f db        # Logs MySQL

# Gestion
docker-compose ps                # État des services
docker-compose restart api      # Redémarrer l'API
docker-compose stop             # Arrêter tous les services
docker-compose down             # Arrêter et supprimer les conteneurs

# Debug
docker-compose exec api sh       # Accéder au conteneur API
docker-compose exec db mysql -u wallpaper_user -p wallpaper_guessr
```

## 🧪 Tests rapides

```bash
# Vérifier que tout fonctionne
curl http://localhost:3300/health
curl http://localhost:3301/health

# Déclencher un scraping
curl -X POST http://localhost:3300/wallpaper

# Tester l'inscription
curl -X POST http://localhost:3300/user/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com", 
    "password": "password123",
    "repassword": "password123"
  }'

# Voir les tags disponibles
curl http://localhost:3300/wallpaper/tags
```

## 🐛 Troubleshooting

### Erreur de connexion MySQL
```bash
# Attendre que MySQL soit prêt (normal au premier démarrage)
docker-compose logs db
# Redémarrer l'API si nécessaire
docker-compose restart api
```

### Service wallpaper inaccessible
```bash
# Vérifier les logs
docker-compose logs wallpaper
# Tester la connectivité
curl http://localhost:3301/health
```

### Problème de volumes/images
```bash
# Vérifier les volumes
docker volume ls
docker volume inspect wallpaper-guessr_shared_images
```

### Reconstruire complètement
```bash
# Arrêter et nettoyer
docker-compose down -v
docker system prune -f
# Reconstruire
docker-compose up --build
```

## 🔐 Sécurité

### En production, modifiez :

1. **JWT_SECRET** dans `.env`
2. **Mots de passe MySQL** dans `.env` et `docker-compose.yml`
3. **Ajoutez HTTPS** avec un reverse proxy
4. **Limitez l'exposition des ports** (seulement 3300 pour l'API)
5. **Configurez les backups** MySQL

### Configuration nginx recommandée :
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 📊 Volumes Docker

- `mysql_data` : Données persistantes de MySQL
- `shared_images` : Images partagées entre API et service wallpaper

Les données survivent aux redémarrages des conteneurs mais peuvent être supprimées avec `docker-compose down -v`.