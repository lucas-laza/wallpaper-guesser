import express from "express";
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import cron from 'node-cron';
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = 3301;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/dist/images', express.static(path.join(__dirname, '..', 'dist', 'images')));

interface WallpaperData {
  title: string;
  img: string;
  copyright: string;
  country: { code: string; text: string };
  state?: { code: string | undefined; text: string | undefined };
  imageLink?: string;
  tags?: string[];
}

interface CountryState {
  code: string;
  name: string;
}

interface Country {
  name: string;
  code3: string;
  region: string;        // "Europe", "Asia", "Africa", etc.
  subregion: string;     // "Western Europe", "Southern Asia", etc.
  states?: CountryState[];
}

class WallpaperScraper {
  private static readonly API_SERVICE_URL = process.env.API_SERVICE_URL || 'http://localhost:3300';

  static loadCountryData(): Country[] {
    try {
      const countryPath = process.env.NODE_ENV === 'production' 
        ? '/app/countries.json'
        : './countries.json';
      const countryDataRaw = fs.readFileSync(countryPath, 'utf8');
      return JSON.parse(countryDataRaw);
    } catch (error) {
      console.error('[COUNTRIES] Erreur lors du chargement de countries.json:', error);
      return [];
    }
  }

  static async downloadImage(url: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destination);
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(destination, () => {});
        reject(err instanceof Error ? err.message : String(err));
      });
    });
  }

  static async getCountryOrStateDetails(title: string): Promise<{ country: any, state: any | undefined, fullCountryData?: Country }> {
    const countryData = this.loadCountryData();
    
    for (const country of countryData) {
      if (title.includes(country.name)) {
        const foundState = country.states?.find((state: CountryState) => 
          title.includes(state.name)
        );
        
        return {
          country: { code: country.code3, text: country.name },
          state: foundState ? { code: foundState.code, text: foundState.name } : undefined,
          fullCountryData: country
        };
      }
    }
  
    return { country: undefined, state: undefined };
  }

  // Génère les tags en utilisant les données de countries.json
  static generateTags(countryName: string, stateName?: string, fullCountryData?: Country): string[] {
    const tags: string[] = ['World']; // Toujours ajouter "World"
    
    // Ajouter le nom du pays
    if (countryName) {
      tags.push(countryName);
    }
    
    // Ajouter l'état si présent
    if (stateName) {
      tags.push(stateName);
    }
    
    // Ajouter la région depuis countries.json
    if (fullCountryData?.region) {
      // Mapper les régions de countries.json vers nos régions de jeu
      const regionMapping: Record<string, string> = {
        'Europe': 'Europe',
        'Asia': 'Asia', 
        'Africa': 'Africa',
        'Americas': 'North America', // Par défaut
        'Oceania': 'Oceania'
      };
      
      let gameRegion = regionMapping[fullCountryData.region];
      
      // Affiner pour les Amériques en utilisant le subregion
      if (fullCountryData.region === 'Americas') {
        if (fullCountryData.subregion?.includes('South')) {
          gameRegion = 'South America';
        } else {
          gameRegion = 'North America';
        }
      }
      
      if (gameRegion) {
        tags.push(gameRegion);
        console.log(`[TAGS] ✅ Région mappée: ${fullCountryData.region} -> ${gameRegion} pour ${countryName}`);
      }
    } else {
      console.warn(`[TAGS] ⚠️ Aucune région trouvée dans countries.json pour: ${countryName}`);
    }
    
    console.log(`[TAGS] 🏷️ Tags générés pour ${countryName}: [${tags.join(', ')}]`);
    return tags;
  }

  static async sendToAPI(wallpaperData: WallpaperData): Promise<void> {
    try {
      console.log(`[SEND_API] 📤 Envoi vers l'API: ${wallpaperData.title}`);
      console.log(`[SEND_API] 🏷️ Tags: [${wallpaperData.tags?.join(', ')}]`);
      
      const response = await fetch(`${this.API_SERVICE_URL}/wallpaper/receive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(wallpaperData)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log(`[SEND_API] ✅ Réponse de l'API:`, result.message);
    } catch (error) {
      console.error(`[SEND_API] ❌ Erreur lors de l'envoi vers l'API:`, error);
      throw error;
    }
  }

  static async fetchFromSpotlightV4(): Promise<WallpaperData | null> {
    console.log("[SCRAPER] 🔄 Lancement du scraping...");

    const imageDir = path.resolve(__dirname, '..', 'dist', 'images');
    if (!fs.existsSync(imageDir)) {
      console.log("[SCRAPER] 📁 Création du dossier d'images...");
      fs.mkdirSync(imageDir, { recursive: true });
    }

    try {
      const response = await fetch(
        'https://fd.api.iris.microsoft.com/v4/api/selection?placement=88000820&bcnt=1&country=US&locale=en-US&fmt=json'
      );
      const data = await response.json() as any;
      console.log("[SCRAPER] ✅ Données API reçues");

      const rawItem = data?.batchrsp?.items?.[0]?.item;
      if (!rawItem) {
        console.error("[SCRAPER] ❌ Aucun item trouvé dans la réponse API");
        throw new Error("No item found in API response");
      }

      const parsed = JSON.parse(rawItem);
      const ad = parsed.ad;

      const title = ad.title || "Untitled";
      const imgUrl = ad.landscapeImage?.asset;
      const copyright = ad.copyright || "© Microsoft";
      const hoverText = ad.iconHoverText || ad.description || title;

      console.log(`[SCRAPER] 🖼️ Titre: ${title}`);
      console.log(`[SCRAPER] 🌍 Texte de localisation : ${hoverText}`);
      console.log(`[SCRAPER] 🔗 Image URL: ${imgUrl}`);

      if (!imgUrl) {
        console.error("[SCRAPER] ❌ Pas d'URL image trouvée");
        throw new Error("Image URL not found");
      }

      const filename = path.basename(imgUrl.split('?')[0]);
      const localPath = path.join('dist/images', filename);
      const fullPath = path.resolve(__dirname, '..', localPath);

      console.log(`[SCRAPER] 💾 Téléchargement de l'image vers ${localPath}`);
      await this.downloadImage(imgUrl, fullPath);

      const details = await this.getCountryOrStateDetails(hoverText);

      if (!details.country) {
        console.warn(`[SCRAPER] ⚠️ Aucun pays détecté dans : "${hoverText}"`);
        return null;
      }

      console.log(`[SCRAPER] ✅ Pays détecté: ${details.country.text}`);
      if (details.state) {
        console.log(`[SCRAPER] ✅ État détecté: ${details.state.text}`);
      }

      // Générer les tags automatiquement
      const tags = this.generateTags(
        details.country.text, 
        details.state?.text, 
        details.fullCountryData
      );

      const wallpaperData: WallpaperData = {
        title,
        img: localPath,
        copyright,
        country: details.country,
        state: details.state,
        imageLink: imgUrl,
        tags // Inclure les tags générés
      };

      console.log("[SCRAPER] 📤 Envoi des données vers l'API...");
      await this.sendToAPI(wallpaperData);
      console.log("[SCRAPER] 🎉 Scraping terminé avec succès!");

      return wallpaperData;
    } catch (error) {
      console.error("[SCRAPER] ❌ Erreur lors du scraping:", error);
      throw error;
    }
  }
}

// Routes
app.get("/", (req, res) => {
  res.json({
    service: "Wallpaper Scraping Service",
    version: "1.0.0",
    status: "active"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "wallpaper-scraper"
  });
});

app.post("/scrape", async (req, res) => {
  try {
    const result = await WallpaperScraper.fetchFromSpotlightV4();
    if (result) {
      res.json({ 
        message: "Wallpaper scraped and sent to API successfully", 
        wallpaper: result 
      });
    } else {
      res.status(400).json({ error: "No valid wallpaper data found" });
    }
  } catch (error) {
    console.error("Error in scraping:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/scrape/bulk", async (req, res) => {
  const times = req.body.times || 10;
  const results: WallpaperData[] = [];
  const errors: { iteration: number; error: string }[] = [];

  console.log(`[BULK_SCRAPER] 🔄 Démarrage du scraping en masse (${times} fois)...`);

  for (let i = 0; i < times; i++) {
    try {
      console.log(`[BULK_SCRAPER] 🔄 Scraping ${i + 1}/${times}...`);
      const result = await WallpaperScraper.fetchFromSpotlightV4();
      if (result) {
        results.push(result);
      }
      
      // Attendre un peu entre les requêtes pour éviter le rate limiting
      if (i < times - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`[BULK_SCRAPER] ❌ Erreur lors du scraping ${i + 1}:`, error);
      errors.push({ 
        iteration: i + 1, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  console.log(`[BULK_SCRAPER] 🎉 Scraping en masse terminé. Succès: ${results.length}, Erreurs: ${errors.length}`);

  res.json({
    message: `Bulk scraping completed`,
    successful: results.length,
    errors: errors.length,
    results,
    errorDetails: errors
  });
});

// Variables de santé du cron
let lastCronStatus = 'never';
let lastCronTime: string | null = null;
let lastCronError: string | null = null;

// CRON : toutes les heures (0 * * * *)
cron.schedule('0 * * * *', async () => {
  try {
    console.log('[CRON] ⏰ Lancement du bulk wallpaper scraping (service wallpaper)...');
    const response = await fetch('http://localhost:3301/scrape/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ times: 50 }) // 50 images par heure
    });
    const result = await response.json();
    console.log('[CRON] ✅ Réponse du bulk:', result);
    lastCronStatus = 'success';
    lastCronTime = new Date().toISOString();
    lastCronError = null;
  } catch (error) {
    console.error('[CRON] ❌ Erreur lors du bulk wallpaper scraping:', error);
    lastCronStatus = 'error';
    lastCronTime = new Date().toISOString();
    lastCronError = error instanceof Error ? error.message : String(error);
  }
});

// Route de contrôle du cron
app.get('/cron-status', (req, res) => {
  res.json({
    lastCronStatus,
    lastCronTime,
    lastCronError
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Wallpaper Scraper Service listening on port ${PORT}`);
  console.log(`🔗 API Service URL: ${WallpaperScraper['API_SERVICE_URL']}`);
  console.log(`📁 Images stored in: dist/images/`);
});