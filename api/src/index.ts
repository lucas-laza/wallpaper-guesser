import express from "express";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { Wallpaper } from "./Wallpaper";
import { User } from "./User";
import { Game } from "./Game";
import { Party } from "./Party";
import { Round } from "./Round";
import { Guess } from "./Guess"; // Nouvelle entité
import * as dotenv from 'dotenv';
import { gameRouter } from "./GameController";
import { authenticateToken, AuthenticatedRequest } from "./auth-middleware";
import * as path from 'path';
import { WebSocketService } from "./WebSocketService";
import { createServer } from 'http';
import fetch from 'node-fetch';
const cors = require('cors');

dotenv.config();

const dataSource = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306"),
  username: process.env.DB_USER || "wallpaper_user",
  password: process.env.DB_PASSWORD || "wallpaper_password",
  database: process.env.DB_NAME || "wallpaper_guessr",
  entities: [Wallpaper, User, Game, Party, Round, Guess],
  synchronize: true,
  logging: false,
  charset: "utf8mb4",
  timezone: "+00:00"
});

const PORT = 3300;

// NOUVELLES FONCTIONS D'INITIALISATION
async function initializeDatabase() {
  console.log("🔄 Vérification de l'état de la base de données...");
  
  try {
    const wallpaperCount = await Wallpaper.count();
    console.log(`📊 Wallpapers actuels en base: ${wallpaperCount}`);
    
    const MIN_WALLPAPERS = 100;
    
    if (wallpaperCount < MIN_WALLPAPERS) {
      const needed = MIN_WALLPAPERS - wallpaperCount;
      console.log(`🚀 Lancement du scraping initial pour ${needed} wallpapers...`);
      
      // Lancer l'initialisation en arrière-plan (non-bloquant)
      initializeInBackground(needed).catch(error => {
        console.error("❌ Erreur lors de l'initialisation en arrière-plan:", error);
      });
      
    } else {
      console.log(`✅ Base de données suffisamment peuplée (${wallpaperCount} wallpapers)`);
      // Corriger les tags en arrière-plan
      // fixRegionalTags().catch(error => {
      //   console.error("⚠️ Erreur lors de la correction des tags:", error);
      // });
    }
    
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation de la base de données:", error);
    // Ne pas arrêter le serveur, juste log l'erreur
  }
}

async function initializeInBackground(needed: number) {
  try {
    // Attendre que le service wallpaper soit prêt
    await waitForWallpaperService();
    
    // Déclencher le scraping
    await Wallpaper.triggerBulkScraping(needed);
    
    console.log(`✅ Scraping initial terminé!`);
    
    // Corriger les tags régionaux
    // await fixRegionalTags();
    
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation en arrière-plan:", error);
  }
}


async function waitForWallpaperService(maxRetries: number = 15, delayMs: number = 5000) {
  const wallpaperServiceUrl = process.env.WALLPAPER_SERVICE_URL || 'http://localhost:3301';
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`🔍 Tentative ${i + 1}/${maxRetries}: Vérification du service wallpaper...`);
      const response = await fetch(`${wallpaperServiceUrl}/health`);
      
      if (response.ok) {
        console.log("✅ Service wallpaper prêt!");
        return;
      }
    } catch (error) {
      // Service pas encore prêt
    }
    
    if (i < maxRetries - 1) {
      console.log(`⏳ Service wallpaper pas encore prêt, nouvelle tentative dans ${delayMs/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  console.warn("⚠️ Service wallpaper non disponible, initialisation reportée");
}

// async function fixRegionalTags() {
//   console.log("🔄 Vérification des tags régionaux...");
  
//   try {
//     // Compter les wallpapers sans tags régionaux appropriés
//     const allWallpapers = await Wallpaper.getAll();
//     let wallpapersNeedingUpdate = 0;
    
//     for (const wallpaper of allWallpapers) {
//       const tags = wallpaper.tags || [];
//       const hasRegionalTag = tags.some(tag => 
//         ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania'].includes(tag)
//       );
      
//       if (!hasRegionalTag && tags.length <= 2) { // Seulement "World" + pays
//         wallpapersNeedingUpdate++;
//       }
//     }
    
//     if (wallpapersNeedingUpdate > 0) {
//       console.log(`🏷️ ${wallpapersNeedingUpdate} wallpapers sans tags régionaux détectés`);
//       console.log("🔄 Mise à jour des tags...");
      
//       await Wallpaper.updateAllTags();
      
//       console.log("✅ Tags régionaux mis à jour!");
//     } else {
//       console.log("✅ Tous les wallpapers ont déjà des tags régionaux");
//     }
//   } catch (error) {
//     console.error("⚠️ Erreur lors de la mise à jour des tags:", error);
//   }
// }

async function main() {
  console.log("🔄 Connexion à la base de données...");
  
  let retries = 10;
  while (retries > 0) {
    try {
      await dataSource.initialize();
      console.log("✅ Base de données MySQL connectée");
      break;
    } catch (error) {
      console.error(`❌ Erreur de connexion à la base de données (${retries} tentatives restantes):`, error instanceof Error ? error.message : String(error));
      retries--;
      if (retries > 0) {
        console.log("⏳ Tentative de reconnexion dans 10 secondes...");
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        console.error("💀 Impossible de se connecter à la base de données après 10 tentatives");
        process.exit(1);
      }
    }
  }
  
  // INITIALISATION AUTOMATIQUE DE LA BASE DE DONNÉES
  await initializeDatabase();
  
  const app = express();
  const httpServer = createServer(app);

  // Initialiser le service WebSocket
  const webSocketService = new WebSocketService(httpServer);

  app.locals.webSocketService = webSocketService;

  app.use(cors({ origin: '*' }));
  app.use(express.json());
  
  // Proxy des images vers le service wallpaper
  app.use('/dist/images', async (req, res) => {
    try {
      const wallpaperServiceUrl = process.env.WALLPAPER_SERVICE_URL || 'http://localhost:3301';
      const imageUrl = `${wallpaperServiceUrl}${req.originalUrl}`;
      
      const response = await fetch(imageUrl);
      if (!response.ok) {
        return res.status(404).json({ error: 'Image not found' });
      }
      
      // Copier les headers de type de contenu
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.set('Content-Type', contentType);
      }
      
      // Streamer la réponse
      response.body?.pipe(res);
    } catch (error) {
      console.error('Error proxying image:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  const secretKey = process.env.JWT_SECRET;
  if (!secretKey) {
    console.error("La clé secrète JWT n'est pas définie.");
    process.exit(1);
  }

  // Routes publiques (sans authentification)
  app.get("/", (req, res) => res.send("Hello world!!!! v3 - With Party Support & Docker Services"));

  // Routes d'authentification (publiques)
  app.post("/user/register", async (req, res) => {
    try {
      const { name, email, password, repassword } = req.body;
      
      if (!name && !email && !password && !repassword) {
        return res.status(400).json({ 
          error: "All fields are required: name, email, password, repassword" 
        });
      }

      const result = await User.verifyUserCreation(name, email, password, repassword);
      
      if (result.code) {
        return res.status(result.code).json({ error: result.message });
      }
      
      const { password: _, ...userWithoutPassword } = result;
      res.status(201).json({
        message: "User created successfully",
        user: userWithoutPassword
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/user/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      
      const token = await User.loginUser(email, password);
      
      if (!token) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      const userInfo = User.getUserFromToken(token);
      
      res.json({
        message: "Login successful",
        token,
        user: {
          id: userInfo?.userId,
          email: userInfo?.email,
          name: userInfo?.name
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Routes protégées (avec authentification)
  app.get("/user/profile", authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.userId;
      const user = await User.findOneBy({ id: userId });
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password: _, ...userProfile } = user;
      res.json(userProfile);
    } catch (error) {
      console.error("Profile error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.get("/user/token", authenticateToken, async (req: AuthenticatedRequest, res) => {
    try {
      res.json({
        message: "Token is valid",
        user: req.user
      });
    } catch (error) {
      console.error("Token validation error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Routes wallpaper - proxy vers le service wallpaper
  // app.post("/wallpaper", async (req, res) => {
  //   try {
  //     await Wallpaper.triggerScraping();
  //     res.json({ message: "Wallpaper fetched and saved successfully." });
  //   } catch (error) {
  //     console.error("Error triggering wallpaper scraping:", error);
  //     res.status(500).json({ error: "Internal Server Error" });
  //   }
  // });

  // app.post("/wallpaper/bulk", async (req, res) => {
  //   const times = req.body.times ?? 10;
  //   try {
  //     await Wallpaper.triggerBulkScraping(times);
  //     res.json({ message: `${times} wallpapers fetched and saved.` });
  //   } catch (error) {
  //     console.error("Error in bulk wallpaper fetch:", error);
  //     res.status(500).json({ error: "Internal Server Error" });
  //   }
  // });

  // Route pour recevoir les données du service wallpaper
  app.post("/wallpaper/receive", async (req, res) => {
    try {
      const wallpaperData = req.body;
      console.log("[RECEIVE] 📨 Données reçues du service wallpaper:", wallpaperData.title);
      
      const existingWallpaper = await Wallpaper.findOne({ where: { title: wallpaperData.title } });
      
      if (existingWallpaper) {
        console.log("[RECEIVE] ⏩ Wallpaper déjà existant en base. Insertion ignorée.");
        return res.json({ message: "Wallpaper already exists", existing: true });
      }
      
      const newWallpaper = await Wallpaper.createFromWallpaperService(wallpaperData);
      console.log("[RECEIVE] ✅ Wallpaper créé avec succès:", newWallpaper.id);
      
      res.json({ 
        message: "Wallpaper received and saved successfully", 
        wallpaper: Wallpaper.formatWallpaperInfo(newWallpaper) 
      });
    } catch (error) {
      console.error("Error receiving wallpaper data:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Route pour mettre à jour les tags
  app.post("/wallpaper/update-tags", async (req, res) => {
    try {
      await Wallpaper.updateAllTags();
      res.json({ message: "All wallpaper tags updated successfully." });
    } catch (error) {
      console.error("Error updating tags:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.post("/wallpaper/populate-if-needed", async (req, res) => {
    try {
      console.log("🔄 Vérification du besoin de peuplement...");
      
      const currentCount = await Wallpaper.count();
      const minRequired = req.body.minCount || 50;
      
      console.log(`📊 Wallpapers actuels: ${currentCount}, minimum requis: ${minRequired}`);
      
      if (currentCount < minRequired) {
        const needed = minRequired - currentCount;
        console.log(`🚀 Peuplement nécessaire: ${needed} wallpapers`);
        
        // Vérifier que le service wallpaper est disponible
        const wallpaperServiceUrl = process.env.WALLPAPER_SERVICE_URL || 'http://localhost:3301';
        
        try {
          const healthCheck = await fetch(`${wallpaperServiceUrl}/health`);
          if (!healthCheck.ok) {
            throw new Error("Service wallpaper non disponible");
          }
        } catch (error) {
          return res.status(503).json({ 
            error: "Service wallpaper non disponible", 
            details: error instanceof Error ? error.message : String(error)
          });
        }
        
        // Déclencher le scraping
        await Wallpaper.triggerBulkScraping(needed);
        
        // Mettre à jour les tags
        await Wallpaper.updateAllTags();
        
        const newCount = await Wallpaper.count();
        
        res.json({
          message: "Database populated successfully",
          before: currentCount,
          after: newCount,
          added: newCount - currentCount,
          required: minRequired
        });
      } else {
        // Juste mettre à jour les tags si nécessaire
        await Wallpaper.updateAllTags();
        
        res.json({
          message: "Database already sufficiently populated",
          current: currentCount,
          required: minRequired,
          status: "no_action_needed"
        });
      }
    } catch (error) {
      console.error("Erreur lors du peuplement:", error);
      res.status(500).json({ 
        error: "Population failed", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Route pour forcer le peuplement
  app.post("/wallpaper/force-populate", async (req, res) => {
    try {
      const count = req.body.count || 50;
      console.log(`🚀 Peuplement forcé: ${count} wallpapers`);
      
      await Wallpaper.triggerBulkScraping(count);
      await Wallpaper.updateAllTags();
      
      const newTotal = await Wallpaper.count();
      
      res.json({
        message: "Forced population completed",
        requested: count,
        totalWallpapers: newTotal
      });
    } catch (error) {
      console.error("Erreur lors du peuplement forcé:", error);
      res.status(500).json({ 
        error: "Forced population failed", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Route pour récupérer les wallpapers par tags
  app.get("/wallpaper/by-tags", async (req, res) => {
    try {
      const { tags } = req.query;
      if (!tags) {
        return res.status(400).json({ error: "Tags parameter is required" });
      }
      
      const tagArray = typeof tags === 'string' ? tags.split(',') : tags as string[];
      const wallpapers = await Wallpaper.getByTags(tagArray);
      
      res.json({
        tags: tagArray,
        count: wallpapers.length,
        wallpapers: wallpapers.map(w => Wallpaper.formatWallpaperInfo(w))
      });
    } catch (error) {
      console.error("Error fetching wallpapers by tags:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Route pour récupérer les wallpapers par continent
  app.get("/wallpaper/by-continent/:continent", async (req, res) => {
    try {
      const { continent } = req.params;
      const wallpapers = await Wallpaper.getByContinent(continent);
      
      res.json({
        continent,
        count: wallpapers.length,
        wallpapers: wallpapers.map(w => Wallpaper.formatWallpaperInfo(w))
      });
    } catch (error) {
      console.error("Error fetching wallpapers by continent:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Route pour récupérer tous les tags disponibles
  app.get("/wallpaper/tags", async (req, res) => {
    try {
      const wallpapers = await Wallpaper.getAll();
      const allTags = new Set<string>();
      
      wallpapers.forEach(wallpaper => {
        if (wallpaper.tags) {
          wallpaper.tags.forEach(tag => allTags.add(tag));
        }
      });
      
      const tagsByCategory = {
        continents: ['Europe', 'Americas', 'Asia', 'Africa', 'Oceania', 'World'],
        countries: Array.from(allTags).filter(tag => 
          !['Europe', 'Americas', 'Asia', 'Africa', 'Oceania', 'World'].includes(tag)
        ).sort(),
        all: Array.from(allTags).sort()
      };
      
      res.json(tagsByCategory);
    } catch (error) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Route pour récupérer les maps disponibles
  app.get("/maps", async (req, res) => {
    try {
      const wallpapers = await Wallpaper.getAll();
      const regionCounts = new Map<string, number>();
      
      wallpapers.forEach(wallpaper => {
        if (wallpaper.tags) {
          wallpaper.tags.forEach(tag => {
            if (['Europe', 'Americas', 'Asia', 'Africa', 'Oceania', 'World'].includes(tag)) {
              regionCounts.set(tag, (regionCounts.get(tag) || 0) + 1);
            }
          });
        }
      });

      const maps = Array.from(regionCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => {
          if (a.name === 'World') return -1;
          if (b.name === 'World') return 1;
          return b.count - a.count;
        });
      
      res.json(maps);
    } catch (error) {
      console.error("Error fetching maps:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  app.get("/wallpaper/test", async (req, res) => {
    try {
      const wallpaper = await Wallpaper.buildRandomWallpaper();
      res.json(wallpaper);
    } catch (error) {
      console.error("Error fetching test wallpaper:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Routes du jeu (solo et party)
  app.use("/game", gameRouter);

  // Route pour les statistiques WebSocket
  app.get("/websocket/stats", (req, res) => {
    res.json(webSocketService.getStats());
  });

  // Route de santé pour vérifier le statut du serveur
  app.get("/health", (req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      services: {
        database: "connected",
        websocket: "active"
      }
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`🚀 API Server listening on port ${PORT}`);
    console.log(`📡 WebSocket server active`);
    console.log(`🎮 Solo and Party games supported`);
    console.log(`🗄️ Database connected (MySQL)`);
    console.log(`🔗 Wallpaper service URL: ${process.env.WALLPAPER_SERVICE_URL || 'http://localhost:3301'}`);
  });
}

main().catch(error => {
  console.error("Failed to start API server:", error);
  process.exit(1);
});