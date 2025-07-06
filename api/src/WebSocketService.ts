import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { User } from './User';
import { Party, PartyStatus } from './Party';
import { Game, GameStatus } from './Game';
import { Round } from './Round';
import { Guess } from './Guess';
import { GameService, GuessResult } from './GameService';
import * as jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  userId?: number;
  userName?: string;
  currentPartyId?: number;
}

interface PartyRoom {
  partyId: number;
  players: Map<number, { socket: AuthenticatedSocket; user: { id: number; name: string } }>;
  gameState?: {
    gameId: number;
    currentRound: number;
    roundStartTime: Date;
    playersReady: Set<number>;
    playersFinished: Set<number>;
    guesses: Map<number, { country: string; timestamp: Date; result?: GuessResult }>;
    waitingForPlayers: boolean;
    allPlayersFinishedRound: boolean;
    totalRounds: number;
    isLastRound: boolean;
    lastActivity: Date;
    debounce: {
      lastRoundComplete: number;
      lastReadyCheck: number;
      lastTransition: number;
      pendingOperations: Set<string>;
    };
  };
}

export class WebSocketService {
  private io: SocketIOServer;
  private partyRooms: Map<number, PartyRoom> = new Map();

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const secretKey = process.env.JWT_SECRET;
        if (!secretKey) {
          return next(new Error('Server configuration error'));
        }

        const decoded = jwt.verify(token, secretKey) as { userId: number; name: string };
        socket.userId = decoded.userId;
        socket.userName = decoded.name;
        
        console.log(`[WebSocket] User ${decoded.name} (${decoded.userId}) connected`);
        next();
      } catch (error) {
        console.error('[WebSocket] Authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      console.log(`[WebSocket] Socket connected: ${socket.id} (User: ${socket.userName})`);

      socket.on('join_party', async (data: { partyId: number }) => {
        try {
          await this.handleJoinParty(socket, data.partyId);
        } catch (error) {
          console.error(`[WebSocket] Error joining party ${data.partyId}:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to join party' });
        }
      });

      socket.on('leave_party', () => {
        this.handleLeaveParty(socket);
      });

      socket.on('start_game', async (data: { partyId: number; config: any }) => {
        try {
          await this.handleStartGame(socket, data.partyId, data.config);
        } catch (error) {
          console.error(`[WebSocket] Error starting game for party ${data.partyId}:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to start game' });
        }
      });

      socket.on('submit_guess', async (data: { partyId: number; gameId: number; relativeId: number; country: string }) => {
        try {
          await this.handleSubmitGuessWithSync(socket, data);
        } catch (error) {
          console.error(`[WebSocket] Error submitting guess:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to submit guess' });
        }
      });

      socket.on('ready_for_next_round', (data: { partyId: number }) => {
        console.log(`[WebSocket] Ready for next round from ${socket.userName} (${socket.userId})`);
        
        this.handleReadyForNextRound(socket, data.partyId).catch(error => {
          console.error(`[WebSocket] Error in ready_for_next_round handler:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to process ready state' });
        });
      });

      socket.on('disconnect', () => {
        console.log(`[WebSocket] Socket disconnected: ${socket.id} (User: ${socket.userName})`);
        this.handleLeaveParty(socket);
      });
    });
  }

  private async handleJoinParty(socket: AuthenticatedSocket, partyId: number) {
    if (!socket.userId) throw new Error('User not authenticated');

    console.log(`[WebSocket] User ${socket.userName} attempting to join party ${partyId}`);

    const party = await Party.findOne({
      where: { id: partyId },
      relations: ['players', 'admin']
    });

    if (!party) {
      throw new Error('Party not found');
    }

    const isPlayerInParty = party.players.some(p => p.id === socket.userId);
    if (!isPlayerInParty) {
      throw new Error('You are not a member of this party');
    }

    if (socket.currentPartyId && socket.currentPartyId !== partyId) {
      this.handleLeaveParty(socket);
    }

    socket.currentPartyId = partyId;
    socket.join(`party_${partyId}`);

    if (!this.partyRooms.has(partyId)) {
      console.log(`[WebSocket] Creating new party room for party ${partyId}`);
      this.partyRooms.set(partyId, {
        partyId: partyId,
        players: new Map()
      });
    }

    const partyRoom = this.partyRooms.get(partyId)!;
    
    if (partyRoom.players.has(socket.userId)) {
      console.log(`[WebSocket] User ${socket.userName} already in party room ${partyId}, updating socket`);
      partyRoom.players.get(socket.userId)!.socket = socket;
    } else {
      partyRoom.players.set(socket.userId, {
        socket: socket,
        user: { id: socket.userId, name: socket.userName! }
      });
    }

    await this.restoreGameStateFromDatabase(partyId);

    if (this.partyRooms.get(partyId)?.gameState) {
      await this.forceSyncGameState(partyId);
    }

    const allPlayers = new Map<number, { id: number; name: string }>();
    
    party.players.forEach(player => {
      allPlayers.set(player.id, { id: player.id, name: player.name });
    });
    
    const connectedPlayersList = Array.from(allPlayers.values()).map(player => ({
      ...player,
      isConnected: partyRoom.players.has(player.id)
    }));

    socket.to(`party_${partyId}`).emit('player_joined', {
      user: { id: socket.userId, name: socket.userName },
      players: connectedPlayersList,
      party: {
        id: party.id,
        code: party.code,
        admin: { id: party.admin.id, name: party.admin.name },
        status: party.status
      }
    });

    socket.emit('party_state', {
      party: {
        id: party.id,
        code: party.code,
        admin: { id: party.admin.id, name: party.admin.name },
        status: party.status
      },
      players: connectedPlayersList,
      gameState: partyRoom.gameState
    });

    this.broadcastToParty(partyId, 'party_updated', {
      partyId,
      players: connectedPlayersList,
    });

    console.log(`[WebSocket] User ${socket.userName} joined party ${partyId}, room now has ${partyRoom.players.size} connected players (${party.players.length} total)`);
    this.ensureGameStateLastActivity(partyId);
  }

  public async forceSyncGameState(partyId: number): Promise<void> {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) {
      console.log(`[WebSocket] No party room to sync for party ${partyId}`);
      return;
    }

    const gameId = partyRoom.gameState.gameId;
    console.log(`[WebSocket] 🔄 Force syncing party ${partyId} game ${gameId}`);

    try {
      await GameService.syncGameStateWithDatabase(gameId);
      
      const gameSync = GameService.getGameSync(gameId);
      if (gameSync) {
        partyRoom.gameState.currentRound = gameSync.currentRound;
        partyRoom.gameState.playersFinished = new Set(gameSync.playersWhoFinished);
        partyRoom.gameState.playersReady = new Set(gameSync.playersReady);
        partyRoom.gameState.allPlayersFinishedRound = gameSync.allPlayersFinished;
        partyRoom.gameState.lastActivity = new Date();
        
        console.log(`[WebSocket] ✅ Force sync completed for party ${partyId}`);
      }
    } catch (err) {
      console.error(`[WebSocket] ❌ Force sync failed for party ${partyId}:`, err);
    }
  }

  private async restoreGameStateFromDatabase(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom) return;

    const activeGame = await Game.findOne({
      where: { party: { id: partyId }, status: GameStatus.IN_PROGRESS },
      relations: ['players']
    });

    if (activeGame) {
      console.log(`[WebSocket] Restoring game state for game ${activeGame.id}`);

      try {
        await GameService.syncGameStateWithDatabase(activeGame.id);
        console.log(`[WebSocket] ✅ Forced GameService sync for game ${activeGame.id}`);
      } catch (err) {
        console.error(`[WebSocket] ⚠️ Failed to sync GameService:`, err);
      }

      const gameSync = GameService.getGameSync(activeGame.id);
      
      if (gameSync) {
        partyRoom.gameState = {
          gameId: activeGame.id,
          currentRound: gameSync.currentRound,
          roundStartTime: new Date(),
          playersReady: new Set(gameSync.playersReady), 
          playersFinished: new Set(gameSync.playersWhoFinished),
          guesses: new Map(),
          waitingForPlayers: !gameSync.allPlayersFinished,
          allPlayersFinishedRound: gameSync.allPlayersFinished,
          totalRounds: activeGame.rounds_number,
          isLastRound: gameSync.currentRound >= activeGame.rounds_number,
          lastActivity: new Date(),
          debounce: {
            lastRoundComplete: 0,
            lastReadyCheck: 0,
            lastTransition: 0,
            pendingOperations: new Set()
          }
        };
        
        console.log(`[WebSocket] Restored game state from GameService`);
      }
    }
  }

  private async handleLeaveParty(socket: AuthenticatedSocket) {
    if (!socket.currentPartyId || !socket.userId) return;

    const partyId = socket.currentPartyId;
    const partyRoom = this.partyRooms.get(partyId);

    console.log(`[WebSocket] User ${socket.userName} leaving party ${partyId}`);

    if (partyRoom) {
      partyRoom.players.delete(socket.userId);
      
      this.broadcastToParty(partyId, 'player_left', {
        user: { id: socket.userId, name: socket.userName },
        players: Array.from(partyRoom.players.values()).map(p => p.user)
      });

      this.broadcastToParty(partyId, 'party_updated', {
        partyId,
        players: Array.from(partyRoom.players.values()).map(p => p.user),
      });

      if (partyRoom.players.size === 0) {
        console.log(`[WebSocket] Party room ${partyId} is empty, scheduling cleanup in 30 seconds`);
        
        setTimeout(async () => {
          const currentRoom = this.partyRooms.get(partyId);
          if (currentRoom && currentRoom.players.size === 0) {
            console.log(`[WebSocket] Cleaning up empty party room ${partyId}`);
            this.partyRooms.delete(partyId);
          }
        }, 30000);
      }
    }

    socket.leave(`party_${partyId}`);
    socket.currentPartyId = undefined;
  }

  private async handleStartGame(socket: AuthenticatedSocket, partyId: number, config: any) {
    if (!socket.userId) throw new Error('User not authenticated');

    console.log(`[WebSocket] User ${socket.userName} wants to start game for party ${partyId}`);
    
    let partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom) {
      console.error(`[WebSocket] Party room ${partyId} not found in memory`);
      await this.handleJoinParty(socket, partyId);
      partyRoom = this.partyRooms.get(partyId);
      if (!partyRoom) {
        throw new Error('Party room not found and could not be created');
      }
    }

    const party = await Party.findOne({
      where: { id: partyId },
      relations: ['admin', 'players']
    });

    if (!party || party.admin.id !== socket.userId) {
      throw new Error('Only the party admin can start the game');
    }

    console.log(`[WebSocket] Starting game for party ${partyId} with config:`, config);

    await this.forcePartySync(partyId);

    const game = await GameService.startPartyGame(partyId, socket.userId, config);

    partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom) throw new Error('Party room lost after sync');

    partyRoom.gameState = {
      gameId: game.id,
      currentRound: 1,
      roundStartTime: new Date(),
      playersReady: new Set(),
      playersFinished: new Set(),
      guesses: new Map(),
      waitingForPlayers: false,
      allPlayersFinishedRound: false,
      totalRounds: game.rounds_number,
      isLastRound: false,
      lastActivity: new Date(),
      debounce: {
        lastRoundComplete: 0,
        lastReadyCheck: 0,
        lastTransition: 0,
        pendingOperations: new Set()
      }
    };

    console.log(`[WebSocket] Game ${game.id} started for party ${partyId}`);

    const gameStartData = {
      gameId: game.id,
      partyId: partyId,
      config: {
        roundsNumber: game.rounds_number,
        time: game.time,
        map: game.map
      },
      currentRound: 1
    };

    this.broadcastToParty(partyId, 'game_started', gameStartData);

    console.log(`[WebSocket] Game start event broadcasted to party ${partyId}`);
  }

  private async handleSubmitGuessWithSync(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) throw new Error('User not authenticated');

    console.log(`[WebSocket] Processing guess from ${socket.userName} for party ${data.partyId}, round ${data.relativeId}`);

    const partyRoom = this.partyRooms.get(data.partyId);
    if (!partyRoom || !partyRoom.gameState) {
      throw new Error('Party room or game state not found');
    }

    if (partyRoom.gameState.guesses.has(socket.userId)) {
      console.log(`[WebSocket] Player ${socket.userId} already submitted for round ${partyRoom.gameState.currentRound}`);
      socket.emit('error', { message: 'You have already submitted a guess for this round' });
      return;
    }

    try {
      const result = await GameService.processGuessWithSync(
        data.gameId,
        data.relativeId,
        socket.userId,
        data.country
      );

      partyRoom.gameState.guesses.set(socket.userId, {
        country: data.country,
        timestamp: new Date(),
        result: result
      });

      partyRoom.gameState.playersFinished.add(socket.userId);
      partyRoom.gameState.lastActivity = new Date();

      socket.emit('guess_result', {
        ...result,
        isMultiplayer: true
      });

      this.broadcastToParty(data.partyId, 'player_finished_round', {
        playerId: socket.userId,
        playerName: socket.userName,
        finishedCount: partyRoom.gameState.playersFinished.size,
        totalPlayers: result.totalPlayers,
        stillWaiting: result.waitingPlayers
      });

      console.log(`[WebSocket] Player ${socket.userName} finished round ${partyRoom.gameState.currentRound}. ${partyRoom.gameState.playersFinished.size}/${result.totalPlayers} completed`);

      const allPlayersFinished = partyRoom.gameState.playersFinished.size === result.totalPlayers;
      
      if (allPlayersFinished && 
          !partyRoom.gameState.debounce.pendingOperations.has('round_complete')) {
        
        console.log(`[WebSocket] 🏁 Round ${partyRoom.gameState.currentRound} COMPLETE! All players finished.`);
        
        partyRoom.gameState.debounce.pendingOperations.add('round_complete');
        partyRoom.gameState.allPlayersFinishedRound = true;
        partyRoom.gameState.waitingForPlayers = false;
        
        const roundResults = Array.from(partyRoom.gameState.guesses.entries()).map(([playerId, guess]) => {
          const player = partyRoom.players.get(playerId);
          return {
            playerId,
            playerName: player?.user.name || 'Unknown',
            country: guess.country,
            result: guess.result,
            timestamp: guess.timestamp
          };
        });

        const isLastRound = partyRoom.gameState.currentRound >= partyRoom.gameState.totalRounds;
        partyRoom.gameState.isLastRound = isLastRound;

        this.broadcastToParty(data.partyId, 'round_completed', {
          roundNumber: partyRoom.gameState.currentRound,
          results: roundResults,
          isLastRound,
          nextRoundAvailable: !isLastRound
        });

        console.log(`[WebSocket] ✅ Broadcasted round_completed to party ${data.partyId}`);

        setTimeout(() => {
          if (partyRoom.gameState!.debounce.pendingOperations.has('round_complete')) {
            this.autoReadyAllFinishedPlayers(data.partyId);
            partyRoom.gameState!.debounce.pendingOperations.delete('round_complete');
          }
        }, 2000);
        
      } else {
        console.log(`[WebSocket] ⏳ Round not complete, ${result.waitingPlayers} players still need to play`);
      }

    } catch (error) {
      console.error(`[WebSocket] Error processing guess:`, error);
      socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to process guess' });
    }
  }

  private autoReadyAllFinishedPlayers(partyId: number) {
    console.log(`[WebSocket] 🤖 Auto-readying all finished players for party ${partyId}`);
    
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) {
      console.log(`[WebSocket] No party room or game state for auto-ready`);
      return;
    }

    const gameState = partyRoom.gameState;
    
    if (gameState.debounce.pendingOperations.has('auto_ready')) {
      console.log(`[WebSocket] Auto-ready already in progress, skipping`);
      return;
    }

    gameState.debounce.pendingOperations.add('auto_ready');

    const connectedPlayerIds = Array.from(partyRoom.players.keys());
    
    const roundResults = Array.from(gameState.guesses.entries()).map(([playerId, guess]) => {
      const player = partyRoom.players.get(playerId);
      return {
        playerId,
        playerName: player?.user.name || 'Unknown',
        country: guess.country,
        result: guess.result,
        timestamp: guess.timestamp
      };
    });

    const isLastRound = gameState.currentRound >= gameState.totalRounds;
    gameState.isLastRound = isLastRound;

    this.broadcastToParty(partyId, 'round_completed', {
      roundNumber: gameState.currentRound,
      results: roundResults,
      isLastRound,
      nextRoundAvailable: !isLastRound
    });

    console.log(`[WebSocket] ✅ Force-broadcasted round_completed to ALL players in party ${partyId}`);

    setTimeout(() => {
      const playersToAutoReady = connectedPlayerIds.filter(playerId => 
        gameState.playersFinished.has(playerId) && !gameState.playersReady.has(playerId)
      );

      console.log(`[WebSocket] 🎯 Auto-readying players: [${playersToAutoReady.join(', ')}]`);

      playersToAutoReady.forEach(playerId => {
        try {
          gameState.playersReady.add(playerId);
          GameService.markPlayerReady(gameState.gameId, playerId);
          
          console.log(`[WebSocket] ✅ Auto-ready player ${playerId}`);
        } catch (err) {
          console.error(`[WebSocket] Failed to auto-ready player ${playerId}:`, err);
        }
      });

      if (playersToAutoReady.length > 0) {
        const readyCount = gameState.playersReady.size;
        const finishedPlayersCount = gameState.playersFinished.size;
        const allPlayersReady = readyCount === finishedPlayersCount;

        this.broadcastToParty(partyId, 'player_ready_update', {
          playerId: null,
          playerName: 'Auto-Ready System',
          readyCount,
          totalPlayers: finishedPlayersCount,
          allPlayersReady
        });

        console.log(`[WebSocket] 📡 Broadcasted auto-ready update: ${readyCount}/${finishedPlayersCount} ready`);

        if (allPlayersReady && !gameState.debounce.pendingOperations.has('transition')) {
          console.log(`[WebSocket] 🚀 All finished players are ready! Starting next round`);
          gameState.debounce.pendingOperations.add('transition');
          
          setTimeout(() => {
            if (gameState.isLastRound) {
              this.handleGameEnd(partyId);
            } else {
              this.startNextRound(partyId);
            }
            gameState.debounce.pendingOperations.delete('transition');
          }, 1000);
        }
      }
      
      gameState.debounce.pendingOperations.delete('auto_ready');
    }, 1000);
  }

  private async handleReadyForNextRound(socket: AuthenticatedSocket, partyId: number) {
    console.log(`[WebSocket] User ${socket.userName} (${socket.userId}) ready for next round in party ${partyId}`);

    if (!socket.userId) {
      console.error(`[WebSocket] No userId for socket`);
      socket.emit('error', { message: 'User not authenticated' });
      return;
    }

    if (!socket.currentPartyId || socket.currentPartyId !== partyId) {
      console.log(`[WebSocket] Socket not in party ${partyId}, attempting to join first`);
      try {
        await this.handleJoinParty(socket, partyId);
        setTimeout(() => {
          this.handleReadyForNextRound(socket, partyId);
        }, 500);
      } catch (err) {
        console.error(`[WebSocket] Failed to join party:`, err);
        socket.emit('error', { message: 'Failed to join party' });
      }
      return;
    }

    const partyRoom = this.partyRooms.get(partyId);
    
    if (!partyRoom || !partyRoom.gameState) {
      console.error(`[WebSocket] No party room or game state found for partyId ${partyId}`);
      
      try {
        await this.restoreGameStateFromDatabase(partyId);
        setTimeout(() => {
          this.handleReadyForNextRound(socket, partyId);
        }, 500);
      } catch (err) {
        console.error(`[WebSocket] Failed to restore game state:`, err);
        socket.emit('error', { message: 'No active game found' });
      }
      return;
    }

    const gameState = partyRoom.gameState;
    const now = Date.now();
    
    if (now - gameState.debounce.lastReadyCheck < 1000) {
      console.log(`[WebSocket] Ready check too recent, ignoring`);
      return;
    }
    
    gameState.debounce.lastReadyCheck = now;
    
    console.log(`[WebSocket] Game State before verification:`);
    console.log(`  - Current round: ${gameState.currentRound}`);
    console.log(`  - Players finished current: [${Array.from(gameState.playersFinished).join(', ')}]`);
    console.log(`  - Players ready: [${Array.from(gameState.playersReady).join(', ')}]`);

    try {
      console.log(`[WebSocket] Verifying player ${socket.userId} has played current round ${gameState.currentRound}`);
      
      const playerGuessForCurrentRound = await Guess.findOne({
        where: {
          game: { id: gameState.gameId },
          user: { id: socket.userId },
          round: { relative_id: gameState.currentRound }
        }
      });

      if (!playerGuessForCurrentRound) {
        console.error(`[WebSocket] Player ${socket.userId} hasn't played round ${gameState.currentRound} yet!`);
        
        const otherPlayersGuesses = await Promise.all(
          Array.from(partyRoom.players.keys())
            .filter(playerId => playerId !== socket.userId)
            .map(async (playerId) => {
              const guess = await Guess.findOne({
                where: {
                  game: { id: gameState.gameId },
                  user: { id: playerId },
                  round: { relative_id: gameState.currentRound }
                }
              });
              return { playerId, hasGuess: !!guess };
            })
        );
        
        const allOthersFinished = otherPlayersGuesses.every(p => p.hasGuess);
        
        if (allOthersFinished) {
          socket.emit('error', { 
            message: `Please submit your guess for round ${gameState.currentRound} first`
          });
        } else {
          socket.emit('error', { 
            message: `You must play round ${gameState.currentRound} before being ready for the next round`
          });
        }
        return;
      }

      console.log(`[WebSocket] ✅ Player ${socket.userId} has played round ${gameState.currentRound}: ${playerGuessForCurrentRound.country_code}`);
    } catch (dbErr) {
      console.error(`[WebSocket] Database verification failed:`, dbErr);
      socket.emit('error', { message: 'Failed to verify game state' });
      return;
    }

    try {
      console.log(`[WebSocket] Force syncing game state with database for game ${gameState.gameId}`);
      
      await GameService.syncGameStateWithDatabase(gameState.gameId);
      
      const gameServiceState = GameService.getGameSync(gameState.gameId);
      if (gameServiceState) {
        gameState.currentRound = gameServiceState.currentRound;
        gameState.playersFinished = new Set(gameServiceState.playersWhoFinished);
        gameState.playersReady = new Set(gameServiceState.playersReady);
        gameState.allPlayersFinishedRound = gameServiceState.allPlayersFinished;
        gameState.isLastRound = gameState.currentRound >= gameState.totalRounds;
        
        console.log(`[WebSocket] ✅ Updated WebSocket state from GameService`);
      } else {
        console.log(`[WebSocket] ⚠️ No GameService state found after sync`);
        socket.emit('error', { message: 'Failed to synchronize game state' });
        return;
      }
    } catch (err) {
      console.error(`[WebSocket] Failed to sync with GameService:`, err);
      socket.emit('error', { message: 'Failed to synchronize with game server' });
      return;
    }

    const gameServiceState = GameService.getGameSync(gameState.gameId);
    let playerCanBeReady = false;
    
    if (gameServiceState) {
      const finishedCurrentRound = gameServiceState.playersWhoFinished.has(socket.userId);
      playerCanBeReady = finishedCurrentRound;
      
      console.log(`[WebSocket] Player ${socket.userId} eligibility check:`);
      console.log(`  - Finished current round ${gameState.currentRound}: ${finishedCurrentRound}`);
      console.log(`  - Can be ready: ${playerCanBeReady}`);
    }

    if (!playerCanBeReady) {
      console.warn(`[WebSocket] Player ${socket.userId} is not eligible to be ready`);
      socket.emit('error', { 
        message: 'You must finish the current round before being ready'
      });
      return;
    }

    const wasAlreadyReady = gameState.playersReady.has(socket.userId);
    
    if (!wasAlreadyReady) {
      console.log(`[WebSocket] ✅ Marking player ${socket.userId} as ready`);
      gameState.playersReady.add(socket.userId);
      
      try {
        GameService.markPlayerReady(gameState.gameId, socket.userId);
      } catch (err) {
        console.warn(`[WebSocket] Failed to sync with GameService:`, err);
      }
    } else {
      console.log(`[WebSocket] Player ${socket.userId} was already ready`);
    }

    gameState.lastActivity = new Date();
    
    const eligiblePlayers = new Set<number>();
    if (gameServiceState) {
      gameServiceState.playersWhoFinished.forEach((id: number) => eligiblePlayers.add(id));
    }
    
    const readyCount = gameState.playersReady.size;
    const eligibleCount = eligiblePlayers.size;
    const allPlayersReady = eligibleCount > 0 && readyCount === eligibleCount;

    console.log(`[WebSocket] Ready Status:`);
    console.log(`  - Eligible players (finished current round): ${eligibleCount} [${Array.from(eligiblePlayers).join(', ')}]`);
    console.log(`  - Ready players: ${readyCount} [${Array.from(gameState.playersReady).join(', ')}]`);
    console.log(`  - All eligible ready: ${allPlayersReady}`);

    this.broadcastToParty(partyId, 'player_ready_update', {
      playerId: socket.userId,
      playerName: socket.userName,
      readyCount,
      totalPlayers: eligibleCount,
      allPlayersReady
    });

    if (allPlayersReady && 
        !gameState.debounce.pendingOperations.has('ready_transition')) {
      
      console.log(`[WebSocket] 🚀 ALL ELIGIBLE PLAYERS ARE READY!`);
      
      if (gameState.isLastRound || gameState.currentRound >= gameState.totalRounds) {
        console.log(`[WebSocket] 🏁 This is the last round, ending game for party ${partyId}`);
        gameState.debounce.pendingOperations.add('ready_transition');
        
        setTimeout(() => {
          this.handleGameEnd(partyId);
          gameState.debounce.pendingOperations.delete('ready_transition');
        }, 500);
      } else {
        console.log(`[WebSocket] ➡️ Starting next round for party ${partyId}`);
        gameState.debounce.pendingOperations.add('ready_transition');
        
        setTimeout(() => {
          this.startNextRound(partyId);
          gameState.debounce.pendingOperations.delete('ready_transition');
        }, 500);
      }
    } else {
      console.log(`[WebSocket] ⏸️ Waiting for more players to be ready (${readyCount}/${eligibleCount})`);
    }
  }

  private async startNextRound(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) {
      console.error(`[WebSocket] No party room or game state for starting next round on party ${partyId}`);
      return;
    }

    const gameState = partyRoom.gameState;
    const now = Date.now();
    
    if (now - gameState.debounce.lastTransition < 2000) {
      console.log(`[WebSocket] Transition too recent, ignoring`);
      return;
    }
    
    gameState.debounce.lastTransition = now;
    
    console.log(`[WebSocket] 🚀 Starting next round for party ${partyId}`);
    console.log(`[WebSocket] Current round: ${gameState.currentRound} -> ${gameState.currentRound + 1}`);
    
    try {
      await GameService.moveToNextRound(gameState.gameId);
      console.log(`[WebSocket] ✅ GameService moveToNextRound completed`);
      
      await GameService.syncGameStateWithDatabase(gameState.gameId);
      console.log(`[WebSocket] ✅ GameService re-synchronized after move`);
      
      const gameServiceState = GameService.getGameSync(gameState.gameId);
      if (gameServiceState) {
        gameState.currentRound = gameServiceState.currentRound;
        gameState.playersReady = new Set(gameServiceState.playersReady);
        gameState.playersFinished = new Set(gameServiceState.playersWhoFinished);
        gameState.allPlayersFinishedRound = gameServiceState.allPlayersFinished;
        
        console.log(`[WebSocket] ✅ Updated WebSocket state from GameService:`);
        console.log(`  - Round: ${gameState.currentRound}`);
        console.log(`  - Players finished: [${Array.from(gameState.playersFinished).join(', ')}]`);
        console.log(`  - Players ready: [${Array.from(gameState.playersReady).join(', ')}]`);
      } else {
        console.error(`[WebSocket] No GameService state found after move!`);
        gameState.currentRound++;
        gameState.playersReady.clear();
        gameState.playersFinished.clear();
      }
      
    } catch (err) {
      console.error(`[WebSocket] Failed to sync with GameService:`, err);
      return;
    }
    
    gameState.guesses.clear();
    gameState.roundStartTime = new Date();
    gameState.allPlayersFinishedRound = false;
    gameState.waitingForPlayers = false;
    gameState.isLastRound = gameState.currentRound >= gameState.totalRounds;
    gameState.lastActivity = new Date();
    
    gameState.debounce = {
      lastRoundComplete: 0,
      lastReadyCheck: 0,
      lastTransition: now,
      pendingOperations: new Set()
    };

    console.log(`[WebSocket] New round state:`);
    console.log(`  - Round: ${gameState.currentRound}/${gameState.totalRounds}`);
    console.log(`  - Is last round: ${gameState.isLastRound}`);

    this.broadcastToParty(partyId, 'round_started', {
      roundNumber: gameState.currentRound,
      totalRounds: gameState.totalRounds,
      startTime: gameState.roundStartTime
    });

    console.log(`[WebSocket] ✅ Round ${gameState.currentRound} started for party ${partyId}`);
  }

  private async debugDatabaseState(gameId: number) {
    console.log(`[WebSocket] Debug database state for game ${gameId}`);
    
    try {
      const rounds = await Round.find({
        where: { game: { id: gameId } },
        relations: ['wallpaper'],
        order: { relative_id: 'ASC' }
      });
      
      console.log(`[WebSocket] Rounds in game ${gameId}:`);
      rounds.forEach(round => {
        console.log(`  - Round ${round.relative_id}: ${round.wallpaper.title} (ID: ${round.id})`);
      });
      
      const allGuesses = await Guess.createQueryBuilder('guess')
        .leftJoinAndSelect('guess.user', 'user')
        .leftJoinAndSelect('guess.round', 'round')
        .where('guess.gameId = :gameId', { gameId })
        .orderBy('user.id', 'ASC')
        .addOrderBy('round.relative_id', 'ASC')
        .getMany();
      
      console.log(`[WebSocket] All guesses in game ${gameId}: ${allGuesses.length} total`);
      const guessByPlayer = new Map<number, any[]>();
      
      allGuesses.forEach(guess => {
        if (!guessByPlayer.has(guess.user.id)) {
          guessByPlayer.set(guess.user.id, []);
        }
        guessByPlayer.get(guess.user.id)!.push({
          round: guess.round.relative_id,
          country: guess.country_code,
          correct: guess.is_correct,
          roundId: guess.round.id
        });
      });
      
      for (const [playerId, guesses] of guessByPlayer.entries()) {
        const user = allGuesses.find(g => g.user.id === playerId)?.user;
        console.log(`  - Player ${user?.name} (${playerId}): ${guesses.length} guesses`);
        guesses.forEach(guess => {
          console.log(`    * Round ${guess.round}: ${guess.country} (${guess.correct ? 'correct' : 'incorrect'})`);
        });
      }
      
      const game = await Game.findOne({
        where: { id: gameId },
        relations: ['players']
      });
      
      if (game) {
        console.log(`[WebSocket] Summary for ${game.players.length} players, ${game.rounds_number} rounds:`);
        
        for (const player of game.players) {
          const playerGuesses = guessByPlayer.get(player.id) || [];
          const expectedRounds = game.rounds_number;
          const actualGuesses = playerGuesses.length;
          const isComplete = actualGuesses >= expectedRounds;
          
          console.log(`  - ${player.name}: ${actualGuesses}/${expectedRounds} ${isComplete ? '✅' : '❌'}`);
          
          if (!isComplete) {
            const missingRounds = [];
            for (let round = 1; round <= expectedRounds; round++) {
              if (!playerGuesses.some(g => g.round === round)) {
                missingRounds.push(round);
              }
            }
            console.log(`    Missing rounds: [${missingRounds.join(', ')}]`);
          }
        }
      }
      
    } catch (error) {
      console.error(`[WebSocket] Error in database debug:`, error);
    }
  }

  private async handleGameEnd(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    const gameId = partyRoom.gameState.gameId;
    
    console.log(`[WebSocket] Handling game end for party ${partyId}, game ${gameId}`);

    if (partyRoom.gameState.debounce.pendingOperations.has('game_end')) {
      console.log(`[WebSocket] Game end already in progress for party ${partyId}`);
      return;
    }
    
    partyRoom.gameState.debounce.pendingOperations.add('game_end');

    try {
      await this.debugDatabaseState(gameId);
      
      const game = await Game.findOne({
        where: { id: gameId },
        relations: ['players']
      });

      if (!game) {
        console.error(`[WebSocket] Game ${gameId} not found for end game`);
        return;
      }

      const totalRounds = game.rounds_number;
      
      console.log(`[WebSocket] Checking game completion for ${game.players.length} players, ${totalRounds} total rounds`);
      
      const playerCompletionCheck = await Promise.all(
        game.players.map(async (player) => {
          const directGuessCount = await Guess.createQueryBuilder('guess')
            .where('guess.gameId = :gameId', { gameId })
            .andWhere('guess.userId = :userId', { userId: player.id })
            .getCount();
          
          console.log(`[WebSocket] Player ${player.name} (${player.id}):`);
          console.log(`  - Direct guess count: ${directGuessCount}/${totalRounds}`);
          
          const hasFinished = directGuessCount >= totalRounds;
          
          console.log(`  - Has finished: ${hasFinished}`);
          
          return { 
            playerId: player.id, 
            playerName: player.name, 
            completedRounds: directGuessCount,
            hasFinished 
          };
        })
      );

      const playersWhoFinished = playerCompletionCheck.filter(p => p.hasFinished);
      const allPlayersReallyFinished = playersWhoFinished.length === game.players.length;

      console.log(`[WebSocket] Game completion check FINAL:`);
      console.log(`  - Total players: ${game.players.length}`);
      console.log(`  - Players who finished all rounds: ${playersWhoFinished.length}`);
      console.log(`  - All players finished: ${allPlayersReallyFinished}`);
      
      playerCompletionCheck.forEach(({ playerName, completedRounds, hasFinished }) => {
        console.log(`  - ${playerName}: ${completedRounds}/${totalRounds} rounds (${hasFinished ? '✅ FINISHED' : '❌ NOT FINISHED'})`);
      });

      if (allPlayersReallyFinished) {
        console.log(`[WebSocket] ✅ All players have really finished! Ending game properly.`);
        
        const finishResult = await GameService.finishGameIfAllPlayersReady(gameId);
        
        if (finishResult.canFinish) {
          this.broadcastToParty(partyId, 'game_finished', {
            gameId,
            finalResults: true,
            winner: finishResult.game?.winner ? {
              id: finishResult.game.winner.id,
              name: finishResult.game.winner.name
            } : null
          });
          
          partyRoom.gameState = undefined;
          
          console.log(`[WebSocket] 🎉 Game ${gameId} successfully finished for party ${partyId}`);
        } else {
          console.warn(`[WebSocket] GameService says game cannot finish yet for game ${gameId}`);
          console.warn(`[WebSocket] Players still playing according to GameService: ${finishResult.playersStillPlaying}`);
          
          this.broadcastToParty(partyId, 'game_waiting_for_players', {
            gameId,
            playersStillPlaying: finishResult.playersStillPlaying,
            message: `Waiting for ${finishResult.playersStillPlaying} player(s) to finish`
          });
        }
      } else {
        console.log(`[WebSocket] ⏳ Not all players have finished yet. Current status:`);
        
        const playersStillPlaying = game.players.length - playersWhoFinished.length;
        
        this.broadcastToParty(partyId, 'game_waiting_for_players', {
          gameId,
          playersStillPlaying,
          message: `Waiting for ${playersStillPlaying} player(s) to finish all rounds`
        });
        
        console.log(`[WebSocket] 📢 Broadcasted waiting message for ${playersStillPlaying} remaining players`);
      }
    } catch (error) {
      console.error(`[WebSocket] Error handling game end:`, error);
      this.broadcastToParty(partyId, 'error', {
        message: 'Error ending game: ' + (error instanceof Error ? error.message : 'Unknown error')
      });
    } finally {
      partyRoom.gameState?.debounce.pendingOperations.delete('game_end');
    }
  }

  public async forcePartySync(partyId: number) {
    console.log(`[WebSocket] Force syncing party ${partyId}`);
    
    const party = await Party.findOne({
      where: { id: partyId },
      relations: ['admin', 'players']
    });

    if (!party) {
      console.error(`[WebSocket] Party ${partyId} not found for sync`);
      return;
    }

    const connectedSockets = Array.from(this.io.sockets.sockets.values()) as AuthenticatedSocket[];
    
    const partyPlayerSockets = connectedSockets.filter(s => 
      s.userId && party.players.some(p => p.id === s.userId)
    );

    console.log(`[WebSocket] Found ${partyPlayerSockets.length} sockets to sync for party ${partyId}`);

    for (const socket of partyPlayerSockets) {
      if (socket.currentPartyId !== partyId) {
        console.log(`[WebSocket] Syncing ${socket.userName} to party ${partyId}`);
        try {
          await this.handleJoinParty(socket, partyId);
        } catch (error) {
          console.error(`[WebSocket] Failed to sync ${socket.userName} to party ${partyId}:`, error);
        }
      }
    }
  }

  public broadcastToParty(partyId: number, event: string, data: any) {
    console.log(`[WebSocket] Broadcasting ${event} to party ${partyId}:`, data);
    this.io.to(`party_${partyId}`).emit(event, data);
  }

  public getStats() {
    return {
      connectedUsers: this.io.sockets.sockets.size,
      activeParties: this.partyRooms.size,
      parties: Array.from(this.partyRooms.values()).map(room => ({
        partyId: room.partyId,
        playerCount: room.players.size,
        hasActiveGame: !!room.gameState,
        currentRound: room.gameState?.currentRound,
        totalRounds: room.gameState?.totalRounds,
        playersReady: room.gameState?.playersReady.size,
        playersFinished: room.gameState?.playersFinished.size,
        pendingOperations: room.gameState?.debounce.pendingOperations.size || 0
      }))
    };
  }

  public getPartyRoomStats(partyId: number) {
    const room = this.partyRooms.get(partyId);
    if (!room) {
      return { found: false, partyId };
    }

    return {
      found: true,
      partyId: room.partyId,
      playerCount: room.players.size,
      players: Array.from(room.players.values()).map(p => p.user),
      hasGameState: !!room.gameState,
      gameId: room.gameState?.gameId,
      currentRound: room.gameState?.currentRound,
      totalRounds: room.gameState?.totalRounds,
      playersFinished: room.gameState?.playersFinished.size,
      playersReady: room.gameState?.playersReady.size,
      isLastRound: room.gameState?.isLastRound,
      allPlayersFinishedRound: room.gameState?.allPlayersFinishedRound,
      lastActivity: room.gameState?.lastActivity || null,
      pendingOperations: Array.from(room.gameState?.debounce.pendingOperations || [])
    };
  }

  private ensureGameStateLastActivity(partyId: number): void {
    const partyRoom = this.partyRooms.get(partyId);
    if (partyRoom && partyRoom.gameState && !partyRoom.gameState.lastActivity) {
      partyRoom.gameState.lastActivity = new Date();
      console.log(`[WebSocket] Initialized lastActivity for party ${partyId}`);
    }
  }
}