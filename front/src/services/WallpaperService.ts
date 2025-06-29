// services/WallpaperService.ts
import { Wallpaper } from "../Wallpaper"

export class WallpaperService {
  
  /**
   * Sélectionne des wallpapers uniques pour une partie
   * @param count Nombre de wallpapers à sélectionner
   * @param excludeIds IDs des wallpapers à exclure (optionnel)
   * @returns Array de wallpapers uniques
   */
  static async selectUniqueWallpapers(count: number, excludeIds: number[] = []): Promise<Wallpaper[]> {
    // Récupérer tous les wallpapers disponibles
    let availableWallpapers = await Wallpaper.find();
    
    // Exclure les wallpapers déjà utilisés
    if (excludeIds.length > 0) {
      availableWallpapers = availableWallpapers.filter(w => !excludeIds.includes(w.id));
    }
    
    if (availableWallpapers.length === 0) {
      throw new Error('No wallpapers available');
    }
    
    // Si on demande plus de wallpapers qu'il n'y en a de disponibles
    if (count > availableWallpapers.length) {
      console.warn(`Requested ${count} wallpapers but only ${availableWallpapers.length} available`);
      // Retourner tous les wallpapers disponibles
      return this.shuffleArray([...availableWallpapers]);
    }
    
    // Mélanger et sélectionner le nombre demandé
    const shuffled = this.shuffleArray([...availableWallpapers]);
    return shuffled.slice(0, count);
  }
  
  /**
   * Sélectionne des wallpapers uniques pour une partie en évitant les récents
   * @param count Nombre de wallpapers à sélectionner
   * @param userId ID de l'utilisateur pour éviter les wallpapers récemment joués
   * @returns Array de wallpapers uniques
   */
  static async selectUniqueWallpapersForUser(count: number, userId: number): Promise<Wallpaper[]> {
    // TODO: Implémenter la logique pour éviter les wallpapers récemment joués par l'utilisateur
    // Pour l'instant, on utilise la méthode simple
    return this.selectUniqueWallpapers(count);
  }
  
  /**
   * Mélange un array en utilisant l'algorithme Fisher-Yates
   * @param array Array à mélanger
   * @returns Array mélangé
   */
  private static shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  
  /**
   * Vérifie si un wallpaper a toutes les données nécessaires pour être utilisé en jeu
   * @param wallpaper Wallpaper à vérifier
   * @returns true si le wallpaper est valide
   */
  static isWallpaperValid(wallpaper: Wallpaper): boolean {
    return !!(
      wallpaper &&
      wallpaper.id &&
      wallpaper.title &&
      wallpaper.img &&
      wallpaper.coords &&
      wallpaper.coords.lat &&
      wallpaper.coords.lon &&
      wallpaper.country
    );
  }
  
  /**
   * Filtre les wallpapers pour ne garder que ceux qui sont valides pour le jeu
   * @param wallpapers Array de wallpapers à filter
   * @returns Array de wallpapers valides
   */
  static filterValidWallpapers(wallpapers: Wallpaper[]): Wallpaper[] {
    return wallpapers.filter(this.isWallpaperValid);
  }
}