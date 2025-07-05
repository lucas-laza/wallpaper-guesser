import { Game, GameStatus, GameMode } from "./Game";
import { Round } from "./Round";
import { User } from "./User";
import { Wallpaper } from "./Wallpaper";
import { Party, PartyType, PartyStatus } from "./Party";
import { Guess } from "./Guess";

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

export interface GameStateSync {
  gameId: number;
  currentRound: number;
  lastCompletedRound: number;
  playersWhoFinished: Set<number>;
  playersWhoFinishedLastRound: Set<number>;
  playersReady: Set<number>;
  allPlayersFinished: boolean;
  roundResults: Map<number, GuessResult>;
  lastActivity: Date;
}

export interface SyncGuessResult extends GuessResult {
  roundComplete: boolean;
  waitingPlayers: number;
  totalPlayers: number;
}

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
  private static gameStates: Map<number, GameStateSync> = new Map();
  private static cleanupInterval: NodeJS.Timeout | null = null;

  static {
    this.startCleanupInterval();
  }

  private static startCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldGameStates();
    }, 5 * 60 * 1000);
  }

  private static cleanupOldGameStates() {
    const now = new Date();
    const maxAge = 30 * 60 * 1000;
    
    for (const [gameId, gameState] of this.gameStates.entries()) {
      if (now.getTime() - gameState.lastActivity.getTime() > maxAge) {
        console.log(`[GameService] Cleaning up old game state for game ${gameId}`);
        this.gameStates.delete(gameId);
      }
    }
  }

  static generatePartyCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  static async verifyUserInGame(gameId: number, userId: number): Promise<Game | null> {
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ["party", "players"]
    });

    if (!game) return null;

    const isPlayerInGame = game.players.some(player => player.id === userId);
    return isPlayerInGame ? game : null;
  }


  static initializeGameSync(gameId: number): GameStateSync {
    if (this.gameStates.has(gameId)) {
      console.log(`[GameService] ⚠️ Replacing existing sync state for game ${gameId}`);
      const existingState = this.gameStates.get(gameId)!;
      console.log(`[GameService] 📊 Previous state: round ${existingState.currentRound}, finished: ${existingState.playersWhoFinished.size}, ready: ${existingState.playersReady.size}`);
    }

    const gameState: GameStateSync = {
      gameId,
      currentRound: 1,
      lastCompletedRound: 0, // NOUVEAU: Aucun round complété au début
      playersWhoFinished: new Set(),
      playersWhoFinishedLastRound: new Set(), // NOUVEAU: Vide au début
      playersReady: new Set(),
      allPlayersFinished: false,
      roundResults: new Map(),
      lastActivity: new Date()
    };
    
    this.gameStates.set(gameId, gameState);
    console.log(`[GameService] ✅ Initialized clean sync state for game ${gameId}`);
    return gameState;
  }

  static async diagnoseGameState(gameId: number): Promise<void> {
    console.log(`[GameService] 🔍 Diagnosing game state for game ${gameId}`);
    
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ['players']
    });

    if (!game) {
      console.error(`[GameService] Game ${gameId} not found`);
      return;
    }

    console.log(`[GameService] Game ${gameId} info:`);
    console.log(`  - Status: ${game.status}`);
    console.log(`  - Total rounds: ${game.rounds_number}`);
    console.log(`  - Players: [${game.players.map(p => `${p.name}(${p.id})`).join(', ')}]`);

    // Vérifier les guesses de chaque joueur
    for (const player of game.players) {
      const guesses = await Guess.find({
        where: {
          game: { id: gameId },
          user: { id: player.id }
        },
        relations: ['round'],
        order: { id: 'ASC' }
      });

      console.log(`[GameService] Player ${player.name}(${player.id}): ${guesses.length} guesses`);
      guesses.forEach(guess => {
        console.log(`  - Round ${guess.round.relative_id}: ${guess.country_code} (${guess.is_correct ? 'correct' : 'incorrect'})`);
      });
    }

    // État GameService
    const gameServiceState = this.getGameSync(gameId);
    if (gameServiceState) {
      console.log(`[GameService] GameService state:`);
      console.log(`  - Current round: ${gameServiceState.currentRound}`);
      console.log(`  - Players finished: [${Array.from(gameServiceState.playersWhoFinished).join(', ')}]`);
      console.log(`  - Players ready: [${Array.from(gameServiceState.playersReady).join(', ')}]`);
      console.log(`  - All finished: ${gameServiceState.allPlayersFinished}`);
    } else {
      console.log(`[GameService] No GameService state found`);
    }
  }

  static getGameSync(gameId: number): GameStateSync | null {
    const gameState = this.gameStates.get(gameId);
    if (gameState) {
      gameState.lastActivity = new Date();
    }
    return gameState || null;
  }

  static async syncGameStateWithDatabase(gameId: number): Promise<void> {
    console.log(`[GameService] 🔄 Syncing game state with database for game ${gameId}`);
    
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ['players']
    });

    if (!game) {
      console.error(`[GameService] ❌ Game ${gameId} not found for sync`);
      throw new Error(`Game ${gameId} not found`);
    }

    let gameState = this.gameStates.get(gameId);
    if (!gameState) {
      console.log(`[GameService] 🆕 Creating new game state for game ${gameId}`);
      gameState = this.initializeGameSync(gameId);
    }

    // Analyser les réponses soumises pour déterminer l'état actuel
    const playerCompletionStatus = await Promise.all(
      game.players.map(async (player) => {
        const guessCount = await Guess.count({
          where: {
            game: { id: gameId },
            user: { id: player.id }
          }
        });
        return { playerId: player.id, guessCount };
      })
    );

    console.log(`[GameService] 📊 Player completion status for game ${gameId}:`, playerCompletionStatus);

    const minGuessCount = Math.min(...playerCompletionStatus.map(p => p.guessCount));
    const maxGuessCount = Math.max(...playerCompletionStatus.map(p => p.guessCount));
    
    // CORRECTION CRITIQUE: Gérer les rounds complétés vs le round actuel
    const lastCompletedRound = minGuessCount; // Le dernier round que TOUS les joueurs ont terminé
    const currentRound = Math.min(lastCompletedRound + 1, game.rounds_number);
    
    gameState.lastCompletedRound = lastCompletedRound;
    gameState.currentRound = currentRound;
    
    // Réinitialiser les états
    gameState.playersWhoFinished.clear();
    gameState.playersWhoFinishedLastRound.clear();
    
    // NOUVEAU: Marquer tous les joueurs comme ayant fini le dernier round complété
    if (lastCompletedRound > 0) {
      game.players.forEach(player => {
        gameState!.playersWhoFinishedLastRound.add(player.id);
      });
    }
    
    // Marquer les joueurs qui ont fini le round actuel
    playerCompletionStatus.forEach(({ playerId, guessCount }) => {
      if (guessCount >= currentRound) {
        gameState!.playersWhoFinished.add(playerId);
      }
    });

    // Déterminer si tous les joueurs ont fini le round actuel
    const allPlayersFinished = gameState.playersWhoFinished.size === game.players.length;
    gameState.allPlayersFinished = allPlayersFinished;
    gameState.lastActivity = new Date();

    console.log(`[GameService] ✅ Synced game ${gameId}:`);
    console.log(`  - Last completed round: ${lastCompletedRound}`);
    console.log(`  - Current round: ${currentRound}/${game.rounds_number}`);
    console.log(`  - Players finished current round: ${gameState.playersWhoFinished.size}/${game.players.length}`);
    console.log(`  - Players finished last round: ${gameState.playersWhoFinishedLastRound.size}/${game.players.length}`);
    console.log(`  - All players finished current: ${allPlayersFinished}`);
    console.log(`  - Min/Max guess counts: ${minGuessCount}/${maxGuessCount}`);
  }


  static async hasPlayerFinishedRound(gameId: number, playerId: number, roundNumber: number): Promise<boolean> {
    if (roundNumber <= 0) return true; // Les rounds <= 0 sont considérés comme "finis"
    
    try {
      const guessCount = await Guess.count({
        where: {
          game: { id: gameId },
          user: { id: playerId }
        }
      });
      
      const hasFinished = guessCount >= roundNumber;
      console.log(`[GameService] Player ${playerId} finished status for round ${roundNumber}: ${hasFinished} (${guessCount} guesses total)`);
      
      return hasFinished;
    } catch (err) {
      console.error(`[GameService] Error checking if player ${playerId} finished round ${roundNumber}:`, err);
      return false;
    }
  }


  static async markPlayerFinishedRound(gameId: number, userId: number): Promise<{ 
    allPlayersFinished: boolean; 
    waitingPlayers: number; 
    totalPlayers: number;
  }> {
    let gameState = this.gameStates.get(gameId);
    if (!gameState) {
      console.log(`[GameService] 🔄 Game state not found, syncing with database for game ${gameId}`);
      await this.syncGameStateWithDatabase(gameId);
      gameState = this.gameStates.get(gameId);
      if (!gameState) {
        throw new Error('Game state not found after sync');
      }
    }

    // Vérifier si le joueur était déjà marqué comme fini
    if (gameState.playersWhoFinished.has(userId)) {
      console.log(`[GameService] ℹ️ Player ${userId} already marked as finished for game ${gameId}`);
    } else {
      gameState.playersWhoFinished.add(userId);
      console.log(`[GameService] ✅ Player ${userId} marked as finished for round ${gameState.currentRound}`);
    }
    
    // Récupérer les informations du jeu pour connaître le nombre total de joueurs
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ['players']
    });
    
    if (!game) {
      throw new Error('Game not found');
    }

    const totalPlayers = game.players.length;
    const playersFinished = gameState.playersWhoFinished.size;
    const allPlayersFinished = playersFinished === totalPlayers;
    
    if (allPlayersFinished) {
      gameState.allPlayersFinished = true;
      console.log(`[GameService] 🎉 All players finished round ${gameState.currentRound} for game ${gameId}`);
    }

    gameState.lastActivity = new Date();

    const waitingPlayers = totalPlayers - playersFinished;
    
    console.log(`[GameService] 📊 Round ${gameState.currentRound} progress: ${playersFinished}/${totalPlayers} finished`);

    return {
      allPlayersFinished,
      waitingPlayers,
      totalPlayers
    };
  }

  static async moveToNextRound(gameId: number): Promise<void> {
    const gameState = this.gameStates.get(gameId);
    if (!gameState) {
      console.error(`[GameService] ❌ Game state not found for game ${gameId}`);
      throw new Error('Game state not found');
    }

    const game = await Game.findOne({
      where: { id: gameId },
      relations: ['players']
    });

    if (!game) {
      console.error(`[GameService] ❌ Game not found in database: ${gameId}`);
      throw new Error('Game not found');
    }

    console.log(`[GameService] 🔄 Moving to next round for game ${gameId}`);
    console.log(`  - Current round: ${gameState.currentRound}`);
    console.log(`  - Last completed round: ${gameState.lastCompletedRound}`);
    
    // CORRECTION: Marquer le round actuel comme complété
    const previousRound = gameState.currentRound;
    gameState.lastCompletedRound = previousRound;
    gameState.currentRound++;
    
    // Déplacer les joueurs qui avaient fini vers "finished last round"
    gameState.playersWhoFinishedLastRound = new Set(gameState.playersWhoFinished);
    gameState.playersWhoFinished.clear();
    
    gameState.playersReady.clear();
    gameState.allPlayersFinished = false;
    gameState.roundResults.clear();
    gameState.lastActivity = new Date();
    
    console.log(`[GameService] ✅ Moved from round ${previousRound} to round ${gameState.currentRound} for game ${gameId}`);
    console.log(`  - Last completed round updated to: ${gameState.lastCompletedRound}`);
    console.log(`  - Players who finished last round: [${Array.from(gameState.playersWhoFinishedLastRound).join(', ')}]`);
    console.log(`[GameService] 🧹 Cleared ready and finished states for new round`);
  }

  static markPlayerReady(gameId: number, userId: number): { allPlayersReady: boolean } {
    console.log(`[GameService] 🎯 Marking player ${userId} as ready for game ${gameId}`);
    
    let gameState = this.gameStates.get(gameId);
    if (!gameState) {
      console.warn(`[GameService] ⚠️ Game state not found for game ${gameId}, attempting to sync with database`);
      
      gameState = this.initializeGameSync(gameId);
      
      this.syncGameStateWithDatabase(gameId).catch(err => {
        console.error(`[GameService] ❌ Error during background sync:`, err);
      });
    }

    const wasAlreadyReady = gameState.playersReady.has(userId);
    
    if (!wasAlreadyReady) {
      gameState.playersReady.add(userId);
      console.log(`[GameService] ✅ Player ${userId} marked as ready`);
    } else {
      console.log(`[GameService] ℹ️ Player ${userId} was already ready`);
    }

    gameState.lastActivity = new Date();
    
    // CORRECTION CRITIQUE: Vérifier si le joueur peut être ready
    // Un joueur peut être ready s'il a fini le dernier round complété OU le round actuel
    const playerCanBeReady = gameState.playersWhoFinishedLastRound.has(userId) || 
                            gameState.playersWhoFinished.has(userId);
    
    if (!playerCanBeReady) {
      console.warn(`[GameService] ⚠️ Player ${userId} marked as ready but hasn't finished required rounds`);
    }
    
    // CORRECTION: Calculer si tous les joueurs qui PEUVENT être ready sont ready
    const eligiblePlayers = new Set([
      ...gameState.playersWhoFinishedLastRound,
      ...gameState.playersWhoFinished
    ]);
    
    const playersWhoAreReady = gameState.playersReady.size;
    const allPlayersReady = eligiblePlayers.size > 0 && playersWhoAreReady === eligiblePlayers.size;

    console.log(`[GameService] 📊 Ready Status Check:`);
    console.log(`  - Eligible players (finished last or current): ${eligiblePlayers.size}`);
    console.log(`  - Players ready: ${playersWhoAreReady}`);
    console.log(`  - All eligible players ready: ${allPlayersReady}`);
    console.log(`  - Last completed round: ${gameState.lastCompletedRound}`);
    console.log(`  - Current round: ${gameState.currentRound}`);
    console.log(`  - Players finished last round: [${Array.from(gameState.playersWhoFinishedLastRound).join(', ')}]`);
    console.log(`  - Players finished current: [${Array.from(gameState.playersWhoFinished).join(', ')}]`);
    console.log(`  - Players ready: [${Array.from(gameState.playersReady).join(', ')}]`);

    return { allPlayersReady };
  }

  static getRoundResults(gameId: number): Map<number, GuessResult> {
    const gameState = this.gameStates.get(gameId);
    return gameState?.roundResults || new Map();
  }

  static cleanupGameSync(gameId: number): void {
    const gameState = this.gameStates.get(gameId);
    if (gameState) {
      this.gameStates.delete(gameId);
      console.log(`[GameService] Cleaned up sync state for game ${gameId}`);
    } else {
      console.warn(`[GameService] Attempted to cleanup non-existent game state for game ${gameId}`);
    }
  }

  static async createSoloGame(user: User, config: GameConfig): Promise<Game> {
    const mapTags = config.map === 'World' ? [] : [config.map];
    
    const selectedWallpapers = await WallpaperService.selectUniqueWallpapers(config.roundsNumber, mapTags);
    const validWallpapers = selectedWallpapers.filter(WallpaperService.isWallpaperValid);
    
    if (validWallpapers.length === 0) {
      throw new Error(`No valid wallpapers available for map: ${config.map}`);
    }

    const actualRoundsNumber = Math.min(config.roundsNumber, validWallpapers.length);

    const party = new Party();
    party.admin = user;
    party.players = [user];
    party.code = this.generatePartyCode();
    party.type = PartyType.SOLO;
    party.status = PartyStatus.IN_PROGRESS;
    await party.save();

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

    await this.createRounds(game, party, [user], validWallpapers, actualRoundsNumber);

    return game;
  }

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

  static async joinParty(partyCode: string, user: User): Promise<Party> {
    const party = await Party.findOne({
      where: { code: partyCode.toUpperCase() },
      relations: ["players", "admin"]
    });

    if (!party) {
      throw new Error("Party not found");
    }

    if (party.status === PartyStatus.IN_PROGRESS) {
      throw new Error("Game is already in progress");
    }

    if (party.status === PartyStatus.COMPLETED || party.status === PartyStatus.DISBANDED) {
      throw new Error("This party is no longer active");
    }

    const isAlreadyInParty = party.players.some(player => player.id === user.id);
    if (isAlreadyInParty) {
      throw new Error("You are already in this party");
    }

    if (party.players.length >= party.max_players) {
      throw new Error("Party is full");
    }

    party.players.push(user);
    await party.save();

    console.log(`[GameService] User ${user.name} joined party ${party.id}`);
    return party;
  }

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

    party.status = PartyStatus.IN_PROGRESS;
    party.game_config = {
      roundsNumber: actualRoundsNumber,
      time: config.time,
      map: config.map,
      gamemode: config.gamemode?.toString()
    };
    await party.save();

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

    await this.createRounds(game, party, party.players, validWallpapers, actualRoundsNumber);

    if (party.players.length > 1) {
      this.initializeGameSync(game.id);
    }

    console.log(`[GameService] Started game ${game.id} for party ${party.id} with ${party.players.length} players`);
    return game;
  }

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
      relations: ["wallpaper", "game", "players", "party"]
    });

    if (!round) {
      throw new Error("Round not found");
    }

    const isPlayerInRound = round.players.some(player => player.id === userId);
    if (!isPlayerInRound) {
      throw new Error("Access denied: You are not part of this round");
    }

    if (round.game.status !== GameStatus.IN_PROGRESS) {
      throw new Error("Game is not in progress");
    }

    const correctCountry = round.wallpaper.country.text;
    const isCorrect = country.toLowerCase().trim() === correctCountry.toLowerCase().trim();
    
    const score = isCorrect ? 1000 : 0;

    const user = await User.findOneBy({ id: userId });
    if (!user) {
      throw new Error("User not found");
    }

    const guess = new Guess();
    guess.user = user;
    guess.round = round;
    guess.game = round.game;
    
    if (!round.party) {
      throw new Error("Round party is required but not found");
    }
    guess.party = round.party;
    guess.country_code = country;
    guess.is_correct = isCorrect;
    guess.score = score;
    await guess.save();

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

  static async processGuessWithSync(
    gameId: number,
    relativeId: number,
    userId: number,
    country: string
  ): Promise<SyncGuessResult> {
    // Vérifier si le joueur a déjà soumis une réponse pour ce round
    const existingGuess = await Guess.findOne({
      where: {
        game: { id: gameId },
        round: { relative_id: relativeId },
        user: { id: userId }
      }
    });

    if (existingGuess) {
      console.warn(`[GameService] ⚠️ Player ${userId} already submitted guess for round ${relativeId} in game ${gameId}`);
      throw new Error("You have already submitted a guess for this round");
    }

    // Traiter la réponse normalement
    const guessResult = await this.processGuess(gameId, relativeId, userId, country);
    
    // Marquer le joueur comme ayant fini le round
    const syncResult = await this.markPlayerFinishedRound(gameId, userId);
    
    // Sauvegarder le résultat dans l'état de synchronisation
    const gameState = this.gameStates.get(gameId);
    if (gameState) {
      gameState.roundResults.set(userId, guessResult);
      gameState.lastActivity = new Date();
      
      console.log(`[GameService] 💾 Saved guess result for player ${userId} in game ${gameId}`);
      console.log(`[GameService] 📊 Round status: ${gameState.playersWhoFinished.size}/${syncResult.totalPlayers} finished`);
    } else {
      console.warn(`[GameService] ⚠️ No game state found to save result for game ${gameId}`);
    }

    return {
      ...guessResult,
      roundComplete: syncResult.allPlayersFinished,
      waitingPlayers: syncResult.waitingPlayers,
      totalPlayers: syncResult.totalPlayers
    };
  }

  static async checkAllPlayersFinishedGame(gameId: number): Promise<boolean> {
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ['players']
    });
    
    if (!game) return false;
    
    const totalRounds = game.rounds_number;
    const playerIds = game.players.map(p => p.id);
    
    const playerGuessesCount = await Promise.all(
      playerIds.map(async (playerId) => {
        const guessCount = await Guess.count({
          where: {
            game: { id: gameId },
            user: { id: playerId }
          }
        });
        return { playerId, guessCount };
      })
    );
    
    return playerGuessesCount.every(({ guessCount }) => guessCount === totalRounds);
  }

  static async finishGameIfAllPlayersReady(gameId: number): Promise<{
    canFinish: boolean;
    game?: Game;
    playersStillPlaying: number;
  }> {
    const allPlayersFinished = await this.checkAllPlayersFinishedGame(gameId);
    
    if (allPlayersFinished) {
      const game = await this.finishGame(gameId);
      this.cleanupGameSync(gameId);
      
      return {
        canFinish: true,
        game,
        playersStillPlaying: 0
      };
    } else {
      const game = await Game.findOne({
        where: { id: gameId },
        relations: ['players']
      });
      
      if (!game) {
        throw new Error('Game not found');
      }
      
      const totalPlayers = game.players.length;
      const playerGuessesCount = await Promise.all(
        game.players.map(async (player) => {
          const guessCount = await Guess.count({
            where: {
              game: { id: gameId },
              user: { id: player.id }
            }
          });
          return guessCount;
        })
      );
      
      const playersWhoFinished = playerGuessesCount.filter(count => count === game.rounds_number).length;
      
      return {
        canFinish: false,
        playersStillPlaying: totalPlayers - playersWhoFinished
      };
    }
  }

  static async finishGame(gameId: number, userId?: number): Promise<Game> {
    const game = await Game.findOne({
      where: { id: gameId },
      relations: ["players", "party"]
    });

    if (!game) {
      throw new Error("Game not found");
    }

    if (userId) {
      const isPlayerInGame = game.players.some(player => player.id === userId);
      if (!isPlayerInGame) {
        throw new Error("Access denied: You are not part of this game");
      }
    }

    const playerScores = await Promise.all(
      game.players.map(async (player) => {
        const guesses = await Guess.find({
          where: {
            game: { id: gameId },
            user: { id: player.id }
          }
        });
        
        const totalScore = guesses.reduce((sum, guess) => {
          return sum + (guess.is_correct ? 1000 : 0);
        }, 0);
        
        return { player, totalScore };
      })
    );

    const winner = playerScores.reduce((prev, current) => 
      current.totalScore > prev.totalScore ? current : prev
    );

    game.winner = winner.player;
    game.status = GameStatus.COMPLETED;
    await game.save();

    if (game.party) {
      game.party.status = PartyStatus.COMPLETED;
      await game.party.save();
    }

    console.log(`[GameService] Game ${gameId} finished. Winner: ${winner.player.name} with ${winner.totalScore} points`);
    return game;
  }

  static async getPartyInfo(partyId: number): Promise<Party | null> {
    return await Party.findOne({
      where: { id: partyId },
      relations: ["admin", "players"]
    });
  }

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

  static async leaveParty(partyId: number, userId: number): Promise<void> {
    const party = await Party.findOne({
      where: { id: partyId },
      relations: ["admin", "players"]
    });

    if (!party) {
      throw new Error("Party not found");
    }

    const playerIndex = party.players.findIndex(player => player.id === userId);
    if (playerIndex === -1) {
      throw new Error("You are not in this party");
    }

    const activeGame = await Game.findOne({
      where: { party: { id: partyId }, status: GameStatus.IN_PROGRESS }
    });

    if (activeGame) {
      throw new Error("Cannot leave party while a game is in progress");
    }

    const remainingPlayers = party.players.filter(player => player.id !== userId);
    party.players = remainingPlayers;

    if (party.admin.id === userId && remainingPlayers.length > 0) {
      party.admin = remainingPlayers[0];
    }

    if (remainingPlayers.length === 0) {
      await party.remove();
      console.log(`[GameService] Party ${partyId} deleted - no players left`);
    } else {
      await party.save();
      console.log(`[GameService] User ${userId} left party ${partyId}, ${remainingPlayers.length} players remaining`);
    }
  }
}