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
        console.log(`[WebSocket] ===== RECEIVED READY_FOR_NEXT_ROUND EVENT =====`);
        console.log(`[WebSocket] From user: ${socket.userName} (${socket.userId})`);
        console.log(`[WebSocket] Data received:`, data);
        console.log(`[WebSocket] Socket currentPartyId: ${socket.currentPartyId}`);
        
        // CORRECTION: Appel async avec gestion d'erreur
        this.handleReadyForNextRound(socket, data.partyId).catch(error => {
          console.error(`[WebSocket] ERROR in ready_for_next_round handler:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to process ready state' });
        });
        
        console.log(`[WebSocket] ===== READY_FOR_NEXT_ROUND EVENT PROCESSED =====`);
      });

      socket.on('get_round_results', (data: { partyId: number }) => {
        this.handleGetRoundResults(socket, data.partyId);
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

    // CORRECTION: Forcer une synchronisation supplémentaire avec await
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
    
    setTimeout(() => {
      this.checkAndTriggerNextRoundIfReady(partyId);
    }, 500);
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
      // Forcer la synchronisation GameService avec la base de données
      await GameService.syncGameStateWithDatabase(gameId);
      
      // Mettre à jour l'état WebSocket
      const gameSync = GameService.getGameSync(gameId);
      if (gameSync) {
        partyRoom.gameState.currentRound = gameSync.currentRound;
        partyRoom.gameState.playersFinished = new Set(gameSync.playersWhoFinished);
        partyRoom.gameState.playersReady = new Set(gameSync.playersReady);
        partyRoom.gameState.allPlayersFinishedRound = gameSync.allPlayersFinished;
        partyRoom.gameState.lastActivity = new Date();
        
        console.log(`[WebSocket] ✅ Force sync completed for party ${partyId}`);
        console.log(`  - Round: ${gameSync.currentRound}`);
        console.log(`  - Players finished: [${Array.from(gameSync.playersWhoFinished).join(', ')}]`);
        console.log(`  - Players ready: [${Array.from(gameSync.playersReady).join(', ')}]`);
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

      // CORRECTION: Toujours forcer la synchronisation avec GameService
      try {
        await GameService.syncGameStateWithDatabase(activeGame.id);
        console.log(`[WebSocket] ✅ Forced GameService sync for game ${activeGame.id}`);
      } catch (err) {
        console.error(`[WebSocket] ⚠️ Failed to sync GameService:`, err);
      }

      const gameSync = GameService.getGameSync(activeGame.id);
      
      if (!gameSync) {
        console.log(`[WebSocket] No game sync found after forced sync, reconstructing from database`);
        await this.reconstructGameStateFromDatabase(activeGame.id, partyId);
      } else {
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
          lastActivity: new Date()
        };
        
        console.log(`[WebSocket] Restored game state from GameService:`);
        console.log(`  - Round: ${gameSync.currentRound}`);
        console.log(`  - Players finished: ${Array.from(gameSync.playersWhoFinished)}`);
        console.log(`  - Players ready: ${Array.from(gameSync.playersReady)}`);
        console.log(`  - All finished: ${gameSync.allPlayersFinished}`);
      }
    }
  }

  // CORRECTION 3: Fonction checkAndTriggerNextRoundIfReady améliorée
  private checkAndTriggerNextRoundIfReady(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) {
      console.log(`[WebSocket] No party room or game state for auto-check on party ${partyId}`);
      return;
    }

    const gameState = partyRoom.gameState;
    const connectedPlayerIds = Array.from(partyRoom.players.keys());

    console.log(`[WebSocket] 🔍 Simple auto-check for party ${partyId}:`);
    console.log(`  - Connected players: [${connectedPlayerIds.join(', ')}]`);
    console.log(`  - Players finished: [${Array.from(gameState.playersFinished).join(', ')}]`);
    console.log(`  - Players ready: [${Array.from(gameState.playersReady).join(', ')}]`);

    // SIMPLIFICATION : Vérifier seulement si tous les joueurs qui ont fini sont prêts
    const finishedPlayersCount = gameState.playersFinished.size;
    const readyPlayersCount = gameState.playersReady.size;
    const allFinishedPlayersReady = readyPlayersCount === finishedPlayersCount && finishedPlayersCount > 0;

    console.log(`[WebSocket] Simple check: ${readyPlayersCount}/${finishedPlayersCount} finished players ready`);

    if (allFinishedPlayersReady) {
      console.log(`[WebSocket] 🚀 ALL FINISHED PLAYERS ARE READY! Auto-triggering next action`);
      
      setTimeout(() => {
        if (gameState.isLastRound) {
          console.log(`[WebSocket] 🏁 Auto-ending game for party ${partyId}`);
          this.handleGameEnd(partyId);
        } else {
          console.log(`[WebSocket] ➡️ Auto-starting next round for party ${partyId}`);
          this.startNextRound(partyId);
        }
      }, 500);
    } else {
      console.log(`[WebSocket] ⏸️ Not all finished players are ready yet`);
    }
  }

  private async reconstructGameStateFromDatabase(gameId: number, partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom) return;

    const game = await Game.findOne({
      where: { id: gameId },
      relations: ['players']
    });

    if (!game) return;

    const gameSync = GameService.initializeGameSync(gameId);

    const playerCompletionStatus = await Promise.all(
      game.players.map(async (player) => {
        const guessCount = await Guess.count({
          where: {
            game: { id: gameId },
            user: { id: player.id }
          }
        });
        return { playerId: player.id, guessCount, totalRounds: game.rounds_number };
      })
    );

    const minGuessCount = Math.min(...playerCompletionStatus.map(p => p.guessCount));
    const currentRound = minGuessCount + 1;
    
    gameSync.currentRound = Math.min(currentRound, game.rounds_number);
    
    playerCompletionStatus.forEach(({ playerId, guessCount }) => {
      if (guessCount >= currentRound) {
        gameSync.playersWhoFinished.add(playerId);
      }
    });

    const allPlayersFinished = gameSync.playersWhoFinished.size === game.players.length;
    gameSync.allPlayersFinished = allPlayersFinished;

    partyRoom.gameState = {
      gameId: gameId,
      currentRound: gameSync.currentRound,
      roundStartTime: new Date(),
      playersReady: gameSync.playersReady,
      playersFinished: gameSync.playersWhoFinished,
      guesses: new Map(),
      waitingForPlayers: !allPlayersFinished && currentRound <= game.rounds_number,
      allPlayersFinishedRound: allPlayersFinished,
      totalRounds: game.rounds_number,
      isLastRound: gameSync.currentRound >= game.rounds_number,
      lastActivity: new Date() // CORRECTION: Ajouter lastActivity
    };

    console.log(`[WebSocket] Reconstructed game state: round ${gameSync.currentRound}, finished players: ${gameSync.playersWhoFinished.size}/${game.players.length}`);
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
            const activeGame = await Game.findOne({
              where: { party: { id: partyId }, status: GameStatus.IN_PROGRESS },
            });
            
            if (activeGame) {
              console.log(`[WebSocket] Party room ${partyId} has an active game (gameId ${activeGame.id}), keeping room in memory`);
              return;
            }

            const party = await Party.findOne({
              where: { id: partyId },
              relations: ['players']
            });
            
            if (!party || party.players.length === 0) {
              console.log(`[WebSocket] Cleaning up empty party room ${partyId}`);
              this.partyRooms.delete(partyId);
            } else {
              console.log(`[WebSocket] Keeping party room ${partyId} - has ${party.players.length} players in DB`);
            }
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
      lastActivity: new Date()
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

  private cleanupInactiveParties() {
    const now = new Date();
    const maxInactiveTime = 30 * 60 * 1000; // 30 minutes

    for (const [partyId, partyRoom] of this.partyRooms.entries()) {
      if (partyRoom.gameState && partyRoom.gameState.lastActivity) {
        const timeSinceLastActivity = now.getTime() - partyRoom.gameState.lastActivity.getTime();
        
        if (timeSinceLastActivity > maxInactiveTime && partyRoom.players.size === 0) {
          console.log(`[WebSocket] Cleaning up inactive party ${partyId} - last activity: ${partyRoom.gameState.lastActivity}`);
          this.partyRooms.delete(partyId);
        }
      }
    }
  }

  private async handleSubmitGuessWithSync(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) throw new Error('User not authenticated');

    if (!socket.currentPartyId) {
      console.log(`[WebSocket] Socket not in party, attempting to join party ${data.partyId}`);
      await this.handleJoinParty(socket, data.partyId);
    }

    const partyRoom = this.partyRooms.get(data.partyId);
    if (!partyRoom || !partyRoom.gameState) {
      console.error(`[WebSocket] No active game found for party ${data.partyId}`);
      await this.restoreGameStateFromDatabase(data.partyId);
      const restoredRoom = this.partyRooms.get(data.partyId);
      if (!restoredRoom || !restoredRoom.gameState) {
        throw new Error('No active game');
      }
    }

    const updatedRoom = this.partyRooms.get(data.partyId)!;

    if (updatedRoom.gameState!.guesses.has(socket.userId)) {
      console.log(`[WebSocket] Player ${socket.userId} already submitted for round ${updatedRoom.gameState!.currentRound}`);
      socket.emit('error', { message: 'You have already submitted a guess for this round' });
      return;
    }

    console.log(`[WebSocket] Processing guess from ${socket.userName} for party ${data.partyId}, round ${updatedRoom.gameState!.currentRound}`);

    try {
      const result = await GameService.processGuessWithSync(
        data.gameId,
        data.relativeId,
        socket.userId,
        data.country
      );

      updatedRoom.gameState!.guesses.set(socket.userId, {
        country: data.country,
        timestamp: new Date(),
        result: result
      });

      updatedRoom.gameState!.playersFinished.add(socket.userId);
      updatedRoom.gameState!.lastActivity = new Date();

      // Envoyer le résultat au joueur qui vient de jouer
      socket.emit('guess_result', {
        ...result,
        isMultiplayer: true
      });

      // Broadcast à TOUS les joueurs que ce joueur a fini
      this.broadcastToParty(data.partyId, 'player_finished_round', {
        playerId: socket.userId,
        playerName: socket.userName,
        finishedCount: updatedRoom.gameState!.playersFinished.size,
        totalPlayers: result.totalPlayers,
        stillWaiting: result.waitingPlayers
      });

      console.log(`[WebSocket] Player ${socket.userName} finished round ${updatedRoom.gameState!.currentRound}. ${updatedRoom.gameState!.playersFinished.size}/${result.totalPlayers} completed`);

      // SIMPLIFICATION : Vérifier si tous les joueurs ont fini
      const allPlayersFinished = updatedRoom.gameState!.playersFinished.size === result.totalPlayers;
      
      if (allPlayersFinished) {
        console.log(`[WebSocket] 🏁 Round ${updatedRoom.gameState!.currentRound} COMPLETE! All players finished.`);
        
        updatedRoom.gameState!.allPlayersFinishedRound = true;
        updatedRoom.gameState!.waitingForPlayers = false;
        
        const roundResults = Array.from(updatedRoom.gameState!.guesses.entries()).map(([playerId, guess]) => {
          const player = updatedRoom.players.get(playerId);
          return {
            playerId,
            playerName: player?.user.name || 'Unknown',
            country: guess.country,
            result: guess.result,
            timestamp: guess.timestamp
          };
        });

        const isLastRound = updatedRoom.gameState!.currentRound >= updatedRoom.gameState!.totalRounds;
        updatedRoom.gameState!.isLastRound = isLastRound;

        // CORRECTION 4: Broadcast round_completed à TOUS immédiatement
        this.broadcastToParty(data.partyId, 'round_completed', {
          roundNumber: updatedRoom.gameState!.currentRound,
          results: roundResults,
          isLastRound,
          nextRoundAvailable: !isLastRound
        });

        console.log(`[WebSocket] ✅ Broadcasted round_completed immediately to party ${data.partyId}`);

        // CORRECTION 5: Auto-ready avec délai pour laisser le temps au frontend
        setTimeout(() => {
          this.autoReadyAllFinishedPlayers(data.partyId);
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
    const connectedPlayerIds = Array.from(partyRoom.players.keys());
    
    // CORRECTION 1: FORCER un broadcast round_completed à TOUS les joueurs d'abord
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

    // CORRECTION 2: Broadcaster round_completed à TOUS avant l'auto-ready
    this.broadcastToParty(partyId, 'round_completed', {
      roundNumber: gameState.currentRound,
      results: roundResults,
      isLastRound,
      nextRoundAvailable: !isLastRound
    });

    console.log(`[WebSocket] ✅ Force-broadcasted round_completed to ALL players in party ${partyId}`);

    // Attendre un peu pour que tous reçoivent l'événement
    setTimeout(() => {
      // Auto-ready tous les joueurs connectés qui ont fini mais ne sont pas encore ready
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

      // Si des joueurs ont été auto-ready, broadcaster la mise à jour
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

        // Si tous les joueurs qui ont fini sont prêts, démarrer le round suivant
        if (allPlayersReady) {
          console.log(`[WebSocket] 🚀 All finished players are ready! Starting next round`);
          setTimeout(() => {
            if (gameState.isLastRound) {
              this.handleGameEnd(partyId);
            } else {
              this.startNextRound(partyId);
            }
          }, 1000);
        }
      }
    }, 1000); // Délai pour s'assurer que tous ont reçu round_completed
  }

  private async sendRoundResultsToAll(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    const gameState = partyRoom.gameState;
    
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

    console.log(`[WebSocket] Round ${gameState.currentRound} completed for party ${partyId}. Last round: ${isLastRound}`);
  }

  // CORRECTION 5: Fonction handleReadyForNextRound complètement réécrite
  private async handleReadyForNextRound(socket: AuthenticatedSocket, partyId: number) {
    console.log(`[WebSocket] ===== READY FOR NEXT ROUND =====`);
    console.log(`[WebSocket] User: ${socket.userName} (${socket.userId})`);
    console.log(`[WebSocket] Party ID: ${partyId}`);

    if (!socket.userId) {
      console.error(`[WebSocket] ERROR: No userId for socket`);
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
      console.error(`[WebSocket] ERROR: No party room or game state found for partyId ${partyId}`);
      
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
    
    console.log(`[WebSocket] Game State BEFORE sync:`);
    console.log(`  - Current round: ${gameState.currentRound}`);
    console.log(`  - Players finished current: [${Array.from(gameState.playersFinished).join(', ')}]`);
    console.log(`  - Players ready: [${Array.from(gameState.playersReady).join(', ')}]`);

    // CORRECTION: FORCER la synchronisation avec GameService
    try {
      console.log(`[WebSocket] 🔄 Force syncing game state with database for game ${gameState.gameId}`);
      
      await GameService.syncGameStateWithDatabase(gameState.gameId);
      
      const gameServiceState = GameService.getGameSync(gameState.gameId);
      if (gameServiceState) {
        console.log(`[WebSocket] 📊 GameService state found:`);
        console.log(`  - Last completed round: ${(gameServiceState as any).lastCompletedRound || 'N/A'}`);
        console.log(`  - Current round: ${gameServiceState.currentRound}`);
        console.log(`  - Players finished current: [${Array.from(gameServiceState.playersWhoFinished).join(', ')}]`);
        console.log(`  - Players finished last: [${Array.from((gameServiceState as any).playersWhoFinishedLastRound || []).join(', ')}]`);
        console.log(`  - Players ready: [${Array.from(gameServiceState.playersReady).join(', ')}]`);
        
        // Mettre à jour l'état WebSocket avec les données de GameService
        gameState.currentRound = gameServiceState.currentRound;
        gameState.playersFinished = new Set(gameServiceState.playersWhoFinished);
        gameState.playersReady = new Set(gameServiceState.playersReady);
        gameState.allPlayersFinishedRound = gameServiceState.allPlayersFinished;
        
        console.log(`[WebSocket] ✅ Updated WebSocket state from GameService`);
      } else {
        console.log(`[WebSocket] ⚠️ No GameService state found after sync`);
        socket.emit('error', { message: 'Failed to synchronize game state' });
        return;
      }
    } catch (err) {
      console.error(`[WebSocket] ❌ Failed to sync with GameService:`, err);
      socket.emit('error', { message: 'Failed to synchronize with game server' });
      return;
    }

    console.log(`[WebSocket] Game State AFTER sync:`);
    console.log(`  - Current round: ${gameState.currentRound}`);
    console.log(`  - Players finished current: [${Array.from(gameState.playersFinished).join(', ')}]`);
    console.log(`  - Players ready: [${Array.from(gameState.playersReady).join(', ')}]`);

    // CORRECTION: Vérification plus intelligente de l'éligibilité
    const gameServiceState = GameService.getGameSync(gameState.gameId);
    let playerCanBeReady = false;
    
    if (gameServiceState) {
      // Vérifier si le joueur a fini le dernier round complété OU le round actuel
      const finishedLastRound = (gameServiceState as any).playersWhoFinishedLastRound?.has(socket.userId) || false;
      const finishedCurrentRound = gameServiceState.playersWhoFinished.has(socket.userId);
      
      playerCanBeReady = finishedLastRound || finishedCurrentRound;
      
      console.log(`[WebSocket] 🔍 Player ${socket.userId} eligibility check:`);
      console.log(`  - Finished last completed round: ${finishedLastRound}`);
      console.log(`  - Finished current round: ${finishedCurrentRound}`);
      console.log(`  - Can be ready: ${playerCanBeReady}`);
      
      if (!playerCanBeReady) {
        // Vérifier directement dans la base de données
        try {
          const hasFinishedAnyRound = await GameService.hasPlayerFinishedRound(gameState.gameId, socket.userId, gameState.currentRound - 1) ||
                                    await GameService.hasPlayerFinishedRound(gameState.gameId, socket.userId, gameState.currentRound);
          
          if (hasFinishedAnyRound) {
            console.log(`[WebSocket] ✅ Player ${socket.userId} found eligible via database check`);
            playerCanBeReady = true;
          }
        } catch (dbErr) {
          console.error(`[WebSocket] ❌ Database check failed:`, dbErr);
        }
      }
    }

    if (!playerCanBeReady) {
      console.warn(`[WebSocket] ❌ Player ${socket.userId} is not eligible to be ready`);
      socket.emit('error', { 
        message: 'You must finish the current round before being ready',
        debug: {
          currentRound: gameState.currentRound,
          playersFinished: Array.from(gameState.playersFinished),
          userId: socket.userId
        }
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
        console.warn(`[WebSocket] ⚠️ Failed to sync with GameService:`, err);
      }
    } else {
      console.log(`[WebSocket] ℹ️ Player ${socket.userId} was already ready`);
    }

    gameState.lastActivity = new Date();
    
    // CORRECTION: Calculer correctement le statut "all ready"
    const eligiblePlayers = new Set<number>();
    if (gameServiceState) {
      // Ajouter tous les joueurs qui ont fini le dernier round OU le round actuel
      (gameServiceState as any).playersWhoFinishedLastRound?.forEach((id: number) => eligiblePlayers.add(id));
      gameServiceState.playersWhoFinished.forEach((id: number) => eligiblePlayers.add(id));
    }
    
    const readyCount = gameState.playersReady.size;
    const eligibleCount = eligiblePlayers.size;
    const allPlayersReady = eligibleCount > 0 && readyCount === eligibleCount;

    console.log(`[WebSocket] Ready Status:`);
    console.log(`  - Eligible players: ${eligibleCount} [${Array.from(eligiblePlayers).join(', ')}]`);
    console.log(`  - Ready players: ${readyCount} [${Array.from(gameState.playersReady).join(', ')}]`);
    console.log(`  - All eligible ready: ${allPlayersReady}`);

    // Broadcast immédiat du statut
    this.broadcastToParty(partyId, 'player_ready_update', {
      playerId: socket.userId,
      playerName: socket.userName,
      readyCount,
      totalPlayers: eligibleCount,
      allPlayersReady
    });

    // Si tous les joueurs éligibles sont prêts, passer au round suivant
    if (allPlayersReady) {
      console.log(`[WebSocket] 🚀 ALL ELIGIBLE PLAYERS ARE READY! Starting next round`);
      
      setTimeout(() => {
        if (gameState.isLastRound) {
          console.log(`[WebSocket] 🏁 Ending game for party ${partyId}`);
          this.handleGameEnd(partyId);
        } else {
          console.log(`[WebSocket] ➡️ Starting next round for party ${partyId}`);
          this.startNextRound(partyId);
        }
      }, 500);
    } else {
      console.log(`[WebSocket] ⏸️ Waiting for more players to be ready (${readyCount}/${eligibleCount})`);
      const playersNotReady = Array.from(eligiblePlayers).filter((playerId: number) => !gameState.playersReady.has(playerId));
      console.log(`[WebSocket] Players not ready: [${playersNotReady.join(', ')}]`);
    }
    
    console.log(`[WebSocket] ===== END READY FOR NEXT ROUND =====`);
  }

  // CORRECTION 11: Fonction startNextRound améliorée
  private async startNextRound(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) {
      console.error(`[WebSocket] No party room or game state for starting next round on party ${partyId}`);
      return;
    }

    const gameState = partyRoom.gameState;
    
    console.log(`[WebSocket] 🚀 Starting next round for party ${partyId}`);
    console.log(`[WebSocket] Current round: ${gameState.currentRound} -> ${gameState.currentRound + 1}`);
    
    try {
      await GameService.moveToNextRound(gameState.gameId);
      console.log(`[WebSocket] ✅ GameService synchronized for next round`);
    } catch (err) {
      console.error(`[WebSocket] ❌ Failed to sync with GameService:`, err);
    }
    
    // Mettre à jour l'état local
    gameState.currentRound++;
    gameState.playersReady.clear();
    gameState.playersFinished.clear();
    gameState.guesses.clear();
    gameState.roundStartTime = new Date();
    gameState.allPlayersFinishedRound = false;
    gameState.waitingForPlayers = false;
    gameState.isLastRound = gameState.currentRound >= gameState.totalRounds;
    gameState.lastActivity = new Date(); // CORRECTION: Mettre à jour lastActivity

    console.log(`[WebSocket] 📊 New round state:`);
    console.log(`  - Round: ${gameState.currentRound}/${gameState.totalRounds}`);
    console.log(`  - Is last round: ${gameState.isLastRound}`);
    console.log(`  - Players ready: ${gameState.playersReady.size}`);
    console.log(`  - Players finished: ${gameState.playersFinished.size}`);

    // Broadcast du démarrage du nouveau round
    this.broadcastToParty(partyId, 'round_started', {
      roundNumber: gameState.currentRound,
      totalRounds: gameState.totalRounds,
      startTime: gameState.roundStartTime
    });

    console.log(`[WebSocket] ✅ Round ${gameState.currentRound} started for party ${partyId}`);
  }

  private async handleGameEnd(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    const gameId = partyRoom.gameState.gameId;
    
    console.log(`[WebSocket] Handling game end for party ${partyId}, game ${gameId}`);

    try {
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
        
        console.log(`[WebSocket] Game ${gameId} finished for party ${partyId}`);
      } else {
        this.broadcastToParty(partyId, 'game_waiting_for_players', {
          gameId,
          playersStillPlaying: finishResult.playersStillPlaying,
          message: `Waiting for ${finishResult.playersStillPlaying} player(s) to finish`
        });
        
        console.log(`[WebSocket] Game ${gameId} waiting for ${finishResult.playersStillPlaying} players to finish`);
      }
    } catch (error) {
      console.error(`[WebSocket] Error handling game end:`, error);
      this.broadcastToParty(partyId, 'error', {
        message: 'Error ending game: ' + (error instanceof Error ? error.message : 'Unknown error')
      });
    }
  }

  private handleGetRoundResults(socket: AuthenticatedSocket, partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) {
      socket.emit('error', { message: 'No active game' });
      return;
    }

    if (!partyRoom.gameState.allPlayersFinishedRound) {
      socket.emit('error', { message: 'Round not completed yet' });
      return;
    }

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

    socket.emit('round_results', {
      roundNumber: partyRoom.gameState.currentRound,
      results: roundResults
    });
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
    console.log(`[WebSocket] 📡 Broadcasting ${event} to party ${partyId}:`, data);
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
        playersFinished: room.gameState?.playersFinished.size
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
      lastActivity: room.gameState?.lastActivity || null
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