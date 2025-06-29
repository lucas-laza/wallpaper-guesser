import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { User } from './User';
import { Party, PartyStatus } from './Party';
import { Game, GameStatus } from './Game';
import { Round } from './Round'; // CORRECTION: Ajouter l'import Round
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
    // Middleware d'authentification pour les WebSockets
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

      // Rejoint une party room
      socket.on('join_party', async (data: { partyId: number }) => {
        try {
          await this.handleJoinParty(socket, data.partyId);
        } catch (error) {
          console.error(`[WebSocket] Error joining party ${data.partyId}:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to join party' });
        }
      });

      // Quitte une party room
      socket.on('leave_party', () => {
        this.handleLeaveParty(socket);
      });

      // Admin démarre le jeu
      socket.on('start_game', async (data: { partyId: number; config: any }) => {
        try {
          await this.handleStartGame(socket, data.partyId, data.config);
        } catch (error) {
          console.error(`[WebSocket] Error starting game for party ${data.partyId}:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to start game' });
        }
      });

      // Joueur prêt pour le prochain round
      socket.on('player_ready', (data: { partyId: number }) => {
        this.handlePlayerReady(socket, data.partyId);
      });

      // Soumission d'une réponse
      socket.on('submit_guess', async (data: { partyId: number; gameId: number; relativeId: number; country: string }) => {
        try {
          await this.handleSubmitGuess(socket, data);
        } catch (error) {
          console.error(`[WebSocket] Error submitting guess:`, error);
          socket.emit('error', { message: error instanceof Error ? error.message : 'Failed to submit guess' });
        }
      });

      // Demande de passage au round suivant
      socket.on('next_round', (data: { partyId: number }) => {
        this.handleNextRound(socket, data.partyId);
      });

      // Gestion de la déconnexion
      socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id} (User: ${socket.userName})`);
        this.handleLeaveParty(socket);
      });
    });
  }

  private async handleJoinParty(socket: AuthenticatedSocket, partyId: number) {
    if (!socket.userId) throw new Error('User not authenticated');

    console.log(`[WebSocket] User ${socket.userName} attempting to join party ${partyId}`);

    // Vérifier que la party existe et que l'utilisateur en fait partie
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

    // Quitter l'ancienne party si applicable
    if (socket.currentPartyId && socket.currentPartyId !== partyId) {
      this.handleLeaveParty(socket);
    }

    // Rejoindre la nouvelle party room
    socket.currentPartyId = partyId;
    socket.join(`party_${partyId}`);

    // Créer ou récupérer la party room
    if (!this.partyRooms.has(partyId)) {
      console.log(`[WebSocket] Creating new party room for party ${partyId}`);
      this.partyRooms.set(partyId, {
        partyId: partyId,
        players: new Map()
      });
    }

    const partyRoom = this.partyRooms.get(partyId)!;
    
    // CORRECTION: Vérifier si le joueur est déjà dans la room
    if (partyRoom.players.has(socket.userId)) {
      console.log(`[WebSocket] User ${socket.userName} already in party room ${partyId}, updating socket`);
      // Mettre à jour le socket
      partyRoom.players.get(socket.userId)!.socket = socket;
    } else {
      // Ajouter le nouveau joueur
      partyRoom.players.set(socket.userId, {
        socket: socket,
        user: { id: socket.userId, name: socket.userName! }
      });
    }

    // Vérifier s'il y a un jeu actif
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

    // CORRECTION: Créer la liste des joueurs depuis la DB ET WebSocket
    const allPlayers = new Map<number, { id: number; name: string }>();
    
    // Ajouter les joueurs de la DB
    party.players.forEach(player => {
      allPlayers.set(player.id, { id: player.id, name: player.name });
    });
    
    // Marquer les joueurs connectés via WebSocket
    const connectedPlayersList = Array.from(allPlayers.values()).map(player => ({
      ...player,
      isConnected: partyRoom.players.has(player.id)
    }));

    // Notifier tous les joueurs de la party
    this.broadcastToParty(partyId, 'player_joined', {
      user: { id: socket.userId, name: socket.userName },
      players: connectedPlayersList,
      party: {
        id: party.id,
        code: party.code,
        admin: { id: party.admin.id, name: party.admin.name },
        status: party.status
      }
    });

    // Envoyer l'état actuel au joueur qui rejoint
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

    console.log(`[WebSocket] User ${socket.userName} joined party ${partyId}, room now has ${partyRoom.players.size} connected players (${party.players.length} total)`);
  }

  private handleLeaveParty(socket: AuthenticatedSocket) {
    if (!socket.currentPartyId || !socket.userId) return;

    const partyId = socket.currentPartyId;
    const partyRoom = this.partyRooms.get(partyId);

    console.log(`[WebSocket] User ${socket.userName} leaving party ${partyId}`);

    if (partyRoom) {
      partyRoom.players.delete(socket.userId);
      
      // Notifier les autres joueurs
      this.broadcastToParty(partyId, 'player_left', {
        user: { id: socket.userId, name: socket.userName },
        players: Array.from(partyRoom.players.values()).map(p => p.user)
      });

      // CORRECTION: Ne pas supprimer la room immédiatement, attendre un délai
      if (partyRoom.players.size === 0) {
        console.log(`[WebSocket] Party room ${partyId} is empty, scheduling cleanup in 30 seconds`);
        
        // Attendre 30 secondes avant de supprimer pour permettre aux reconnexions
        setTimeout(async () => {
          const currentRoom = this.partyRooms.get(partyId);
          if (currentRoom && currentRoom.players.size === 0) {
            // Vérifier aussi en base de données si la party existe encore
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
      try {
        await this.handleJoinParty(socket, partyId);
        partyRoom = this.partyRooms.get(partyId);
        if (!partyRoom) {
          throw new Error('Party room not found and could not be created');
        }
      } catch (error) {
        console.error(`[WebSocket] Failed to recreate party room ${partyId}:`, error);
        throw new Error('Party room not found and could not be created');
      }
    }

    // Vérifier que c'est l'admin qui démarre
    const party = await Party.findOne({
      where: { id: partyId },
      relations: ['admin', 'players']
    });

    if (!party || party.admin.id !== socket.userId) {
      throw new Error('Only the party admin can start the game');
    }

    console.log(`[WebSocket] Starting game for party ${partyId} with config:`, config);

    // Démarrer le jeu via le service
    const game = await GameService.startPartyGame(partyId, socket.userId, config);

    // Mettre à jour l'état de la room
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
      config: {
        roundsNumber: game.rounds_number,
        time: game.time,
        map: game.map
      },
      currentRound: 1
    };

    // CORRECTION: Broadcast vers la room ET vers tous les sockets individuels
    this.broadcastToParty(partyId, 'game_started', gameStartData);
    socket.emit('game_started', gameStartData);

    // CORRECTION: Envoyer l'événement à TOUS les joueurs de la party, même non connectés en WebSocket
    const playersInDB = party.players;
    const connectedSockets = Array.from(this.io.sockets.sockets.values()) as AuthenticatedSocket[];
    
    console.log(`[WebSocket] Checking ${connectedSockets.length} total connected sockets`);
    
    // Chercher tous les sockets des joueurs de cette party
    const partyPlayerSockets = connectedSockets.filter(s => 
      s.userId && playersInDB.some(p => p.id === s.userId)
    );

    console.log(`[WebSocket] Found ${partyPlayerSockets.length} sockets for party players`);
    
    // Envoyer l'événement directement à chaque socket de joueur
    partyPlayerSockets.forEach(playerSocket => {
      console.log(`[WebSocket] Sending game_started to ${playerSocket.userName} (${playerSocket.userId})`);
      playerSocket.emit('game_started', gameStartData);
      
      // CORRECTION: Forcer le socket à rejoindre la party room s'il ne l'a pas fait
      if (playerSocket.currentPartyId !== partyId) {
        console.log(`[WebSocket] Forcing ${playerSocket.userName} to join party room ${partyId}`);
        playerSocket.currentPartyId = partyId;
        playerSocket.join(`party_${partyId}`);
        
        // Ajouter à la room WebSocket
        if (!partyRoom.players.has(playerSocket.userId!)) {
          partyRoom.players.set(playerSocket.userId!, {
            socket: playerSocket,
            user: { id: playerSocket.userId!, name: playerSocket.userName! }
          });
        }
      }
    });

    const playersInWebSocket = Array.from(partyRoom.players.keys());
    console.log(`[WebSocket] Players in DB: ${playersInDB.map(p => p.id).join(', ')}`);
    console.log(`[WebSocket] Players in WebSocket: ${playersInWebSocket.join(', ')}`);
    console.log(`[WebSocket] Party player sockets found: ${partyPlayerSockets.map(s => s.userName).join(', ')}`);

    const missingPlayers = playersInDB.filter(p => !partyPlayerSockets.some(s => s.userId === p.id));
    if (missingPlayers.length > 0) {
      console.warn(`[WebSocket] ${missingPlayers.length} players not connected via WebSocket: ${missingPlayers.map(p => p.name).join(', ')}`);
      
      // CORRECTION: Pour les joueurs non connectés, essayer de les forcer à rejoindre
      // En attendant leur prochaine connexion, stocker l'info qu'ils doivent rejoindre le jeu
      missingPlayers.forEach(player => {
        console.log(`[WebSocket] Player ${player.name} (${player.id}) should connect to game ${game.id}`);
        // TODO: Possibilité d'ajouter une notification persistante ici
      });
    }

    console.log(`[WebSocket] Game start event sent to ${partyPlayerSockets.length} player sockets`);
  }

  // CORRECTION: Nouvelle méthode pour forcer la synchronisation des joueurs
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

    // Récupérer tous les sockets connectés
    const connectedSockets = Array.from(this.io.sockets.sockets.values()) as AuthenticatedSocket[];
    
    // Trouver les sockets des joueurs de cette party
    const partyPlayerSockets = connectedSockets.filter(s => 
      s.userId && party.players.some(p => p.id === s.userId)
    );

    console.log(`[WebSocket] Found ${partyPlayerSockets.length} sockets to sync for party ${partyId}`);

    // Forcer tous les joueurs à rejoindre la party room
    partyPlayerSockets.forEach(async (socket) => {
      if (socket.currentPartyId !== partyId) {
        console.log(`[WebSocket] Syncing ${socket.userName} to party ${partyId}`);
        try {
          await this.handleJoinParty(socket, partyId);
        } catch (error) {
          console.error(`[WebSocket] Failed to sync ${socket.userName} to party ${partyId}:`, error);
        }
      }
    });
  }

  private handlePlayerReady(socket: AuthenticatedSocket, partyId: number) {
    if (!socket.userId) return;

    const partyRoom = this.partyRooms.get(partyId);
    if (!partyRoom || !partyRoom.gameState) return;

    partyRoom.gameState.playersReady.add(socket.userId);

    // Vérifier si tous les joueurs sont prêts
    const allPlayersReady = partyRoom.gameState.playersReady.size === partyRoom.players.size;

    this.broadcastToParty(partyId, 'player_ready_update', {
      playerId: socket.userId,
      readyCount: partyRoom.gameState.playersReady.size,
      totalPlayers: partyRoom.players.size,
      allReady: allPlayersReady
    });

    if (allPlayersReady) {
      // Démarrer le round
      this.startRound(partyId);
    }
  }

  private async handleSubmitGuess(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) throw new Error('User not authenticated');

    const partyRoom = this.partyRooms.get(data.partyId);
    if (!partyRoom || !partyRoom.gameState) throw new Error('No active game');

    // Traiter la réponse
    const result = await GameService.processGuess(
      data.gameId,
      data.relativeId,
      socket.userId,
      data.country
    );

    // Enregistrer la réponse
    partyRoom.gameState.guesses.set(socket.userId, {
      country: data.country,
      timestamp: new Date()
    });

    // Envoyer le résultat au joueur
    socket.emit('guess_result', result);

    // Notifier aux autres joueurs qu'une réponse a été soumise
    socket.to(`party_${data.partyId}`).emit('player_submitted', {
      playerId: socket.userId,
      playerName: socket.userName,
      submittedCount: partyRoom.gameState.guesses.size,
      totalPlayers: partyRoom.players.size
    });

    // Si tous les joueurs ont répondu, montrer les résultats
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

    // Calculer les résultats pour tous les joueurs
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

    // Réinitialiser pour le prochain round
    partyRoom.gameState.playersReady.clear();
  }

  private broadcastToParty(partyId: number, event: string, data: any) {
    this.io.to(`party_${partyId}`).emit(event, data);
  }

  // Méthode publique pour obtenir des statistiques
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

  // Méthode pour débugger l'état des rooms
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