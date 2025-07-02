import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { User } from './User';
import { Party, PartyStatus } from './Party';
import { Game, GameStatus } from './Game';
import { Round } from './Round';
import { GameService } from './GameService';
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
    guesses: Map<number, { country: string; timestamp: Date }>;
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
        
        console.log(`WebSocket: User ${decoded.name} (${decoded.userId}) connected`);
        next();
      } catch (error) {
        console.error('WebSocket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      console.log(`Socket connected: ${socket.id} (User: ${socket.userName})`);

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

      socket.on('player_ready', (data: { partyId: number }) => {
        this.handlePlayerReady(socket, data.partyId);
      });

      socket.on('submit_guess', async (data: { partyId: number; gameId: number; relativeId: number; country: string }) => {
        try {
          await this.handleSubmitGuess(socket, data);
        } catch (error) {
          console.error(`[WebSocket] Error submitting guess:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to submit guess' });
        }
      });

      socket.on('next_round', (data: { partyId: number }) => {
        this.handleNextRound(socket, data.partyId);
      });

      socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id} (User: ${socket.userName})`);
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

    const activeGame = await Game.findOne({
      where: { party: { id: partyId }, status: GameStatus.IN_PROGRESS },
      relations: ['players']
    });

    if (activeGame && !partyRoom.gameState) {
      console.log(`[WebSocket] Found active game ${activeGame.id} for party ${partyId}`);
      const rounds = await Round.find({
        where: { game: { id: activeGame.id } },
        order: { relative_id: 'ASC' }
      });

      partyRoom.gameState = {
        gameId: activeGame.id,
        currentRound: 1,
        roundStartTime: new Date(),
        playersReady: new Set(),
        guesses: new Map()
      };
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
      guesses: new Map()
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

  private handlePlayerReady(socket: AuthenticatedSocket, partyId: number) {
    if (!socket.userId) return;

    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    partyRoom.gameState.playersReady.add(socket.userId);

    const allPlayersReady = partyRoom.gameState.playersReady.size === partyRoom.players.size;

    this.broadcastToParty(partyId, 'player_ready_update', {
      playerId: socket.userId,
      readyCount: partyRoom.gameState.playersReady.size,
      totalPlayers: partyRoom.players.size,
      allReady: allPlayersReady
    });

    if (allPlayersReady) {
      this.startRound(partyId);
    }
  }

  private async handleSubmitGuess(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) throw new Error('User not authenticated');

    const partyRoom = this.partyRooms.get(data.partyId);
    if (!partyRoom || !partyRoom.gameState) throw new Error('No active game');

    const result = await GameService.processGuess(
      data.gameId,
      data.relativeId,
      socket.userId,
      data.country
    );

    partyRoom.gameState.guesses.set(socket.userId, {
      country: data.country,
      timestamp: new Date()
    });

    socket.emit('guess_result', result);

    socket.to(`party_${data.partyId}`).emit('player_submitted', {
      playerId: socket.userId,
      playerName: socket.userName,
      submittedCount: partyRoom.gameState.guesses.size,
      totalPlayers: partyRoom.players.size
    });

    if (partyRoom.gameState.guesses.size === partyRoom.players.size) {
      this.showRoundResults(data.partyId);
    }
  }

  private handleNextRound(socket: AuthenticatedSocket, partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    partyRoom.gameState.currentRound++;
    partyRoom.gameState.playersReady.clear();
    partyRoom.gameState.guesses.clear();
    partyRoom.gameState.roundStartTime = new Date();

    this.broadcastToParty(partyId, 'round_started', {
      roundNumber: partyRoom.gameState.currentRound,
      startTime: partyRoom.gameState.roundStartTime
    });
  }

  private startRound(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    partyRoom.gameState.roundStartTime = new Date();
    partyRoom.gameState.guesses.clear();

    this.broadcastToParty(partyId, 'round_started', {
      roundNumber: partyRoom.gameState.currentRound,
      startTime: partyRoom.gameState.roundStartTime
    });
  }

  private showRoundResults(partyId: number) {
    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    const results = Array.from(partyRoom.gameState.guesses.entries()).map(([playerId, guess]) => {
      const player = partyRoom.players.get(playerId);
      return {
        playerId,
        playerName: player?.user.name || 'Unknown',
        guess: guess.country,
        timestamp: guess.timestamp
      };
    });

    this.broadcastToParty(partyId, 'round_results', {
      roundNumber: partyRoom.gameState.currentRound,
      results: results
    });

    partyRoom.gameState.playersReady.clear();
  }

  private broadcastToParty(partyId: number, event: string, data: any) {
    this.io.to(`party_${partyId}`).emit(event, data);
  }

  public getStats() {
    return {
      connectedUsers: this.io.sockets.sockets.size,
      activeParties: this.partyRooms.size,
      parties: Array.from(this.partyRooms.values()).map(room => ({
        partyId: room.partyId,
        playerCount: room.players.size,
        hasActiveGame: !!room.gameState
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
      gameId: room.gameState?.gameId
    };
  }
}