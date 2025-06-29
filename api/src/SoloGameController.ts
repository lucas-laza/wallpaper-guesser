import express from "express";
import { Game, GameStatus, GameMode } from "./Game";
import { Round } from "./Round";
import { User } from "./User";
import { Wallpaper } from "./Wallpaper";
import { Party, PartyType } from "./Party";
import { authenticateToken, AuthenticatedRequest } from "./auth-middleware";

export const soloGameRouter = express.Router();

// Appliquer le middleware d'authentification à toutes les routes
soloGameRouter.use(authenticateToken);

// Service simple pour éviter les doublons de wallpapers
class WallpaperService {
  static async selectUniqueWallpapers(count: number, tags?: string[]): Promise<Wallpaper[]> {
    // Récupérer les wallpapers filtrés par tags si spécifiés
    let allWallpapers: Wallpaper[];
    
    if (tags && tags.length > 0) {
      allWallpapers = await Wallpaper.getByTags(tags);
    } else {
      allWallpapers = await Wallpaper.find();
    }
    
    if (allWallpapers.length === 0) {
      throw new Error('No wallpapers available');
    }
    
    // Mélanger les wallpapers avec Fisher-Yates
    const shuffled = [...allWallpapers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // Retourner le nombre demandé (ou tous si pas assez)
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
  
  static isWallpaperValid(wallpaper: Wallpaper): boolean {
    return !!(
      wallpaper &&
      wallpaper.id &&
      wallpaper.title &&
      wallpaper.img &&
      wallpaper.country &&
      wallpaper.country.text &&
      wallpaper.tags &&
      wallpaper.tags.length > 0
    );
  }
}

// Crée une partie solo et les rounds associés
soloGameRouter.post("/start", async (req: AuthenticatedRequest, res) => {
  try {
    const { roundsNumber = 3, time = 60, map = 'World' } = req.body; // Changé region en map
    
    // Récupérer l'utilisateur depuis le token (middleware)
    const userId = req.user!.userId;

    const user = await User.findOneBy({ id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Convertir la map en tags pour filtrer les wallpapers
    const mapTags = map === 'World' ? [] : [map];

    console.log(`[GAME_CREATE] Creating game for map: ${map}, tags: ${mapTags.join(', ')}`);

    // Sélectionner des wallpapers uniques pour cette partie
    let selectedWallpapers: Wallpaper[];
    try {
      selectedWallpapers = await WallpaperService.selectUniqueWallpapers(roundsNumber, mapTags);
      console.log(`[GAME_CREATE] Found ${selectedWallpapers.length} wallpapers for map ${map}`);
    } catch (wallpaperError) {
      console.error("Error selecting wallpapers:", wallpaperError);
      return res.status(500).json({ error: `No wallpapers available for map: ${map}` });
    }

    // Vérifier que tous les wallpapers sélectionnés sont valides
    const validWallpapers = selectedWallpapers.filter(WallpaperService.isWallpaperValid);
    
    if (validWallpapers.length === 0) {
      return res.status(500).json({ error: `No valid wallpapers available for map: ${map}` });
    }

    // Ajuster le nombre de rounds si nécessaire
    const actualRoundsNumber = Math.min(roundsNumber, validWallpapers.length);

    if (actualRoundsNumber < roundsNumber) {
      console.warn(`Only ${validWallpapers.length} valid wallpapers available for ${roundsNumber} rounds in map ${map}`);
    }

    // Create the solo party
    const party = new Party();
    party.admin = user;
    party.players = [user];
    party.code = Math.random().toString(36).substring(2, 10);
    party.type = PartyType.SOLO;
    await party.save();

    // Create the solo game and associate it with the party
    const game = new Game();
    game.party = party;
    game.players = [user];
    game.status = GameStatus.IN_PROGRESS;
    game.gamemode = GameMode.STANDARD;
    game.map = map; // Stocker la map sélectionnée
    game.rounds_number = actualRoundsNumber;
    game.modifiers = {};
    game.winner = null;
    game.time = time;

    await game.save();

    // Create rounds for the game with selected wallpapers
    for (let i = 0; i < actualRoundsNumber; i++) {
      const wallpaper = validWallpapers[i];

      const round = new Round();
      round.game = game;
      round.party = party;
      round.players = [user];
      round.wallpaper = wallpaper;
      round.guesses = 0;
      round.relative_id = i + 1; // 1, 2, 3, etc.

      await round.save();
      
      console.log(`Created round ${i + 1} with wallpaper: ${wallpaper.title} (ID: ${wallpaper.id}) - Tags: ${wallpaper.tags?.join(', ')}`);
    }

    res.json({ 
      gameId: game.id,
      user: {
        id: user.id,
        name: user.name
      },
      roundsNumber: actualRoundsNumber,
      time: time,
      map: map,
      wallpapersSelected: validWallpapers.length,
      uniqueWallpapers: true
    });
  } catch (err) {
    console.error("Error in solo game creation:", err);
    res.status(500).json({ error: "Failed to create solo game" });
  }
});

// Récupère les informations d'un jeu
soloGameRouter.get("/game/:gameId", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;
    
    const game = await Game.findOne({
      where: { id: parseInt(gameId) },
      relations: ["party", "players"]
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Vérifier que l'utilisateur fait partie du jeu
    const isPlayerInGame = game.players.some(player => player.id === userId);
    if (!isPlayerInGame) {
      return res.status(403).json({ error: "Access denied: You are not part of this game" });
    }

    res.json(game);
  } catch (err) {
    console.error("Error fetching game:", err);
    res.status(500).json({ error: "Failed to fetch game" });
  }
});

// Récupère tous les rounds d'un jeu
soloGameRouter.get("/game/:gameId/rounds", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;
    
    const rounds = await Round.find({
      where: { game: { id: parseInt(gameId) } },
      relations: ["wallpaper", "players", "game"],
      order: { relative_id: "ASC" } // Trier par relative_id au lieu de id
    });

    if (rounds.length === 0) {
      return res.status(404).json({ error: "No rounds found for this game" });
    }

    // Vérifier que l'utilisateur fait partie du jeu
    const isPlayerInGame = rounds[0].game.players?.some((player: any) => player.id === userId);
    if (!isPlayerInGame) {
      return res.status(403).json({ error: "Access denied: You are not part of this game" });
    }

    // Formater les rounds pour le frontend
    const formattedRounds = rounds.map(round => ({
      id: round.id,
      relative_id: round.relative_id,
      guesses: round.guesses,
      wallpaper: {
        id: round.wallpaper.id,
        title: round.wallpaper.title,
        image: round.wallpaper.img,
        copyright: round.wallpaper.copyright,
        country: round.wallpaper.country,
        state: round.wallpaper.state,
        tags: round.wallpaper.tags
      }
    }));

    res.json(formattedRounds);
  } catch (err) {
    console.error("Error fetching rounds:", err);
    res.status(500).json({ error: "Failed to fetch rounds" });
  }
});

// Récupère un round spécifique par son relative_id
soloGameRouter.get("/game/:gameId/round/:relativeId", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId, relativeId } = req.params;
    
    const round = await Round.findOne({
      where: { 
        relative_id: parseInt(relativeId),
        game: { id: parseInt(gameId) }
      },
      relations: ["wallpaper", "players", "game"]
    });

    if (!round) {
      return res.status(404).json({ error: "Round not found" });
    }

    // Formater pour le jeu (sans révéler la réponse)
    const roundData = {
      id: round.id,
      relative_id: round.relative_id,
      guesses: round.guesses,
      wallpaper: {
        id: round.wallpaper.id,
        title: round.wallpaper.title,
        image: round.wallpaper.img,
        copyright: round.wallpaper.copyright,
        // Ne pas révéler les coordonnées et la localisation pendant le jeu
        // country: round.wallpaper.country,
        // state: round.wallpaper.state,
        // tags: round.wallpaper.tags
      }
    };

    res.json(roundData);
  } catch (err) {
    console.error("Error fetching round:", err);
    res.status(500).json({ error: "Failed to fetch round" });
  }
});

// Soumet une réponse pour un round (par relative_id) - Maintenant avec guess de pays
soloGameRouter.post("/game/:gameId/round/:relativeId/guess", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId, relativeId } = req.params;
    const { country } = req.body; // Maintenant on reçoit le nom du pays au lieu des coordonnées
    const userId = req.user!.userId; // Récupéré depuis le token

    if (!country) {
      return res.status(400).json({ error: "Missing required field: country" });
    }

    const round = await Round.findOne({
      where: { 
        relative_id: parseInt(relativeId),
        game: { id: parseInt(gameId) }
      },
      relations: ["wallpaper", "game", "players"]
    });

    if (!round) {
      return res.status(404).json({ error: "Round not found" });
    }

    // Vérifier que l'utilisateur fait partie du round
    const isPlayerInRound = round.players.some(player => player.id === userId);
    if (!isPlayerInRound) {
      return res.status(403).json({ error: "Access denied: You are not part of this round" });
    }

    // Vérifier que le jeu est en cours
    if (round.game.status !== GameStatus.IN_PROGRESS) {
      return res.status(400).json({ error: "Game is not in progress" });
    }

    // Vérifier si la réponse est correcte
    const correctCountry = round.wallpaper.country.text;
    const isCorrect = country.toLowerCase().trim() === correctCountry.toLowerCase().trim();
    
    // Système de points basé sur la justesse de la réponse
    const score = isCorrect ? 1000 : 0;

    // Incrementer le nombre de tentatives
    round.guesses += 1;
    await round.save();

    // Révéler la bonne réponse
    const result = {
      roundId: round.id,
      relative_id: round.relative_id,
      guessNumber: round.guesses,
      isCorrect: isCorrect,
      score: score,
      correctLocation: {
        country: round.wallpaper.country,
        state: round.wallpaper.state,
        title: round.wallpaper.title,
        tags: round.wallpaper.tags
      },
      userGuess: {
        country: country
      }
    };

    res.json(result);
  } catch (err) {
    console.error("Error processing guess:", err);
    res.status(500).json({ error: "Failed to process guess" });
  }
});

// Termine un jeu - Supprime userId du body
soloGameRouter.post("/game/:gameId/finish", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId; // Récupéré depuis le token

    const game = await Game.findOne({
      where: { id: parseInt(gameId) },
      relations: ["players"]
    });

    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Vérifier que l'utilisateur fait partie du jeu
    const isPlayerInGame = game.players.some(player => player.id === userId);
    if (!isPlayerInGame) {
      return res.status(403).json({ error: "Access denied: You are not part of this game" });
    }

    // Marquer le jeu comme terminé
    game.status = GameStatus.COMPLETED;
    
    // Pour un jeu solo, le joueur est toujours le gagnant
    const user = await User.findOneBy({ id: userId });
    if (user) {
      game.winner = user;
    }

    await game.save();

    res.json({ 
      message: "Game finished successfully",
      gameId: game.id,
      status: game.status,
      winner: {
        id: game.winner?.id,
        name: game.winner?.name
      }
    });
  } catch (err) {
    console.error("Error finishing game:", err);
    res.status(500).json({ error: "Failed to finish game" });
  }
});