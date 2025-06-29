// hooks/useWebSocket.ts - Version avec debug amélioré

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../services/api';

export interface WebSocketEvents {
  // Events from server
  player_joined: (data: { user: { id: number; name: string }; players: any[]; party: any }) => void;
  player_left: (data: { user: { id: number; name: string }; players: any[] }) => void;
  game_started: (data: { gameId: number; config: any; currentRound: number }) => void;
  player_ready_update: (data: { playerId: number; readyCount: number; totalPlayers: number; allReady: boolean }) => void;
  round_started: (data: { roundNumber: number; startTime: Date }) => void;
  player_submitted: (data: { playerId: number; playerName: string; submittedCount: number; totalPlayers: number }) => void;
  guess_result: (data: any) => void;
  round_results: (data: { roundNumber: number; results: any[] }) => void;
  party_state: (data: { party: any; players: any[]; gameState?: any }) => void;
  error: (data: { message: string }) => void;
}

export const useWebSocket = (url: string = 'http://localhost:3300') => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventHandlers = useRef<Partial<WebSocketEvents>>({});
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setError('No authentication token found');
      return;
    }

    console.log('[WebSocket] Connecting to server...');
    const newSocket = io(url, {
      auth: {
        token: token
      },
      transports: ['websocket', 'polling'] // Fallback sur polling si WebSocket échoue
    });

    newSocket.on('connect', () => {
      console.log('[WebSocket] Connected successfully');
      setIsConnected(true);
      setError(null);
      reconnectAttempts.current = 0;
    });

    newSocket.on('disconnect', (reason) => {
      console.log('[WebSocket] Disconnected:', reason);
      setIsConnected(false);
      
      // Tentative de reconnexion automatique
      if (reason === 'io server disconnect') {
        // Le serveur a fermé la connexion, on peut reconnecter
        console.log('[WebSocket] Server disconnected, attempting to reconnect...');
      }
    });

    newSocket.on('connect_error', (err) => {
      console.error('[WebSocket] Connection error:', err);
      setError(err.message);
      setIsConnected(false);
      reconnectAttempts.current++;
      
      if (reconnectAttempts.current > 5) {
        console.error('[WebSocket] Max reconnection attempts reached');
        setError('Connection failed after multiple attempts');
      }
    });

    // DEBUG: Logger tous les événements reçus
    newSocket.onAny((eventName, ...args) => {
      console.log(`[WebSocket] Received event '${eventName}':`, args);
    });

    // Register all event handlers
    Object.entries(eventHandlers.current).forEach(([event, handler]) => {
      if (handler) {
        console.log(`[WebSocket] Registering handler for '${event}'`);
        newSocket.on(event, handler);
      }
    });

    setSocket(newSocket);

    return () => {
      console.log('[WebSocket] Cleaning up connection');
      newSocket.close();
    };
  }, [url]);

  const on = <K extends keyof WebSocketEvents>(
    event: K,
    handler: WebSocketEvents[K]
  ) => {
    console.log(`[WebSocket] Adding handler for '${event}'`);
    eventHandlers.current[event] = handler;
    if (socket && isConnected) {
      socket.on(event as string, handler);
    }
  };

  const off = (event: keyof WebSocketEvents) => {
    console.log(`[WebSocket] Removing handler for '${event}'`);
    delete eventHandlers.current[event];
    if (socket) {
      socket.off(event as string);
    }
  };

  const emit = (event: string, data?: any) => {
    if (socket && isConnected) {
      console.log(`[WebSocket] Emitting '${event}':`, data);
      socket.emit(event, data);
    } else {
      console.warn(`[WebSocket] Cannot emit '${event}' - socket not connected`);
    }
  };

  return {
    socket,
    isConnected,
    error,
    on,
    off,
    emit,
    // Convenience methods for common events
    joinParty: (partyId: number) => {
      console.log(`[WebSocket] Joining party ${partyId}`);
      emit('join_party', { partyId });
    },
    leaveParty: () => {
      console.log('[WebSocket] Leaving party');
      emit('leave_party');
    },
    startGame: (partyId: number, config: any) => {
      console.log(`[WebSocket] Starting game for party ${partyId}:`, config);
      emit('start_game', { partyId, config });
    },
    playerReady: (partyId: number) => emit('player_ready', { partyId }),
    submitGuess: (data: { partyId: number; gameId: number; relativeId: number; country: string }) => 
      emit('submit_guess', data),
    nextRound: (partyId: number) => emit('next_round', { partyId })
  };
};