// useWebSocket.ts - Corrections pour la synchronisation multijoueur

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../services/api';
import { useNavigate } from 'react-router-dom';

// Événements WebSocket
export interface WebSocketEvents {
  player_joined: (data: { user: { id: number; name: string }; players: any[]; party: any }) => void;
  player_left: (data: { user: { id: number; name: string }; players: any[] }) => void;
  party_updated: (data: { partyId: number; players: any[] }) => void;
  game_started: (data: { gameId: number; config: any; currentRound: number; partyId?: number }) => void;
  party_state: (data: { party: any; players: any[]; gameState?: any }) => void;
  
  // Événements de synchronisation des rounds
  player_finished_round: (data: { 
    playerId: number; 
    playerName: string; 
    finishedCount: number; 
    totalPlayers: number; 
    stillWaiting: number; 
  }) => void;
  
  round_completed: (data: { 
    roundNumber: number; 
    results: Array<{
      playerId: number;
      playerName: string;
      country: string;
      result: any;
      timestamp: Date;
    }>;
    isLastRound: boolean;
    nextRoundAvailable: boolean;
  }) => void;
  
  player_ready_update: (data: { 
    playerId: number; 
    playerName: string; 
    readyCount: number; 
    totalPlayers: number; 
    allPlayersReady: boolean; 
  }) => void;
  
  round_started: (data: { 
    roundNumber: number; 
    totalRounds: number; 
    startTime: Date; 
  }) => void;
  
  game_finished: (data: { 
    gameId: number; 
    finalResults: boolean; 
    winner?: { id: number; name: string }; 
  }) => void;
  
  game_waiting_for_players: (data: { 
    gameId: number; 
    playersStillPlaying: number; 
    message: string; 
  }) => void;
  
  player_submitted: (data: { 
    playerId: number; 
    playerName: string; 
    submittedCount: number; 
    totalPlayers: number; 
  }) => void;
  
  round_results: (data: { 
    roundNumber: number; 
    results: Array<{
      playerId: number;
      playerName: string;
      country: string;
      result: any;
      timestamp: Date;
    }>;
  }) => void;

  guess_result: (data: {
    roundId: number;
    relative_id: number;
    guessNumber: number;
    isCorrect: boolean;
    score: number;
    correctLocation: {
      country: { code: string; text: string };
      state?: { code: string; text: string };
      title: string;
      tags: string[];
    };
    userGuess: {
      country: string;
    };
    isMultiplayer?: boolean;
    roundComplete?: boolean;
    waitingPlayers?: number;
    totalPlayers?: number;
  }) => void;
  
  error: (data: { message: string }) => void;
}

export const useWebSocket = (
  url: string = 'http://localhost:3300',
  setPartyState?: (data: { partyId: number; players: any[] }) => void
) => {
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  // CORRECTION 1: Meilleure gestion des handlers d'événements
  const eventHandlers = useRef<Partial<WebSocketEvents>>({});
  const initialized = useRef(false);
  const connectionId = useRef<string | null>(null);
  const maxReconnectAttempts = 5;

  // CORRECTION 2: Fonction de nettoyage des événements
  const cleanupEventHandlers = useCallback((socket: Socket) => {
    console.log('[useWebSocket] Cleaning up event handlers');
    
    Object.keys(eventHandlers.current).forEach(event => {
      socket.off(event);
    });
    
    // Nettoyer les événements globaux
    socket.off('connect');
    socket.off('disconnect');
    socket.off('connect_error');
    socket.off('game_started');
    socket.off('party_updated');
  }, []);

  // CORRECTION 3: Fonction d'attachement des handlers améliorée
  const attachEventHandlers = useCallback((socket: Socket) => {
    console.log('[useWebSocket] Attaching event handlers');
    
    // Nettoyer d'abord les handlers existants
    cleanupEventHandlers(socket);
    
    // Attacher les handlers personnalisés
    Object.entries(eventHandlers.current).forEach(([event, handler]) => {
      if (handler) {
        console.log(`[useWebSocket] Attaching handler for: ${event}`);
        socket.on(event, handler);
      }
    });

    // Handler pour la mise à jour de la party
    if (setPartyState) {
      socket.on('party_updated', setPartyState);
    }

    // CORRECTION 4: Handler game_started amélioré
    socket.on('game_started', (data) => {
      console.log('🎮 [useWebSocket] game_started received:', data);
      if (data.gameId) {
        console.log('🎮 [useWebSocket] Navigating to:', `/game/${data.gameId}`);
        // Petit délai pour s'assurer que l'état est bien synchronisé
        setTimeout(() => {
          navigate(`/game/${data.gameId}`);
        }, 500);
      } else {
        console.error('🎮 [useWebSocket] No gameId in game_started data');
      }
    });

    // Handlers pour les événements de synchronisation
    const syncEventHandlers = {
      player_finished_round: (data: any) => {
        console.log('🎯 [useWebSocket] player_finished_round:', data);
      },
      round_completed: (data: any) => {
        console.log('🏁 [useWebSocket] round_completed:', data);
      },
      player_ready_update: (data: any) => {
        console.log('✅ [useWebSocket] player_ready_update:', data);
      },
      round_started: (data: any) => {
        console.log('🚀 [useWebSocket] round_started:', data);
      },
      game_finished: (data: any) => {
        console.log('🎉 [useWebSocket] game_finished:', data);
      },
      game_waiting_for_players: (data: any) => {
        console.log('⏳ [useWebSocket] game_waiting_for_players:', data);
      },
      player_submitted: (data: any) => {
        console.log('📝 [useWebSocket] player_submitted:', data);
      },
      guess_result: (data: any) => {
        console.log('🎲 [useWebSocket] guess_result:', data);
      }
    };

    Object.entries(syncEventHandlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });
  }, [setPartyState, navigate, cleanupEventHandlers]);

  // CORRECTION 5: Fonction de reconnexion
  const attemptReconnect = useCallback(() => {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error('[useWebSocket] Max reconnection attempts reached');
      setError('Connection failed after multiple attempts');
      return;
    }

    console.log(`[useWebSocket] Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})`);
    setReconnectAttempts(prev => prev + 1);
    
    setTimeout(() => {
      const token = getToken();
      if (token && !socket?.connected) {
        initializeConnection();
      }
    }, Math.pow(2, reconnectAttempts) * 1000); // Backoff exponentiel
  }, [reconnectAttempts, socket]);

  // CORRECTION 6: Fonction d'initialisation de connexion
  const initializeConnection = useCallback(() => {
    const token = getToken();
    if (!token) {
      setError('No authentication token found');
      return;
    }

    console.log('[useWebSocket] Initializing WebSocket connection');

    // Fermer la connexion existante si elle existe
    if (socket) {
      cleanupEventHandlers(socket);
      socket.close();
    }

    const newSocket = io(url, {
      auth: { token },
      transports: ['polling', 'websocket'],
      upgrade: true,
      forceNew: true,
      timeout: 10000,
      reconnection: false // Gérer la reconnexion manuellement
    });

    // Gestionnaires de connexion
    newSocket.on('connect', () => {
      console.log('[useWebSocket] Connected to WebSocket server');
      connectionId.current = newSocket.id;
      setIsConnected(true);
      setError(null);
      setReconnectAttempts(0);
      
      attachEventHandlers(newSocket);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[useWebSocket] Disconnected from WebSocket server:', reason);
      setIsConnected(false);
      
      // Tenter une reconnexion automatique si ce n'est pas une déconnexion volontaire
      if (reason === 'io server disconnect' || reason === 'transport close') {
        attemptReconnect();
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('[useWebSocket] Connection error:', err);
      setError(err.message);
      setIsConnected(false);
      
      // Tenter une reconnexion
      attemptReconnect();
    });

    setSocket(newSocket);
  }, [url, socket, attachEventHandlers, cleanupEventHandlers, attemptReconnect]);

  // CORRECTION 7: Initialisation avec gestion des doublons
  useEffect(() => {
    if (initialized.current) return;
    
    initialized.current = true;
    initializeConnection();

    return () => {
      console.log('[useWebSocket] Cleaning up WebSocket connection');
      if (socket) {
        cleanupEventHandlers(socket);
        socket.close();
      }
      initialized.current = false;
    };
  }, []);

  // CORRECTION 8: Fonction on améliorée
  const on = useCallback(<K extends keyof WebSocketEvents>(event: K, handler: WebSocketEvents[K]) => {
    console.log(`[useWebSocket] Registering handler for: ${event}`);
    eventHandlers.current[event] = handler;
    
    if (socket && isConnected) {
      socket.on(event as string, handler);
    }
  }, [socket, isConnected]);

  // CORRECTION 9: Fonction off améliorée
  const off = useCallback((event: keyof WebSocketEvents) => {
    console.log(`[useWebSocket] Removing handler for: ${event}`);
    delete eventHandlers.current[event];
    if (socket) {
      socket.off(event as string);
    }
  }, [socket]);

  // CORRECTION 10: Fonction emit avec retry
  const emit = useCallback((event: string, data?: any) => {
    if (socket && isConnected) {
      console.log(`[useWebSocket] Emitting: ${event}`, data);
      socket.emit(event, data);
    } else {
      console.warn(`[useWebSocket] Cannot emit ${event} - socket not connected`, {
        hasSocket: !!socket,
        isConnected,
        socketId: socket?.id
      });
      
      // CORRECTION 11: Retry automatique si pas connecté
      if (socket && !isConnected) {
        console.log('[useWebSocket] Attempting to reconnect for emit...');
        attemptReconnect();
      }
    }
  }, [socket, isConnected, attemptReconnect]);

  // CORRECTION 12: Fonction de reconnexion manuelle
  const reconnect = useCallback(() => {
    console.log('[useWebSocket] Manual reconnection requested');
    setReconnectAttempts(0);
    initializeConnection();
  }, [initializeConnection]);

  // CORRECTION 13: Fonction pour vérifier l'état de la connexion
  const checkConnection = useCallback(() => {
    return {
      isConnected,
      socketId: socket?.id,
      connectionId: connectionId.current,
      reconnectAttempts,
      hasSocket: !!socket
    };
  }, [isConnected, socket, reconnectAttempts]);

  return {
    socket,
    isConnected,
    error,
    reconnectAttempts,
    on,
    off,
    emit,
    reconnect,
    checkConnection,
    
    // Méthodes existantes
    joinParty: useCallback((partyId: number) => emit('join_party', { partyId }), [emit]),
    leaveParty: useCallback(() => emit('leave_party'), [emit]),
    startGame: useCallback((partyId: number, config: any) => emit('start_game', { partyId, config }), [emit]),
    
    // Nouvelles méthodes pour la synchronisation
    submitGuess: useCallback((partyId: number, gameId: number, relativeId: number, country: string) => 
      emit('submit_guess', { partyId, gameId, relativeId, country }), [emit]),
    
    readyForNextRound: useCallback((partyId: number) => 
      emit('ready_for_next_round', { partyId }), [emit]),
    
    getRoundResults: useCallback((partyId: number) => 
      emit('get_round_results', { partyId }), [emit]),
    
    playerReady: useCallback((partyId: number) => 
      emit('player_ready', { partyId }), [emit]),
    
    nextRound: useCallback((partyId: number) => 
      emit('next_round', { partyId }), [emit]),
  };
};