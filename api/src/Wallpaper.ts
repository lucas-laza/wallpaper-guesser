import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import fetch from 'node-fetch';
import * as fs from 'fs';

@Entity()
export class Wallpaper extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  @Column()
  img!: string;

  @Column({ nullable: true })
  image_link?: string;

  @Column()
  copyright!: string;

  @Column({ type: 'json', nullable: false })
  country!: {
    code: string;
    text: string;
  };

  @Column({ type: 'json', nullable: true })
  state?: {
    code: string | undefined;
    text: string | undefined;
  };

  @Column({ type: 'json', nullable: false })
  tags!: string[];

  // Charger les données countries.json
  static loadCountryData() {
    try {
      const countryDataRaw = fs.readFileSync('/app/countries.json', 'utf8');
      return JSON.parse(countryDataRaw);
    } catch (error) {
      console.error('[COUNTRIES] Erreur lors du chargement de countries.json:', error);
      return [];
    }
  }

  // Mapping dynamique des pays vers les continents à partir de countries.json
  private static getCountryToContinent(): { [key: string]: string } {
    const countryData = this.loadCountryData();
    const mapping: { [key: string]: string } = {};
    
    countryData.forEach((country: any) => {
      if (country.code3 && country.continent) {
        mapping[country.code3] = country.continent;
      }
    });

    return mapping;
  }

  /**
   * Crée un nouveau wallpaper depuis les données reçues du service wallpaper
   */
  static async createFromWallpaperService(data: {
    title: string;
    img: string;
    copyright: string;
    country: { code: string; text: string };
    state?: { code: string | undefined; text: string | undefined };
    imageLink?: string;
  }): Promise<Wallpaper> {
    const wallpaper = new Wallpaper();
    wallpaper.title = data.title;
    wallpaper.img = data.img;
    wallpaper.image_link = data.imageLink;
    wallpaper.copyright = data.copyright;
    wallpaper.country = data.country;
    wallpaper.state = data.state;

    console.log("[CREATE] 🏷️ Génération des tags...");
    wallpaper.tags = wallpaper.generateTags();
    console.log("[CREATE] ✅ Tags générés:", wallpaper.tags);

    console.log("[CREATE] 💾 Enregistrement en base...");
    await wallpaper.save();
    console.log("[CREATE] ✅ Wallpaper enregistré avec ID:", wallpaper.id);

    return wallpaper;
  }

  /**
   * Déclenche le scraping via le service wallpaper
   */
  static async triggerScraping(): Promise<void> {
    const wallpaperServiceUrl = process.env.WALLPAPER_SERVICE_URL || 'http://localhost:3301';
    
    try {
      console.log("[SCRAPING] 🔄 Déclenchement du scraping...");
      const response = await fetch(`${wallpaperServiceUrl}/scrape`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log("[SCRAPING] ✅ Scraping terminé:", result);
    } catch (error) {
      console.error("[SCRAPING] ❌ Erreur lors du scraping:", error);
      throw error;
    }
  }

  /**
   * Déclenche le scraping en masse via le service wallpaper
   */
  static async triggerBulkScraping(times: number = 10): Promise<void> {
    const wallpaperServiceUrl = process.env.WALLPAPER_SERVICE_URL || 'http://localhost:3301';
    
    try {
      console.log(`[BULK_SCRAPING] 🔄 Déclenchement du scraping (${times} fois)...`);
      const response = await fetch(`${wallpaperServiceUrl}/scrape/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ times })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log("[BULK_SCRAPING] ✅ Scraping en masse terminé:", result);
    } catch (error) {
      console.error("[BULK_SCRAPING] ❌ Erreur lors du scraping en masse:", error);
      throw error;
    }
  }

  /**
   * Génère automatiquement les tags basés sur le pays et l'état
   */
  private generateTags(): string[] {
    const tags: string[] = [];

    try {
      // Ajouter le continent basé sur le code pays depuis countries.json
      const countryToContinent = Wallpaper.getCountryToContinent();
      const continent = countryToContinent[this.country.code];
      
      if (continent) {
        tags.push(continent);
      } else {
        console.warn(`[TAGS] Continent non trouvé pour le pays: ${this.country.code} (${this.country.text})`);
        tags.push('World'); // Fallback
      }

      // Ajouter le nom du pays
      tags.push(this.country.text);

      // Ajouter l'état si disponible
      if (this.state && this.state.text) {
        tags.push(this.state.text);
      }

      // Ajouter le tag "World" pour tous les wallpapers
      if (!tags.includes('World')) {
        tags.push('World');
      }
    } catch (error) {
      console.error('[TAGS] Erreur lors de la génération des tags:', error);
      tags.push('World', this.country.text); // Fallback minimal
    }

    return tags;
  }

  /**
   * Met à jour les tags d'un wallpaper existant
   */
  async updateTags(): Promise<void> {
    this.tags = this.generateTags();
    await this.save();
  }

  static async getAll(): Promise<Wallpaper[]> {
    return await this.find();
  }

  // Méthodes de recherche par tags
  static async getByTags(tags: string[]): Promise<Wallpaper[]> {
    const wallpapers = await this.find();
    return wallpapers.filter(wallpaper => 
      tags.some(tag => wallpaper.tags.includes(tag))
    );
  }

  static async getByContinent(continent: string): Promise<Wallpaper[]> {
    return this.getByTags([continent]);
  }

  static async getByCountry(country: string): Promise<Wallpaper[]> {
    return this.getByTags([country]);
  }

  // Méthode pour mettre à jour tous les wallpapers existants avec les tags
  static async updateAllTags(): Promise<void> {
    console.log("[UPDATE_TAGS] 🔄 Mise à jour des tags pour tous les wallpapers...");
    const wallpapers = await this.find();
    
    for (const wallpaper of wallpapers) {
      await wallpaper.updateTags();
      console.log(`[UPDATE_TAGS] ✅ Tags mis à jour pour: ${wallpaper.title} - ${wallpaper.tags.join(', ')}`);
    }
    
    console.log(`[UPDATE_TAGS] 🎉 Terminé! ${wallpapers.length} wallpapers mis à jour.`);
  }

  static async buildRandomWallpaper(): Promise<Wallpaper | null> {
    const wallpapers = await Wallpaper.getAll();

    if (wallpapers.length === 0) {
      console.log("Aucun fond d'écran trouvé");
      return null;
    }

    const randomIndex = Math.floor(Math.random() * wallpapers.length);
    const randomWallpaper = wallpapers[randomIndex];

    return randomWallpaper;
  }

  static formatWallpaperInfo(wallpaper: any): any {
    const { title, country, state, img, copyright, tags } = wallpaper;
    const region = state ? `${country.text}, ${state.text}` : country.text;

    return {
      name: title,
      countryRegion: region,
      image: img,
      copyright,
      tags: tags || [],
      country: country.text,
      state: state?.text
    };
  }
}