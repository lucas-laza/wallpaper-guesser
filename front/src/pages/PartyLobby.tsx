import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Users, 
  Settings, 
  Play, 
  Copy, 
  Check, 
  Crown, 
  LogOut,
  Loader2,
  ChevronDown
} from 'lucide-react';
import BackgroundImage from '../components/BackgroundImage';
import GlassCard from '../components/GlassCard';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { 
  getPartyInfo, 
  startPartyGame, 
  leaveParty, 
  type Party, 
  type User 
} from '../services/api';

const PartyLobby = () => {
  const { partyCode } = useParams<{ partyCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isConnected, error: wsError, on, off, joinParty: wsJoinParty, startGame, leaveParty: wsLeaveParty } = useWebSocket();

  const [party, setParty] = useState<Party | null>(null);
  const [players, setPlayers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [isLeavingParty, setIsLeavingParty] = useState(false);

  // Game settings
  const [showSettings, setShowSettings] = useState(false);
  const [roundsNumber, setRoundsNumber] = useState(3);
  const [time, setTime] = useState(60);
  const [selectedMap, setSelectedMap] = useState('World');
  const [isMapDropdownOpen, setIsMapDropdownOpen] = useState(false);

  const maps = ['World', 'Europe', 'Asia', 'Americas', 'Africa', 'Oceania'];
  
  // Refs pour gérer les états
  const hasJoinedWebSocket = useRef(false);
  const isUnmounting = useRef(false);
  const webSocketJoinInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (partyCode) {
      loadPartyInfo();
    }
  }, [partyCode]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      isUnmounting.current = true;
      if (party && !isLeavingParty) {
        navigator.sendBeacon(`/api/party/code/${party.code}/disconnect`);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      isUnmounting.current = true;
      if (webSocketJoinInterval.current) {
        clearInterval(webSocketJoinInterval.current);
      }
    };
  }, [party, isLeavingParty]);

  // CORRECTION: WebSocket join automatique avec retry
  useEffect(() => {
    if (isConnected && party?.id && !isUnmounting.current) {
      console.log(`[PartyLobby] WebSocket connected, attempting to join party ${party.id}`);
      
      // Rejoindre immédiatement
      if (!hasJoinedWebSocket.current) {
        hasJoinedWebSocket.current = true;
        wsJoinParty(party.id);
      }

      // CORRECTION: Retry périodique pour s'assurer de la connexion
      webSocketJoinInterval.current = setInterval(() => {
        if (isConnected && party?.id && !isUnmounting.current) {
          console.log(`[PartyLobby] Periodic WebSocket join attempt for party ${party.id}`);
          wsJoinParty(party.id);
        }
      }, 5000); // Retry toutes les 5 secondes

      return () => {
        if (webSocketJoinInterval.current) {
          clearInterval(webSocketJoinInterval.current);
        }
      };
    }
  }, [isConnected, party?.id, wsJoinParty]);

  useEffect(() => {
    // WebSocket event handlers avec DEBUG
    on('party_state', (data) => {
      console.log('[PartyLobby] Received party_state:', data);
      if (!isUnmounting.current) {
        setParty(data.party);
        setPlayers(data.players || []);
        setIsLoading(false);
      }
    });

    on('player_joined', (data) => {
      console.log('[PartyLobby] Player joined:', data);
      if (!isUnmounting.current) {
        // CORRECTION: Utiliser la liste complète des joueurs
        setPlayers(data.players || []);
        setParty(prev => prev ? { ...prev, players: data.players } : null);
      }
    });

    on('player_left', (data) => {
      console.log('[PartyLobby] Player left:', data);
      if (!isUnmounting.current) {
        setPlayers(data.players || []);
        setParty(prev => prev ? { ...prev, players: data.players } : null);
      }
    });

    on('game_started', (data) => {
      console.log('[PartyLobby] Game started event received:', data);
      if (!isUnmounting.current) {
        console.log(`[PartyLobby] Navigating to game ${data.gameId}`);
        setIsStartingGame(false);
        
        // CORRECTION: Petit délai pour s'assurer que la navigation fonctionne
        setTimeout(() => {
          navigate(`/game/${data.gameId}`);
        }, 100);
      } else {
        console.log('[PartyLobby] Ignoring game_started - component is unmounting');
      }
    });

    on('error', (data) => {
      console.error('[PartyLobby] WebSocket error:', data);
      if (!isUnmounting.current) {
        setError(data.message);
        setIsStartingGame(false);
      }
    });

    return () => {
      console.log('[PartyLobby] Cleaning up WebSocket event handlers');
      off('party_state');
      off('player_joined');
      off('player_left');
      off('game_started');
      off('error');
    };
  }, [navigate, on, off]);

  const loadPartyInfo = async () => {
    if (!partyCode) return;
    
    try {
      console.log(`[PartyLobby] Loading party info for code: ${partyCode}`);
      const partyInfo = await getPartyInfo(partyCode);
      setParty(partyInfo);
      setPlayers(partyInfo.players || []);
      console.log('[PartyLobby] Party info loaded:', partyInfo);
    } catch (err: any) {
      console.error('[PartyLobby] Error loading party:', err);
      setError(err.message || 'Failed to load party information');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (party?.code) {
      try {
        await navigator.clipboard.writeText(party.code);
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy code:', err);
      }
    }
  };

  const handleStartGame = async () => {
    if (!party || !user) return;

    if (party.admin.id !== user.id) {
      setError('Only the party admin can start the game');
      return;
    }

    // CORRECTION: Vérifier les joueurs de la DB, pas WebSocket
    const totalPlayers = party.players?.length || 0;
    if (totalPlayers < 2) {
      setError('At least 2 players are required to start the game');
      return;
    }

    setIsStartingGame(true);
    setError('');

    try {
      console.log(`[PartyLobby] Starting game for party ${party.id} with ${totalPlayers} players`);
      
      // CORRECTION: Forcer un refresh des joueurs avant de commencer
      await loadPartyInfo();
      
      startGame(party.id, {
        roundsNumber,
        time,
        map: selectedMap
      });
      
      // CORRECTION: Timeout de sécurité pour éviter le loading infini
      setTimeout(() => {
        if (isStartingGame) {
          console.warn('[PartyLobby] Game start timeout, stopping loader');
          setIsStartingGame(false);
          setError('Game start timed out. Please try again.');
        }
      }, 10000); // 10 secondes
      
    } catch (err: any) {
      console.error('[PartyLobby] Error starting game:', err);
      setError(err.message || 'Failed to start game');
      setIsStartingGame(false);
    }
  };

  const handleLeaveParty = async () => {
    if (!party || !partyCode || isLeavingParty) return;

    setIsLeavingParty(true);
    isUnmounting.current = true;

    try {
      wsLeaveParty();
      await leaveParty(partyCode);
      navigate('/party-play');
    } catch (err: any) {
      console.error('[PartyLobby] Error leaving party:', err);
      setError(err.message || 'Failed to leave party');
      setIsLeavingParty(false);
      isUnmounting.current = false;
    }
  };

  // CORRECTION: Refresh périodique des données
  useEffect(() => {
    if (party && !isUnmounting.current) {
      const refreshInterval = setInterval(() => {
        if (!isStartingGame && !isLeavingParty) {
          console.log('[PartyLobby] Periodic refresh of party data');
          loadPartyInfo();
        }
      }, 10000); // Refresh toutes les 10 secondes

      return () => clearInterval(refreshInterval);
    }
  }, [party, isStartingGame, isLeavingParty]);

  if (isLoading) {
    return (
      <BackgroundImage src="https://images.pexels.com/photos/1435752/pexels-photo-1435752.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Loader2 size={48} className="animate-spin text-white mx-auto mb-4" />
            <p className="text-white">Loading party...</p>
          </div>
        </div>
      </BackgroundImage>
    );
  }

  if (!party) {
    return (
      <BackgroundImage src="https://images.pexels.com/photos/1435752/pexels-photo-1435752.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
        <div className="min-h-screen flex items-center justify-center p-6">
          <GlassCard className="text-center">
            <h2 className="text-white text-xl font-bold mb-4">Party Not Found</h2>
            <p className="text-white/80 mb-6">The party you're looking for doesn't exist or you don't have access to it.</p>
            <button
              onClick={() => navigate('/party-play')}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg"
            >
              Back to Party Play
            </button>
          </GlassCard>
        </div>
      </BackgroundImage>
    );
  }

  const isAdmin = user?.id === party.admin.id;
  // CORRECTION: Priorité à la DB, fallback sur WebSocket
  const displayPlayers = party.players && party.players.length > 0 ? party.players : players;
  const playerCount = displayPlayers.length;

  return (
    <BackgroundImage src="https://images.pexels.com/photos/1435752/pexels-photo-1435752.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
      <div className="min-h-screen p-6 pt-24">
        <div className="max-w-4xl mx-auto">
          
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-white text-3xl font-bold">Party Lobby</h1>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-white/60">Room Code:</span>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg transition-colors"
                >
                  <span className="text-white font-mono text-lg">{party.code}</span>
                  {codeCopied ? (
                    <Check size={16} className="text-green-400" />
                  ) : (
                    <Copy size={16} className="text-white/60" />
                  )}
                </button>
              </div>
            </div>

            {/* WebSocket Status */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-white/60 text-sm">
                {isConnected ? 'Connected' : 'Connecting...'}
              </span>
              <button
                onClick={() => loadPartyInfo()}
                className="ml-2 text-white/60 hover:text-white text-xs"
                title="Refresh"
              >
                🔄
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* WebSocket Error */}
          {wsError && (
            <div className="mb-6 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-300 text-sm">
              WebSocket Error: {wsError}
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6">
            
            {/* Players List */}
            <div className="lg:col-span-2">
              <GlassCard>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-bold text-lg flex items-center gap-2">
                    <Users size={20} />
                    Players ({playerCount})
                  </h3>
                  <div className="flex items-center gap-2">
                    {!isConnected && (
                      <span className="text-yellow-400 text-xs">Syncing...</span>
                    )}
                    <span className="text-white/40 text-xs">
                      Last update: {new Date().toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {displayPlayers.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center">
                          <span className="text-white font-bold">
                            {player.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{player.name}</span>
                            {player.id === party.admin.id && (
                              <Crown size={16} className="text-yellow-400" />
                            )}
                          </div>
                          <span className="text-white/60 text-sm">
                            {player.id === party.admin.id ? 'Admin' : 'Player'}
                          </span>
                        </div>
                      </div>

                      <div className="w-3 h-3 bg-green-400 rounded-full" title="Online" />
                    </div>
                  ))}

                  {playerCount < 8 && (
                    <div className="p-3 border-2 border-dashed border-white/20 rounded-lg text-center">
                      <p className="text-white/60">Waiting for more players...</p>
                      <p className="text-white/40 text-sm mt-1">Share the room code with friends</p>
                    </div>
                  )}
                </div>
              </GlassCard>
            </div>

            {/* Game Settings & Controls */}
            <div className="space-y-6">
              
              {/* Game Settings */}
              {isAdmin && (
                <GlassCard>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-bold text-lg flex items-center gap-2">
                      <Settings size={20} />
                      Game Settings
                    </h3>
                    <button
                      onClick={() => setShowSettings(!showSettings)}
                      className="text-white/60 hover:text-white"
                    >
                      <ChevronDown 
                        size={16} 
                        className={`transition-transform ${showSettings ? 'rotate-180' : ''}`} 
                      />
                    </button>
                  </div>

                  {showSettings && (
                    <div className="space-y-4">
                      {/* Map Selection */}
                      <div>
                        <label className="block text-white/80 text-sm font-medium mb-2">
                          Map
                        </label>
                        <div className="relative">
                          <button
                            onClick={() => setIsMapDropdownOpen(!isMapDropdownOpen)}
                            className="w-full flex items-center justify-between p-3 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition-colors"
                          >
                            <span>{selectedMap}</span>
                            <ChevronDown 
                              size={16} 
                              className={`transition-transform ${isMapDropdownOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          
                          {isMapDropdownOpen && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-black/80 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden z-20">
                              {maps.map((map) => (
                                <button
                                  key={map}
                                  onClick={() => {
                                    setSelectedMap(map);
                                    setIsMapDropdownOpen(false);
                                  }}
                                  className="w-full p-3 text-left text-white hover:bg-white/20 transition-colors"
                                >
                                  {map}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Rounds Number */}
                      <div>
                        <label className="block text-white/80 text-sm font-medium mb-2">
                          Rounds
                        </label>
                        <select
                          value={roundsNumber}
                          onChange={(e) => setRoundsNumber(parseInt(e.target.value))}
                          className="w-full p-3 bg-white/10 border border-white/20 rounded-lg text-white focus:border-orange-500 focus:outline-none"
                        >
                          <option value={3} className="bg-black">3 Rounds</option>
                          <option value={5} className="bg-black">5 Rounds</option>
                          <option value={10} className="bg-black">10 Rounds</option>
                        </select>
                      </div>

                      {/* Time per Round */}
                      <div>
                        <label className="block text-white/80 text-sm font-medium mb-2">
                          Time per Round
                        </label>
                        <select
                          value={time}
                          onChange={(e) => setTime(parseInt(e.target.value))}
                          className="w-full p-3 bg-white/10 border border-white/20 rounded-lg text-white focus:border-orange-500 focus:outline-none"
                        >
                          <option value={30} className="bg-black">30 seconds</option>
                          <option value={60} className="bg-black">1 minute</option>
                          <option value={120} className="bg-black">2 minutes</option>
                          <option value={300} className="bg-black">5 minutes</option>
                        </select>
                      </div>
                    </div>
                  )}
                </GlassCard>
              )}

              {/* Game Info for Non-Admin */}
              {!isAdmin && (
                <GlassCard>
                  <h3 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
                    <Settings size={20} />
                    Game Info
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/60">Map:</span>
                      <span className="text-white">{selectedMap}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Rounds:</span>
                      <span className="text-white">{roundsNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">Time:</span>
                      <span className="text-white">{time}s per round</span>
                    </div>
                  </div>
                  <p className="text-white/50 text-xs mt-4">
                    Only the admin can modify game settings
                  </p>
                </GlassCard>
              )}

              {/* Controls */}
              <GlassCard>
                <div className="space-y-3">
                  {isAdmin && (
                    <button
                      onClick={handleStartGame}
                      disabled={isStartingGame || playerCount < 2}
                      className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-white/20 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-all duration-200"
                    >
                      {isStartingGame ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Play size={18} />
                      )}
                      {isStartingGame ? 'Starting...' : 'Start Game'}
                    </button>
                  )}

                  {!isAdmin && (
                    <div className="text-center p-3 bg-white/5 rounded-lg border border-white/10">
                      <p className="text-white/80 text-sm">
                        Waiting for {party.admin.name} to start the game
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleLeaveParty}
                    disabled={isLeavingParty}
                    className="w-full flex items-center justify-center gap-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 font-medium py-2 px-4 rounded-lg transition-all duration-200"
                  >
                    {isLeavingParty ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <LogOut size={16} />
                    )}
                    {isLeavingParty ? 'Leaving...' : 'Leave Party'}
                  </button>
                </div>

                {playerCount < 2 && (
                  <p className="text-white/50 text-xs mt-3 text-center">
                    Need at least 2 players to start ({playerCount}/2)
                  </p>
                )}
              </GlassCard>
            </div>
          </div>
        </div>
      </div>
    </BackgroundImage>
  );
};

export default PartyLobby;