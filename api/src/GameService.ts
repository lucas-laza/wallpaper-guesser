import { Game, GameStatus, GameMode } from "./Game";
import { Round } from "./Round";
import { User } from "./User";
import { Wallpaper } from "./Wallpaper";
import { Party, PartyType, PartyStatus } from "./Party"; // CORRECTION: Ajouter PartyStatus

export interface GameConfig {
  roundsNumber: number;
  time: number;
  map: string;
  gamemode?: GameMode;
}

export interface GuessResult {
  roundId: number;
  relative_id: number;
  guessNumber: number;
  isCorrect: boolean;
  score: number;
  correctLocation: {
    country: any;
    state: any;
    title: string;
    tags: string[];
  };
  userGuess: {
    country: string;
  };
}

// Service pour éviter les doublons de wallpapers
export class WallpaperService {
  static async selectUniqueWallpapers(count: number, tags?: string[]): Promise<Wallpaper[]> {
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

export class GameService {
  // Génère un code unique pour une party
  static generatePartyCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Vérifie qu'un utilisateur fait partie d'un jeu
  static async verifyUserInGame(gameId: number, userId: number): Promise<Game | null> {
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ["party", "players"]
    });

    if (!game) return null;

    const isPlayerInGame = game.players.some(player => player.id === userId);
    return isPlayerInGame ? game : null;
  }

  // Crée une partie solo
  static async createSoloGame(user: User, config: GameConfig): Promise<Game> {
    const mapTags = config.map === 'World' ? [] : [config.map];
    
    // Sélectionner des wallpapers uniques
    const selectedWallpapers = await WallpaperService.selectUniqueWallpapers(config.roundsNumber, mapTags);
    const validWallpapers = selectedWallpapers.filter(WallpaperService.isWallpaperValid);
    
    if (validWallpapers.length === 0) {
      throw new Error(`No valid wallpapers available for map: ${config.map}`);
    }

    const actualRoundsNumber = Math.min(config.roundsNumber, validWallpapers.length);

    // Créer la party solo
    const party = new Party();
    party.admin = user;
    party.players = [user];
    party.code = this.generatePartyCode();
    party.type = PartyType.SOLO;
    party.status = PartyStatus.IN_PROGRESS;
    await party.save();

    // Créer le jeu
    const game = new Game();
    game.party = party;
    game.players = [user];
    game.status = GameStatus.IN_PROGRESS;
    game.gamemode = config.gamemode || GameMode.STANDARD;
    game.map = config.map;
    game.rounds_number = actualRoundsNumber;
    game.modifiers = {};
    game.winner = null;
    game.time = config.time;
    await game.save();

    // Créer les rounds
    await this.createRounds(game, party, [user], validWallpapers, actualRoundsNumber);

    return game;
  }

  // Crée une party privée
  static async createPrivateParty(admin: User, config: GameConfig): Promise<Party> {
    const party = new Party();
    party.admin = admin;
    party.players = [admin];
    party.code = this.generatePartyCode();
    party.type = PartyType.PRIVATE;
    party.status = PartyStatus.WAITING;
    party.game_config = {
      roundsNumber: config.roundsNumber,
      time: config.time,
      map: config.map,
      gamemode: config.gamemode?.toString()
    };
    await party.save();

    console.log(`[GameService] Created party ${party.id} with code ${party.code}`);
    return party;
  }

  // Permet à un joueur de rejoindre une party
  static async joinParty(partyCode: string, user: User): Promise<Party> {
    const party = await Party.findOne({
      where: { code: partyCode.toUpperCase() },
      relations: ["players", "admin"]
    });

    if (!party) {
      throw new Error("Party not found");
    }

    // Vérifier le statut de la party
    if (party.status === PartyStatus.IN_PROGRESS) {
      throw new Error("Game is already in progress");
    }

    if (party.status === PartyStatus.COMPLETED || party.status === PartyStatus.DISBANDED) {
      throw new Error("This party is no longer active");
    }

    // Vérifier si le joueur est déjà dans la party
    const isAlreadyInParty = party.players.some(player => player.id === user.id);
    if (isAlreadyInParty) {
      throw new Error("You are already in this party");
    }

    // Vérifier la limite de joueurs
    if (party.players.length >= party.max_players) {
      throw new Error("Party is full");
    }

    // Ajouter le joueur à la party
    party.players.push(user);
    await party.save();

    console.log(`[GameService] User ${user.name} joined party ${party.id}`);
    return party;
  }

  // Démarre un jeu pour une party
  static async startPartyGame(partyId: number, adminId: number, config: GameConfig): Promise<Game> {
    const party = await Party.findOne({
      where: { id: partyId },
      relations: ["players", "admin"]
    });

    if (!party) {
      throw new Error("Party not found");
    }

    if (party.admin.id !== adminId) {
      throw new Error("Only the party admin can start the game");
    }

    if (party.players.length < 2) {
      throw new Error("At least 2 players are required to start a party game");
    }

    // Vérifier s'il y a déjà un jeu en cours
    const existingGame = await Game.findOne({
      where: { party: { id: partyId }, status: GameStatus.IN_PROGRESS }
    });

    if (existingGame) {
      throw new Error("A game is already in progress for this party");
    }

    const mapTags = config.map === 'World' ? [] : [config.map];
    const selectedWallpapers = await WallpaperService.selectUniqueWallpapers(config.roundsNumber, mapTags);
    const validWallpapers = selectedWallpapers.filter(WallpaperService.isWallpaperValid);
    
    if (validWallpapers.length === 0) {
      throw new Error(`No valid wallpapers available for map: ${config.map}`);
    }

    const actualRoundsNumber = Math.min(config.roundsNumber, validWallpapers.length);

    // Mettre à jour le statut de la party
    party.status = PartyStatus.IN_PROGRESS;
    party.game_config = {
      roundsNumber: actualRoundsNumber,
      time: config.time,
      map: config.map,
      gamemode: config.gamemode?.toString()
    };
    await party.save();

    // Créer le jeu
    const game = new Game();
    game.party = party;
    game.players = party.players;
    game.status = GameStatus.IN_PROGRESS;
    game.gamemode = config.gamemode || GameMode.STANDARD;
    game.map = config.map;
    game.rounds_number = actualRoundsNumber;
    game.modifiers = {};
    game.winner = null;
    game.time = config.time;
    await game.save();

    // Créer les rounds
    await this.createRounds(game, party, party.players, validWallpapers, actualRoundsNumber);

    console.log(`[GameService] Started game ${game.id} for party ${party.id} with ${party.players.length} players`);
    return game;
  }

  // Crée les rounds pour un jeu
  private static async createRounds(
    game: Game, 
    party: Party, 
    players: User[], 
    wallpapers: Wallpaper[], 
    roundsNumber: number
  ): Promise<void> {
    for (let i = 0; i < roundsNumber; i++) {
      const wallpaper = wallpapers[i];

      const round = new Round();
      round.game = game;
      round.party = party;
      round.players = players;
      round.wallpaper = wallpaper;
      round.guesses = 0;
      round.relative_id = i + 1;
      await round.save();
      
      console.log(`Created round ${i + 1} with wallpaper: ${wallpaper.title} (ID: ${wallpaper.id}) - Tags: ${wallpaper.tags?.join(', ')}`);
    }
  }

  // Traite une réponse d'un joueur
  static async processGuess(
    gameId: number, 
    relativeId: number, 
    userId: number, 
    country: string
  ): Promise<GuessResult> {
    const round = await Round.findOne({
      where: { 
        relative_id: relativeId,
        game: { id: gameId }
      },
      relations: ["wallpaper", "game", "players"]
    });

    if (!round) {
      throw new Error("Round not found");
    }

    // Vérifier que l'utilisateur fait partie du round
    const isPlayerInRound = round.players.some(player => player.id === userId);
    if (!isPlayerInRound) {
      throw new Error("Access denied: You are not part of this round");
    }

    // Vérifier que le jeu est en cours
    if (round.game.status !== GameStatus.IN_PROGRESS) {
      throw new Error("Game is not in progress");
    }

    // Vérifier si la réponse est correcte
    const correctCountry = round.wallpaper.country.text;
    const isCorrect = country.toLowerCase().trim() === correctCountry.toLowerCase().trim();
    
    const score = isCorrect ? 1000 : 0;

    // Incrementer le nombre de tentatives
    round.guesses += 1;
    await round.save();

    return {
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
  }

  // Termine un jeu
  static async finishGame(gameId: number, userId: number): Promise<Game> {
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ["players", "party"]
    });

    if (!game) {
      throw new Error("Game not found");
    }

    // Vérifier que l'utilisateur fait partie du jeu
    const isPlayerInGame = game.players.some(player => player.id === userId);
    if (!isPlayerInGame) {
      throw new Error("Access denied: You are not part of this game");
    }

    // Pour un jeu solo, le joueur est le gagnant
    // Pour un jeu en party, il faudrait implémenter la logique de scoring
    if (game.party?.type === PartyType.SOLO) {
      const user = await User.findOneBy({ id: userId });
      if (user) {
        game.winner = user;
      }
    }

    game.status = GameStatus.COMPLETED;
    await game.save();

    return game;
  }

  // Récupère les informations d'une party
  static async getPartyInfo(partyId: number): Promise<Party | null> {
    return await Party.findOne({
      where: { id: partyId },
      relations: ["admin", "players"]
    });
  }

  // Récupère les parties d'un utilisateur
  static async getUserParties(userId: number): Promise<Party[]> {
    return await Party.find({
      where: {
        players: {
          id: userId
        }
      },
      relations: ["admin", "players"],
      order: { id: "DESC" }
    });
  }

  // Quitte une party
   static async leaveParty(partyId: number, userId: number): Promise<void> {
    const party = await Party.findOne({
      where: { id: partyId },
      relations: ["admin", "players"]
    });

    if (!party) {
      throw new Error("Party not found");
    }

    // Vérifier que l'utilisateur est dans la party
    const playerIndex = party.players.findIndex(player => player.id === userId);
    if (playerIndex === -1) {
      throw new Error("You are not in this party");
    }

    // Vérifier s'il y a un jeu en cours
    const activeGame = await Game.findOne({
      where: { party: { id: partyId }, status: GameStatus.IN_PROGRESS }
    });

    if (activeGame) {
      throw new Error("Cannot leave party while a game is in progress");
    }

    // CORRECTION: Créer un nouveau tableau sans le joueur
    const remainingPlayers = party.players.filter(player => player.id !== userId);
    party.players = remainingPlayers;

    // Si c'était l'admin et qu'il reste des joueurs, transférer l'admin
    if (party.admin.id === userId && remainingPlayers.length > 0) {
      party.admin = remainingPlayers[0];
    }

    // Si plus de joueurs, supprimer la party
    if (remainingPlayers.length === 0) {
      await party.remove();
      console.log(`[GameService] Party ${partyId} deleted - no players left`);
    } else {
      await party.save();
      console.log(`[GameService] User ${userId} left party ${partyId}, ${remainingPlayers.length} players remaining`);
    }
  }
}