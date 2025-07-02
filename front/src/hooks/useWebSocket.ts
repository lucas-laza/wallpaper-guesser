import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getToken } from '../services/api';
import { useNavigate } from 'react-router-dom';

export interface WebSocketEvents {
  player_joined: (data: { user: { id: number; name: string }; players: any[]; party: any }) => void;
  player_left: (data: { user: { id: number; name: string }; players: any[] }) => void;
  party_updated: (data: { partyId: number; players: any[] }) => void;
  game_started: (data: { gameId: number; config: any; currentRound: number; partyId?: number }) => void;
  party_state: (data: { party: any; players: any[]; gameState?: any }) => void;
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
  const eventHandlers = useRef<Partial<WebSocketEvents>>({});
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const token = getToken();
    if (!token) {
      setError('No authentication token found');
      return;
    }

    const newSocket = io(url, {
      auth: { token },
      transports: ['polling'],
      forceNew: true,
      timeout: 5000,
      reconnection: false
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      setError(null);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('connect_error', (err) => {
      setError(err.message);
      setIsConnected(false);
    });

    if (setPartyState) {
      newSocket.on('party_updated', setPartyState);
    }

    newSocket.on('game_started', (data) => {
      console.log('🎮 [useWebSocket] game_started received:', data);
      if (data.gameId) {
        console.log('🎮 [useWebSocket] Navigating to:', `/game/${data.gameId}`);
        navigate(`/game/${data.gameId}`);
      } else {
        console.error('🎮 [useWebSocket] No gameId in game_started data');
      }
    });

    Object.entries(eventHandlers.current).forEach(([event, handler]) => {
      if (handler) {
        newSocket.on(event, handler);
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
      initialized.current = false;
    };
  }, []);

  const on = <K extends keyof WebSocketEvents>(event: K, handler: WebSocketEvents[K]) => {
    eventHandlers.current[event] = handler;
    if (socket && isConnected) {
      socket.on(event as string, handler);
    }
  };

  const off = (event: keyof WebSocketEvents) => {
    delete eventHandlers.current[event];
    if (socket) {
      socket.off(event as string);
    }
  };

  const emit = (event: string, data?: any) => {
    if (socket && isConnected) {
      socket.emit(event, data);
    }
  };

  return {
    socket,
    isConnected,
    error,
    on,
    off,
    emit,
    joinParty: (partyId: number) => emit('join_party', { partyId }),
    leaveParty: () => emit('leave_party'),
    startGame: (partyId: number, config: any) => emit('start_game', { partyId, config }),
  };
};