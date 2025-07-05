import express from "express";
import { Game, GameStatus, GameMode } from "./Game";
import { Round } from "./Round";
import { User } from "./User";
import { Wallpaper } from "./Wallpaper";
import { Party, PartyType, PartyStatus } from "./Party";
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

// Service pour gérer les parties actives
class GameSessionService {
  static async getActiveGame(userId: number): Promise<Game | null> {
    return await Game.findOne({
      where: { 
        status: GameStatus.IN_PROGRESS,
        players: { id: userId }
      },
      relations: ["party", "players"]
    });
  }

  static async getAllActiveGames(userId: number): Promise<Game[]> {
    return await Game.find({
      where: { 
        status: GameStatus.IN_PROGRESS,
        players: { id: userId }
      },
      relations: ["party", "players"]
    });
  }

  static async forceCleanupActiveGames(userId: number): Promise<void> {
    // Nettoyer toutes les parties actives de cet utilisateur
    const activeGames = await this.getAllActiveGames(userId);
    
    for (const game of activeGames) {
      game.status = GameStatus.ABORTED;
      await game.save();
      
      if (game.party) {
        game.party.status = PartyStatus.DISBANDED;
        await game.party.save();
      }
    }
  }

  static async getCurrentRound(gameId: number, userId: number): Promise<{ round: Round | null, roundNumber: number, totalRounds: number }> {
    const rounds = await Round.find({
      where: { 
        game: { id: gameId },
        players: { id: userId }
      },
      relations: ["wallpaper"],
      order: { relative_id: "ASC" }
    });

    if (rounds.length === 0) {
      return { round: null, roundNumber: 0, totalRounds: 0 };
    }

    // Trouver le premier round sans réponse (guesses = 0) ou le dernier round
    let currentRound = rounds.find(round => round.guesses === 0);
    if (!currentRound) {
      // Si tous les rounds ont été joués, retourner le dernier
      currentRound = rounds[rounds.length - 1];
    }

    const roundNumber = currentRound.relative_id;
    const totalRounds = rounds.length;

    return { round: currentRound, roundNumber, totalRounds };
  }
}

// Vérifie s'il y a une partie active et la retourne
soloGameRouter.get("/active", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    
    const activeGame = await Game.findOne({
      where: {
        players: { id: userId },
        status: GameStatus.IN_PROGRESS
      },
      relations: ["players", "party"], // AJOUT: inclure party dans les relations
      order: { id: "DESC" }
    });

    if (!activeGame) {
      return res.json({
        hasActiveGame: false
      });
    }

    // Récupérer le round actuel
    const rounds = await Round.find({
      where: { game: { id: activeGame.id } },
      relations: ["wallpaper"],
      order: { relative_id: "ASC" }
    });

    let currentRoundNumber = 1;
    let roundData = null;

    if (rounds.length > 0) {
      // Trouver le premier round non joué ou le dernier round
      const unplayedRound = rounds.find(r => r.guesses === 0);
      if (unplayedRound) {
        currentRoundNumber = unplayedRound.relative_id;
        roundData = {
          id: unplayedRound.id,
          relative_id: unplayedRound.relative_id,
          guesses: unplayedRound.guesses,
          wallpaper: {
            id: unplayedRound.wallpaper.id,
            title: unplayedRound.wallpaper.title,
            image: unplayedRound.wallpaper.img,
            copyright: unplayedRound.wallpaper.copyright
          }
        };
      } else {
        const lastRound = rounds[rounds.length - 1];
        currentRoundNumber = lastRound.relative_id;
        roundData = {
          id: lastRound.id,
          relative_id: lastRound.relative_id,
          guesses: lastRound.guesses,
          wallpaper: {
            id: lastRound.wallpaper.id,
            title: lastRound.wallpaper.title,
            image: lastRound.wallpaper.img,
            copyright: lastRound.wallpaper.copyright
          }
        };
      }
    }

    res.json({
      hasActiveGame: true,
      gameId: activeGame.id,
      currentRound: currentRoundNumber,
      totalRounds: activeGame.rounds_number,
      map: activeGame.map,
      time: activeGame.time,
      isCompleted: false,
      partyId: activeGame.party?.id || null,
      isMultiplayer: activeGame.party ? activeGame.players.length > 1 : false,
      totalPlayers: activeGame.players.length,
      roundData: roundData
    });
  } catch (error) {
    console.error("Error checking active game:", error);
    res.status(500).json({ error: "Failed to check active game" });
  }
});

// Abandonne proprement la partie active
soloGameRouter.post("/quit", async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    
    // Nettoyer TOUTES les parties actives pour cet utilisateur (au cas où il y en aurait plusieurs)
    await GameSessionService.forceCleanupActiveGames(userId);

    res.json({ 
      message: "All active games quit successfully",
      userId: userId,
      status: "aborted"
    });
  } catch (err) {
    console.error("Error quitting game:", err);
    res.status(500).json({ error: "Failed to quit game" });
  }
});

// Crée une partie solo et les rounds associés
soloGameRouter.post("/start", async (req: AuthenticatedRequest, res) => {
  try {
    const { roundsNumber = 3, time = 60, map = 'World' } = req.body;
    const userId = req.user!.userId;

    // Vérifier s'il y a déjà des parties actives et les nettoyer d'abord
    const existingActiveGames = await GameSessionService.getAllActiveGames(userId);
    
    if (existingActiveGames.length > 0) {
      console.log(`[GAME_CREATE] Found ${existingActiveGames.length} active games for user ${userId}, cleaning up...`);
      
      // Nettoyer toutes les parties actives
      await GameSessionService.forceCleanupActiveGames(userId);
      
      // Attendre un court instant pour s'assurer que la transaction est terminée
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Double vérification après nettoyage
    const stillActiveGame = await GameSessionService.getActiveGame(userId);
    if (stillActiveGame) {
      const { round: currentRound, roundNumber, totalRounds } = await GameSessionService.getCurrentRound(stillActiveGame.id, userId);
      
      return res.status(409).json({ 
        error: "You already have an active game",
        activeGame: {
          gameId: stillActiveGame.id,
          currentRound: roundNumber,
          totalRounds: totalRounds,
          map: stillActiveGame.map,
          time: stillActiveGame.time
        }
      });
    }
    
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
    party.status = PartyStatus.IN_PROGRESS;
    await party.save();

    // Create the solo game and associate it with the party
    const game = new Game();
    game.party = party;
    game.players = [user];
    game.status = GameStatus.IN_PROGRESS;
    game.gamemode = GameMode.STANDARD;
    game.map = map;
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
      round.relative_id = i + 1;

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
      uniqueWallpapers: true,
      currentRound: 1
    });
  } catch (err) {
    console.error("Error in solo game creation:", err);
    res.status(500).json({ error: "Failed to create solo game" });
  }
});

// Reprend une partie existante (utilisé quand on revient sur le jeu)
soloGameRouter.post("/resume/:gameId", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;
    
    const game = await Game.findOne({
      where: { 
        id: parseInt(gameId),
        status: GameStatus.IN_PROGRESS,
        players: { id: userId }
      },
      relations: ["party", "players"]
    });

    if (!game) {
      return res.status(404).json({ error: "Active game not found" });
    }

    const { round: currentRound, roundNumber, totalRounds } = await GameSessionService.getCurrentRound(game.id, userId);

    if (!currentRound) {
      return res.status(404).json({ error: "No rounds found for this game" });
    }

    res.json({
      gameId: game.id,
      currentRound: roundNumber,
      totalRounds: totalRounds,
      map: game.map,
      time: game.time,
      roundData: {
        id: currentRound.id,
        relative_id: currentRound.relative_id,
        guesses: currentRound.guesses,
        wallpaper: {
          id: currentRound.wallpaper.id,
          title: currentRound.wallpaper.title,
          image: currentRound.wallpaper.img,
          copyright: currentRound.wallpaper.copyright
        }
      }
    });
  } catch (err) {
    console.error("Error resuming game:", err);
    res.status(500).json({ error: "Failed to resume game" });
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
      order: { relative_id: "ASC" }
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
    const { country } = req.body;
    const userId = req.user!.userId;

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

    // Vérifier si ce round a déjà été joué
    if (round.guesses > 0) {
      return res.status(400).json({ error: "This round has already been played" });
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

// Termine un jeu
soloGameRouter.post("/game/:gameId/finish", async (req: AuthenticatedRequest, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user!.userId;

    const game = await Game.findOne({
      where: { id: parseInt(gameId) },
      relations: ["players", "party"]
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

    // Marquer la party comme terminée
    if (game.party) {
      game.party.status = PartyStatus.COMPLETED;
      await game.party.save();
    }

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