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
    const isValid = !!(
      wallpaper &&
      wallpaper.id &&
      wallpaper.title &&
      wallpaper.img &&
      wallpaper.country &&
      wallpaper.country.text &&
      wallpaper.tags &&
      wallpaper.tags.length > 0
    );
    
    if (!isValid) {
      console.log(`[WallpaperService] Invalid wallpaper:`, {
        id: wallpaper?.id,
        hasTitle: !!wallpaper?.title,
        hasImg: !!wallpaper?.img,
        hasCountry: !!wallpaper?.country?.text,
        hasTags: !!(wallpaper?.tags && wallpaper.tags.length > 0)
      });
    }
    
    return isValid;
  }
}

export class GameService {
  private static gameStates: Map<number, GameStateSync> = new Map();
  private static cleanupInterval: NodeJS.Timeout | null = null;
  private static operationLocks: Map<number, Set<string>> = new Map();

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
        this.operationLocks.delete(gameId);
      }
    }
  }

  private static acquireOperationLock(gameId: number, operation: string): boolean {
    if (!this.operationLocks.has(gameId)) {
      this.operationLocks.set(gameId, new Set());
    }
    
    const locks = this.operationLocks.get(gameId)!;
    if (locks.has(operation)) {
      console.log(`[GameService] ⚠️ Operation ${operation} already in progress for game ${gameId}`);
      return false;
    }
    
    locks.add(operation);
    return true;
  }

  private static releaseOperationLock(gameId: number, operation: string): void {
    const locks = this.operationLocks.get(gameId);
    if (locks) {
      locks.delete(operation);
      if (locks.size === 0) {
        this.operationLocks.delete(gameId);
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
    if (!this.acquireOperationLock(gameId, 'initialize')) {
      const existing = this.gameStates.get(gameId);
      if (existing) {
        existing.lastActivity = new Date();
        return existing;
      }
    }

    try {
      if (this.gameStates.has(gameId)) {
        console.log(`[GameService] ⚠️ Replacing existing sync state for game ${gameId}`);
        const existingState = this.gameStates.get(gameId)!;
        console.log(`[GameService] 📊 Previous state: round ${existingState.currentRound}, finished: ${existingState.playersWhoFinished.size}, ready: ${existingState.playersReady.size}`);
      }

      const gameState: GameStateSync = {
        gameId,
        currentRound: 1,
        lastCompletedRound: 0,
        playersWhoFinished: new Set(),
        playersWhoFinishedLastRound: new Set(),
        playersReady: new Set(),
        allPlayersFinished: false,
        roundResults: new Map(),
        lastActivity: new Date()
      };
      
      this.gameStates.set(gameId, gameState);
      console.log(`[GameService] ✅ Initialized clean sync state for game ${gameId}`);
      return gameState;
    } finally {
      this.releaseOperationLock(gameId, 'initialize');
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
    if (!this.acquireOperationLock(gameId, 'sync_database')) {
      console.log(`[GameService] Sync already in progress for game ${gameId}, waiting...`);
      
      let retries = 10;
      while (retries > 0 && this.operationLocks.get(gameId)?.has('sync_database')) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries--;
      }
      
      if (retries === 0) {
        console.warn(`[GameService] Sync timeout for game ${gameId}`);
      }
      return;
    }

    try {
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

      const playerCompletionStatus = await Promise.all(
        game.players.map(async (player) => {
          const guessCount = await Guess.createQueryBuilder('guess')
            .where('guess.gameId = :gameId', { gameId })
            .andWhere('guess.userId = :userId', { userId: player.id })
            .getCount();
          
          return { playerId: player.id, guessCount };
        })
      );

      console.log(`[GameService] 📊 Player completion status for game ${gameId}:`, playerCompletionStatus);

      const minGuessCount = Math.min(...playerCompletionStatus.map(p => p.guessCount));
      const maxGuessCount = Math.max(...playerCompletionStatus.map(p => p.guessCount));
      
      let currentRound = gameState.currentRound;
      let lastCompletedRound = minGuessCount;
      
      if (minGuessCount >= currentRound) {
        lastCompletedRound = currentRound;
        console.log(`[GameService] ✅ All players completed round ${currentRound}`);
      } else {
        lastCompletedRound = minGuessCount;
        console.log(`[GameService] ⏳ Round ${currentRound} still in progress (min: ${minGuessCount}/${currentRound})`);
      }
      
      gameState.currentRound = currentRound;
      gameState.lastCompletedRound = lastCompletedRound;
      
      gameState.playersWhoFinished.clear();
      gameState.playersWhoFinishedLastRound.clear();
      
      if (lastCompletedRound > 0) {
        playerCompletionStatus.forEach(({ playerId, guessCount }) => {
          if (guessCount >= lastCompletedRound) {
            gameState!.playersWhoFinishedLastRound.add(playerId);
          }
        });
      }
      
      playerCompletionStatus.forEach(({ playerId, guessCount }) => {
        if (guessCount >= currentRound) {
          gameState!.playersWhoFinished.add(playerId);
        }
      });

      const allPlayersFinished = gameState.playersWhoFinished.size === game.players.length && 
                                currentRound >= game.rounds_number &&
                                minGuessCount >= game.rounds_number;
      gameState.allPlayersFinished = allPlayersFinished;
      gameState.lastActivity = new Date();

      console.log(`[GameService] ✅ Synced game ${gameId}:`);
      console.log(`  - Current round: ${currentRound}/${game.rounds_number}`);
      console.log(`  - Last completed round: ${lastCompletedRound}`);
      console.log(`  - Players finished current round: ${gameState.playersWhoFinished.size}/${game.players.length}`);
      console.log(`  - Players finished last round: ${gameState.playersWhoFinishedLastRound.size}/${game.players.length}`);
      console.log(`  - All players finished game: ${allPlayersFinished}`);
      console.log(`  - Min/Max guess counts: ${minGuessCount}/${maxGuessCount}`);
      
      console.log(`[GameService] 🔍 Detailed state:`);
      console.log(`  - Players who finished current [${currentRound}]: [${Array.from(gameState.playersWhoFinished).join(', ')}]`);
      console.log(`  - Players who finished last completed [${lastCompletedRound}]: [${Array.from(gameState.playersWhoFinishedLastRound).join(', ')}]`);
    } finally {
      this.releaseOperationLock(gameId, 'sync_database');
    }
  }

  static async hasPlayerFinishedRound(gameId: number, playerId: number, roundNumber: number): Promise<boolean> {
    if (roundNumber <= 0) return true;
    
    try {
      const guessCount = await Guess.createQueryBuilder('guess')
        .where('guess.gameId = :gameId', { gameId })
        .andWhere('guess.userId = :userId', { userId: playerId })
        .getCount();
      
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
    if (!this.acquireOperationLock(gameId, `mark_finished_${userId}`)) {
      console.log(`[GameService] Mark finished already in progress for player ${userId} in game ${gameId}`);
      
      const gameState = this.gameStates.get(gameId);
      const game = await Game.findOne({ where: { id: gameId }, relations: ['players'] });
      
      if (gameState && game) {
        const totalPlayers = game.players.length;
        const playersFinished = gameState.playersWhoFinished.size;
        return {
          allPlayersFinished: playersFinished === totalPlayers,
          waitingPlayers: totalPlayers - playersFinished,
          totalPlayers
        };
      }
    }

    try {
      let gameState = this.gameStates.get(gameId);
      if (!gameState) {
        console.log(`[GameService] 🔄 Game state not found, syncing with database for game ${gameId}`);
        await this.syncGameStateWithDatabase(gameId);
        gameState = this.gameStates.get(gameId);
        if (!gameState) {
          throw new Error('Game state not found after sync');
        }
      }

      if (gameState.playersWhoFinished.has(userId)) {
        console.log(`[GameService] ℹ️ Player ${userId} already marked as finished for game ${gameId}`);
      } else {
        gameState.playersWhoFinished.add(userId);
        console.log(`[GameService] ✅ Player ${userId} marked as finished for round ${gameState.currentRound}`);
      }
      
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
    } finally {
      this.releaseOperationLock(gameId, `mark_finished_${userId}`);
    }
  }

  static async moveToNextRound(gameId: number): Promise<void> {
    if (!this.acquireOperationLock(gameId, 'move_next_round')) {
      console.log(`[GameService] Move to next round already in progress for game ${gameId}`);
      return;
    }

    try {
      const gameState = this.gameStates.get(gameId);
      if (!gameState) {
        console.error(`[GameService] ❌ Game state not found for game ${gameId}`);
        throw new Error('Game state not found');
      }

      console.log(`[GameService] Moving from round ${gameState.currentRound} to round ${gameState.currentRound + 1}`);

      const game = await Game.findOne({
        where: { id: gameId },
        relations: ['players']
      });

      if (!game) {
        console.error(`[GameService] ❌ Game not found in database: ${gameId}`);
        throw new Error('Game not found');
      }

      const previousRound = gameState.currentRound;
      gameState.lastCompletedRound = previousRound;
      
      gameState.playersWhoFinishedLastRound = new Set(gameState.playersWhoFinished);
      
      gameState.currentRound = Math.min(previousRound + 1, game.rounds_number);
      
      gameState.playersWhoFinished.clear();
      gameState.playersReady.clear();
      gameState.allPlayersFinished = false;
      gameState.roundResults.clear();
      gameState.lastActivity = new Date();
      
      console.log(`[GameService] ✅ Successfully moved from round ${previousRound} to round ${gameState.currentRound}`);
      
    } finally {
      this.releaseOperationLock(gameId, 'move_next_round');
    }
  }

  static markPlayerReady(gameId: number, userId: number): { allPlayersReady: boolean } {
    if (!this.acquireOperationLock(gameId, `mark_ready_${userId}`)) {
      console.log(`[GameService] Mark ready already in progress for player ${userId} in game ${gameId}`);
      
      const gameState = this.gameStates.get(gameId);
      if (gameState) {
        const eligiblePlayers = new Set([
          ...gameState.playersWhoFinishedLastRound,
          ...gameState.playersWhoFinished
        ]);
        const allPlayersReady = eligiblePlayers.size > 0 && gameState.playersReady.size === eligiblePlayers.size;
        return { allPlayersReady };
      }
      return { allPlayersReady: false };
    }

    try {
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
      
      const playerCanBeReady = gameState.playersWhoFinishedLastRound.has(userId) || 
                              gameState.playersWhoFinished.has(userId);
      
      if (!playerCanBeReady) {
        console.warn(`[GameService] ⚠️ Player ${userId} marked as ready but hasn't finished required rounds`);
      }
      
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

      return { allPlayersReady };
    } finally {
      this.releaseOperationLock(gameId, `mark_ready_${userId}`);
    }
  }

  static getRoundResults(gameId: number): Map<number, GuessResult> {
    const gameState = this.gameStates.get(gameId);
    return gameState?.roundResults || new Map();
  }

  static cleanupGameSync(gameId: number): void {
    const gameState = this.gameStates.get(gameId);
    if (gameState) {
      this.gameStates.delete(gameId);
      this.operationLocks.delete(gameId);
      console.log(`[GameService] Cleaned up sync state for game ${gameId}`);
    } else {
      console.warn(`[GameService] Attempted to cleanup non-existent game state for game ${gameId}`);
    }
  }

  static async processGuessWithSync(
    gameId: number,
    relativeId: number,
    userId: number,
    country: string
  ): Promise<SyncGuessResult> {
    console.log(`[GameService] Processing guess for game ${gameId}, round ${relativeId}, user ${userId}, country: ${country}`);
    
    const existingGuesses = await Guess.createQueryBuilder('guess')
      .leftJoinAndSelect('guess.round', 'round')
      .where('guess.gameId = :gameId', { gameId })
      .andWhere('guess.userId = :userId', { userId })
      .orderBy('guess.id', 'ASC')
      .getMany();
    
    console.log(`[GameService] 📋 Existing guesses for user ${userId}:`);
    existingGuesses.forEach(guess => {
      console.log(`  - Round ${guess.round.relative_id}: ${guess.country_code}`);
    });

    if (!this.acquireOperationLock(gameId, `guess_${userId}_${relativeId}`)) {
      console.warn(`[GameService] ⚠️ Guess submission already in progress for player ${userId} round ${relativeId} in game ${gameId}`);
      throw new Error("Guess submission already in progress");
    }

    try {
      const existingGuess = await Guess.createQueryBuilder('guess')
        .leftJoinAndSelect('guess.round', 'round')
        .where('guess.gameId = :gameId', { gameId })
        .andWhere('guess.userId = :userId', { userId })
        .andWhere('round.relative_id = :relativeId', { relativeId })
        .getOne();

      if (existingGuess) {
        console.warn(`[GameService] ⚠️ Player ${userId} already submitted guess for round ${relativeId} in game ${gameId}`);
        console.warn(`[GameService] 📝 Existing guess: ${existingGuess.country_code} (ID: ${existingGuess.id})`);
        throw new Error("You have already submitted a guess for this round");
      }

      const guessResult = await this.processGuess(gameId, relativeId, userId, country);
      
      const syncResult = await this.markPlayerFinishedRound(gameId, userId);
      
      const gameStateAfter = this.gameStates.get(gameId);
      if (gameStateAfter) {
        gameStateAfter.roundResults.set(userId, guessResult);
        gameStateAfter.lastActivity = new Date();
        
        console.log(`[GameService] 💾 Saved guess result for player ${userId} in game ${gameId}`);
        console.log(`[GameService] 📊 Round status: ${gameStateAfter.playersWhoFinished.size}/${syncResult.totalPlayers} finished`);
      } else {
        console.warn(`[GameService] ⚠️ No game state found to save result for game ${gameId}`);
      }

      return {
        ...guessResult,
        roundComplete: syncResult.allPlayersFinished,
        waitingPlayers: syncResult.waitingPlayers,
        totalPlayers: syncResult.totalPlayers
      };
    } finally {
      this.releaseOperationLock(gameId, `guess_${userId}_${relativeId}`);
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
        tags: round.wallpaper.tags || [] // CORRECTION ICI - ajouter || []
      },
      userGuess: {
        country: country
      }
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
    
    console.log(`[GameService] 🔍 Checking if all players finished game ${gameId}:`);
    console.log(`  - Total rounds: ${totalRounds}`);
    console.log(`  - Players to check: [${playerIds.join(', ')}]`);
    
    const playerGuessesCount = await Promise.all(
      game.players.map(async (player) => {
        const guessCount = await Guess.createQueryBuilder('guess')
          .where('guess.gameId = :gameId', { gameId })
          .andWhere('guess.userId = :userId', { userId: player.id })
          .getCount();
        
        const directCount = await Guess.createQueryBuilder('guess')
          .where('guess.gameId = :gameId', { gameId })
          .andWhere('guess.userId = :userId', { userId: player.id })
          .getCount();
        
        console.log(`[GameService] Player ${player.name} (${player.id}): ${guessCount} guesses (direct: ${directCount})`);
        
        return { playerId: player.id, playerName: player.name, guessCount: Math.max(guessCount, directCount) };
      })
    );
    
    const allFinished = playerGuessesCount.every(({ guessCount }) => guessCount >= totalRounds);
    
    console.log(`[GameService] 🎯 Final check result:`);
    playerGuessesCount.forEach(({ playerName, guessCount }) => {
      const finished = guessCount >= totalRounds;
      console.log(`  - ${playerName}: ${guessCount}/${totalRounds} (${finished ? '✅ FINISHED' : '❌ NOT FINISHED'})`);
    });
    console.log(`[GameService] All players finished: ${allFinished}`);
    
    return allFinished;
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