import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Clock, Target, ArrowRight, Home, Settings, X, Send, Users, Timer } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import CountryAutocomplete from '../components/CountryAutocomplete';
import { useWebSocket } from '../hooks/useWebSocket';
import { 
  Round, 
  GuessResult, 
  getRound, 
  submitGuess, 
  finishGame, 
  quitActiveGame,
  checkActiveGame,
  resumeGame,
  getGameInfo 
} from '../services/api';

interface SyncState {
  isMultiplayer: boolean;
  roundComplete: boolean;
  totalPlayers: number;
  playersFinished: number;
  readyCount: number;
  allPlayersReady: boolean;
}

const Game = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [currentRoundNumber, setCurrentRoundNumber] = useState(1);
  const [totalRounds, setTotalRounds] = useState(3);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isGuessing, setIsGuessing] = useState(false);
  const [guessResult, setGuessResult] = useState<GuessResult | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [error, setError] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [isQuitting, setIsQuitting] = useState(false);
  const [partyId, setPartyId] = useState<number | null>(null);
  const [isReadyForNextRound, setIsReadyForNextRound] = useState(false);
  const [roundResults, setRoundResults] = useState<any[]>([]);
  const [configuredTime, setConfiguredTime] = useState(60);

  const [syncState, setSyncState] = useState<SyncState>({
    isMultiplayer: false,
    roundComplete: false,
    totalPlayers: 1,
    playersFinished: 0,
    readyCount: 0,
    allPlayersReady: false
  });

  const [actionDebounce, setActionDebounce] = useState<{
    lastReadyAction: number;
    lastTransition: number;
    pendingActions: Set<string>;
  }>({
    lastReadyAction: 0,
    lastTransition: 0,
    pendingActions: new Set()
  });

  const { socket, isConnected, on, off, emit } = useWebSocket();

  useEffect(() => {
    if (gameId) {
      initializeGame();
    }
  }, [gameId]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const eventHandlers = {
      player_finished_round: (data: any) => {
        console.log('🎯 [Game] Player finished round:', data);
        setSyncState(prev => ({
          ...prev,
          playersFinished: data.finishedCount,
          totalPlayers: data.totalPlayers,
          roundComplete: data.finishedCount === data.totalPlayers
        }));

        if (data.finishedCount === data.totalPlayers && 
            guessResult && 
            !isReadyForNextRound &&
            !actionDebounce.pendingActions.has('auto_ready')) {
          
          console.log('[Game] 🤖 All players finished = Scheduling auto-ready');
          setActionDebounce(prev => ({ ...prev, pendingActions: new Set([...prev.pendingActions, 'auto_ready']) }));
          
          setTimeout(() => {
            if (!isReadyForNextRound) {
              handleReadyForNextRound();
            }
            setActionDebounce(prev => {
              const newPending = new Set(prev.pendingActions);
              newPending.delete('auto_ready');
              return { ...prev, pendingActions: newPending };
            });
          }, 2000);
        }
      },

      round_completed: (data: any) => {
        console.log('🏁 [Game] Round completed event received:', data);
        setRoundResults(data.results);
        
        setSyncState(prev => ({
          ...prev,
          roundComplete: true,
          playersFinished: prev.totalPlayers,
          allPlayersReady: false
        }));

        if (guessResult && 
            !isReadyForNextRound && 
            !actionDebounce.pendingActions.has('round_complete_ready')) {
          
          console.log('[Game] 🤖 Round completed + has guess = Auto-ready NOW');
          setActionDebounce(prev => ({ ...prev, pendingActions: new Set([...prev.pendingActions, 'round_complete_ready']) }));
          
          setTimeout(() => {
            if (!isReadyForNextRound) {
              handleReadyForNextRound();
            }
            setActionDebounce(prev => {
              const newPending = new Set(prev.pendingActions);
              newPending.delete('round_complete_ready');
              return { ...prev, pendingActions: newPending };
            });
          }, 1000);
        }
      },

      player_ready_update: (data: any) => {
        console.log('✅ [Game] Player ready update:', data);
        setSyncState(prev => ({
          ...prev,
          readyCount: data.readyCount,
          totalPlayers: data.totalPlayers,
          allPlayersReady: data.allPlayersReady
        }));
        
        if (data.allPlayersReady && 
            !actionDebounce.pendingActions.has('transition')) {
          
          console.log('[Game] 🎉 All players ready - starting transition');
          setActionDebounce(prev => ({ ...prev, pendingActions: new Set([...prev.pendingActions, 'transition']) }));
          
          setTimeout(() => {
            handleNextRoundTransition();
            setActionDebounce(prev => {
              const newPending = new Set(prev.pendingActions);
              newPending.delete('transition');
              return { ...prev, pendingActions: newPending };
            });
          }, 1500);
        }
      },

      round_started: (data: any) => {
        console.log('🚀 [Game] Round started:', data);
        
        setCurrentRoundNumber(data.roundNumber);
        setTimeLeft(configuredTime);
        setGuessResult(null);
        setSelectedCountry('');
        setIsReadyForNextRound(false);
        setRoundResults([]);
        
        setSyncState(prev => ({
          ...prev,
          roundComplete: false,
          playersFinished: 0,
          readyCount: 0,
          allPlayersReady: false
        }));
        
        setActionDebounce(prev => ({
          ...prev,
          pendingActions: new Set(),
          lastTransition: Date.now()
        }));
        
        loadRound(data.roundNumber);
      },

      game_finished: (data: any) => {
        console.log('🎉 [Game] Game finished:', data);
        setIsGameFinished(true);
      },

      guess_result: (data: any) => {
        console.log('[Game] 🎲 Received guess result via WebSocket:', data);
        setGuessResult(data);
        setTotalScore(prev => prev + data.score);
        
        setSyncState(prev => ({
          ...prev,
          isMultiplayer: true,
          roundComplete: data.roundComplete ?? false,
          totalPlayers: data.totalPlayers ?? 1,
          playersFinished: (data.totalPlayers ?? 1) - (data.waitingPlayers ?? 0)
        }));
        
        setIsGuessing(false);

        if (data.roundComplete && 
            !isReadyForNextRound && 
            !actionDebounce.pendingActions.has('guess_complete_ready')) {
          
          console.log('[Game] 🤖 Guess shows round complete = Auto-ready');
          setActionDebounce(prev => ({ ...prev, pendingActions: new Set([...prev.pendingActions, 'guess_complete_ready']) }));
          
          setTimeout(() => {
            if (!isReadyForNextRound) {
              handleReadyForNextRound();
            }
            setActionDebounce(prev => {
              const newPending = new Set(prev.pendingActions);
              newPending.delete('guess_complete_ready');
              return { ...prev, pendingActions: newPending };
            });
          }, 2500);
        }
      },
      
      error: (data: any) => {
        console.error('[Game] ❌ WebSocket error:', data);
        setError(data.message);
        setIsGuessing(false);
        
        setActionDebounce(prev => ({
          ...prev,
          pendingActions: new Set()
        }));
      }
    };

    Object.entries(eventHandlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    return () => {
      Object.keys(eventHandlers).forEach(event => {
        socket.off(event);
      });
    };
  }, [socket, isConnected, guessResult, isReadyForNextRound, actionDebounce.pendingActions]);

  // Auto-ready fallback with protection against duplicates
  useEffect(() => {
    if (!guessResult || !syncState.isMultiplayer || isReadyForNextRound) return;

    const fallbackTimer = setTimeout(() => {
      console.log('[Game] 🤖 Fallback auto-ready: 5 seconds elapsed');
      if (!isReadyForNextRound && !actionDebounce.pendingActions.has('fallback_ready')) {
        handleReadyForNextRound();
      }
    }, 5000);

    return () => clearTimeout(fallbackTimer);
  }, [guessResult, syncState.isMultiplayer, isReadyForNextRound]);

  useEffect(() => {
    if (timeLeft > 0 && !guessResult && !isGameFinished) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0 && !guessResult) {
      handleGuessSubmit('');
    }
  }, [timeLeft, guessResult, isGameFinished]);

  const initializeGame = async () => {
    try {
      setError('');
      
      const activeGameInfo = await checkActiveGame();
      
      if (!activeGameInfo.hasActiveGame) {
        setError('No active game found');
        return;
      }

      if (activeGameInfo.gameId !== parseInt(gameId!)) {
        navigate(`/game/${activeGameInfo.gameId}`);
        return;
      }

      setTotalRounds(activeGameInfo.totalRounds || 3);
      setCurrentRoundNumber(activeGameInfo.currentRound || 1);
      
      const gameTime = activeGameInfo.time || 60;
      setConfiguredTime(gameTime);
      
      const isMultiplayer = activeGameInfo.isMultiplayer || (activeGameInfo.totalPlayers && activeGameInfo.totalPlayers > 1);
      
      let resolvedPartyId = activeGameInfo.partyId;
      
      if (!resolvedPartyId && isMultiplayer) {
        try {
          const gameInfo = await getGameInfo(parseInt(gameId!));
          if (gameInfo.party && gameInfo.party.id) {
            resolvedPartyId = gameInfo.party.id;
          }
        } catch (err) {
          console.error('[Game] Failed to get party info from game:', err);
        }
      }
      
      setPartyId(resolvedPartyId || null);
      
      setSyncState(prev => ({
        ...prev,
        isMultiplayer: isMultiplayer || false,
        totalPlayers: activeGameInfo.totalPlayers || 1
      }));

      if (isMultiplayer && resolvedPartyId) {
        console.log(`[Game] 🎮 Multiplayer game detected, connecting WebSocket...`);
        
        const waitForConnection = () => {
          return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('WebSocket connection timeout'));
            }, 10000);

            const checkConnection = () => {
              if (isConnected && socket) {
                clearTimeout(timeout);
                resolve();
              } else {
                setTimeout(checkConnection, 100);
              }
            };
            
            if (isConnected && socket) {
              clearTimeout(timeout);
              resolve();
            } else {
              checkConnection();
            }
          });
        };
        
        try {
          await waitForConnection();
          console.log(`[Game] 📡 WebSocket connected, joining party ${resolvedPartyId}`);
          socket.emit('join_party', { partyId: resolvedPartyId });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          console.error('[Game] ❌ WebSocket connection failed:', err);
          setError('Failed to connect to multiplayer session');
          return;
        }
      }

      if (activeGameInfo.isCompleted) {
        setIsGameFinished(true);
        return;
      }

      if (activeGameInfo.roundData) {
        setCurrentRound(activeGameInfo.roundData);
        setTimeLeft(activeGameInfo.time || gameTime);
        
        if (activeGameInfo.roundData.guesses > 0) {
          setGuessResult({
            roundId: activeGameInfo.roundData.id,
            relative_id: activeGameInfo.roundData.relative_id,
            guessNumber: activeGameInfo.roundData.guesses,
            isCorrect: false,
            score: 0,
            correctLocation: {
              country: { code: '', text: 'Unknown' },
              title: 'Unknown',
              tags: []
            },
            userGuess: { country: 'Previous guess' }
          });
        }
      } else {
        await loadRound(activeGameInfo.currentRound || 1);
      }
      
    } catch (err: any) {
      console.error('Error initializing game:', err);
      setError(err.message);
    }
  };

  const loadRound = async (roundNumber: number) => {
    try {
      setError('');
      const round = await getRound(parseInt(gameId!), roundNumber);
      setCurrentRound(round);
      setTimeLeft(configuredTime);
      setGuessResult(null);
      setSelectedCountry('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCountrySelect = (country: string) => {
    setSelectedCountry(country);
  };

  const handleGuessSubmit = async (country: string) => {
    if (!gameId || !currentRound || isGuessing) {
      console.log('[Game] ⚠️ Cannot submit guess: missing requirements or already guessing');
      return;
    }

    if (guessResult) {
      console.log('[Game] ⚠️ Already have a guess result for this round');
      return;
    }

    console.log('[Game] 🎯 Starting guess submission process');
    setIsGuessing(true);

    try {
      if (syncState.isMultiplayer && socket && isConnected && partyId) {
        console.log('[Game] 📡 Submitting guess via WebSocket for multiplayer game');
        
        socket.emit('submit_guess', {
          partyId: partyId,
          gameId: parseInt(gameId),
          relativeId: currentRound.relative_id,
          country: country || selectedCountry
        });
        
        // Timeout for WebSocket
        setTimeout(() => {
          if (isGuessing && !guessResult) {
            console.warn('[Game] ⚠️ WebSocket guess timeout, falling back to HTTP');
            setIsGuessing(false);
            handleHttpGuessSubmission(country);
          }
        }, 5000);
        
        return;
      }

      await handleHttpGuessSubmission(country);
    } catch (error) {
      console.error('[Game] ❌ Error in guess submission:', error);
      setIsGuessing(false);
      setError('Failed to submit guess. Please try again.');
    }
  };

  const handleHttpGuessSubmission = async (country: string) => {
    try {
      console.log('[Game] 🌐 Submitting guess via HTTP API');
      
      if (guessResult) {
        console.log('[Game] ⚠️ Already have a result, aborting HTTP submission');
        setIsGuessing(false);
        return;
      }
      
      const result = await submitGuess(parseInt(gameId!), currentRound!.relative_id, {
        country: country || selectedCountry,
      });
    
      setGuessResult(result);
      setTotalScore(totalScore + result.score);
    
      if (result.isMultiplayer) {
        setSyncState(prev => ({
          ...prev,
          isMultiplayer: true,
          roundComplete: result.roundComplete ?? false,
          totalPlayers: result.totalPlayers ?? 1,
          playersFinished: (result.totalPlayers ?? 1) - (result.waitingPlayers ?? 0)
        }));
      }
    } catch (err: any) {
      console.error('[Game] ❌ HTTP submission error:', err);
      setError(err.message);
    } finally {
      setIsGuessing(false);
    }
  };

  const handleReadyForNextRound = async () => {
    const now = Date.now();
    
    // Protection against multiple calls
    if (now - actionDebounce.lastReadyAction < 1000) {
      console.log('[Game] ⚠️ Ready action too recent, ignoring');
      return;
    }

    console.log('[Game] 🎯 Player requesting to be ready for next round');

    if (!syncState.isMultiplayer) {
      console.log('[Game] 📱 Solo game, proceeding directly');
      handleNextRound();
      return;
    }
    
    if (isReadyForNextRound) {
      console.log('[Game] ⚠️ Player already ready');
      return;
    }
    
    setActionDebounce(prev => ({ ...prev, lastReadyAction: now }));
    setIsReadyForNextRound(true);
    
    try {
      let currentPartyId = partyId;
      if (!currentPartyId) {
        const gameInfo = await getGameInfo(parseInt(gameId!));
        if (gameInfo.party && gameInfo.party.id) {
          currentPartyId = gameInfo.party.id;
          setPartyId(currentPartyId);
        }
      }
      
      // API call to mark as ready
      const response = await fetch(`http://localhost:3300/game/game/${gameId}/ready-next-round`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[Game] ✅ Ready API response:', result);
      
      // WebSocket to notify other players
      if (socket && currentPartyId && isConnected) {
        socket.emit('ready_for_next_round', { partyId: currentPartyId });
      }
    } catch (err: any) {
      console.error('[Game] ❌ Error marking player as ready:', err);
      setError(err.message);
      setIsReadyForNextRound(false);
    }
  };

  const handleNextRoundTransition = () => {
    const now = Date.now();
    
    if (now - actionDebounce.lastTransition < 2000) {
      console.log('[Game] ⚠️ Transition too recent, ignoring');
      return;
    }

    console.log('[Game] 🔄 Transitioning to next round');
    setActionDebounce(prev => ({ ...prev, lastTransition: now }));
    setIsReadyForNextRound(false);
    
    if (currentRoundNumber < totalRounds) {
      setCurrentRoundNumber(currentRoundNumber + 1);
      loadRound(currentRoundNumber + 1);
    } else {
      finishGameHandler();
    }
  };

  const handleNextRound = () => {
    if (currentRoundNumber < totalRounds) {
      setCurrentRoundNumber(currentRoundNumber + 1);
      loadRound(currentRoundNumber + 1);
    } else {
      finishGameHandler();
    }
  };

  const finishGameHandler = async () => {
    try {
      if (syncState.isMultiplayer) {
        const response = await fetch(`http://localhost:3300/game/game/${gameId}/finish-sync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            'Content-Type': 'application/json'
          }
        });
        
        const result = await response.json();
        
        if (result.allPlayersFinished) {
          setIsGameFinished(true);
        }
      } else {
        await finishGame(parseInt(gameId!));
        setIsGameFinished(true);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePlayAgain = () => {
    navigate('/quick-play');
  };

  const handleGoHome = () => {
    navigate('/');
  };

  const handleQuitGame = async () => {
    if (!window.confirm('Are you sure you want to quit the game? Your progress will be lost.')) {
      return;
    }

    setIsQuitting(true);
    try {
      await quitActiveGame();
      await new Promise(resolve => setTimeout(resolve, 500));
      navigate('/');
    } catch (err: any) {
      console.error('Error quitting game:', err);
      setError('Failed to quit game properly');
      navigate('/');
    } finally {
      setIsQuitting(false);
    }
  };

  // Calculate correct Ready button visibility
  const showReadyButton = guessResult && 
                         syncState.isMultiplayer && 
                         !isReadyForNextRound && 
                         (syncState.roundComplete || syncState.playersFinished === syncState.totalPlayers) &&
                         !actionDebounce.pendingActions.has('auto_ready') &&
                         !actionDebounce.pendingActions.has('round_complete_ready') &&
                         !actionDebounce.pendingActions.has('guess_complete_ready');

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <GlassCard className="text-center max-w-md">
          <h2 className="text-white text-2xl font-bold mb-4">Error</h2>
          <p className="text-white/80 mb-6">{error}</p>
          <button
            onClick={handleGoHome}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
          >
            Go Home
          </button>
        </GlassCard>
      </div>
    );
  }

  if (isGameFinished) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <GlassCard className="text-center max-w-md">
          <h2 className="text-white text-3xl font-bold mb-4">Game Complete!</h2>
          <div className="mb-6">
            <div className="text-orange-500 text-5xl font-bold mb-2">{totalScore}</div>
            <div className="text-white/80">Total Score</div>
          </div>
          
          {syncState.isMultiplayer && (
            <div className="mb-6 text-white/80">
              <p>Multiplayer game completed with {syncState.totalPlayers} players</p>
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={handlePlayAgain}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              Play Again
            </button>
            <button
              onClick={handleGoHome}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold py-3 px-6 rounded-lg transition-colors border border-white/20"
            >
              <Home size={20} className="inline mr-2" />
              Home
            </button>
          </div>
        </GlassCard>
      </div>
    );
  }

  if (!currentRound) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
        <GlassCard className="text-center">
          <div className="text-white">Loading round...</div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 relative overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={`http://localhost:3300/${currentRound.wallpaper.image}`}
          alt={currentRound.wallpaper.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
      </div>

      <div className="relative z-10 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <GlassCard className="flex items-center gap-3 py-2 px-4">
              <div className="flex items-center gap-2 text-white">
                <Target size={18} />
                <span className="font-medium">{currentRoundNumber}/{totalRounds}</span>
              </div>
              <div className="flex items-center gap-2 text-white">
                <Clock size={18} />
                <span className="font-medium">
                  {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
                </span>
              </div>
              {syncState.isMultiplayer && (
                <div className="flex items-center gap-2 text-orange-500">
                  <Users size={18} />
                  <span className="font-medium">{syncState.totalPlayers}P</span>
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>
              )}
            </GlassCard>
            
            <GlassCard className="py-2 px-4">
              <div className="text-orange-500 font-bold">
                Score: {totalScore}
              </div>
            </GlassCard>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors"
            >
              <Settings size={18} />
            </button>
            <button
              onClick={handleQuitGame}
              disabled={isQuitting}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-6 z-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-6">
            
            <div className="flex-1">
              <GlassCard>
                <div className="text-center mb-6">
                  <h3 className="text-white font-bold text-xl mb-2">
                    Which country is this?
                  </h3>
                  <p className="text-white/70 text-sm">
                    Type the name of the country you think this image is from
                  </p>
                </div>
                
                {!guessResult ? (
                  <div className="space-y-4">
                    <CountryAutocomplete
                      onSelect={handleCountrySelect}
                      disabled={isGuessing}
                      placeholder="Type a country name..."
                    />
                    
                    {selectedCountry && (
                      <div className="text-center">
                        <p className="text-white/80 text-sm mb-3">
                          Selected: <span className="text-orange-500 font-medium">{selectedCountry}</span>
                        </p>
                        <button
                          onClick={() => handleGuessSubmit(selectedCountry)}
                          disabled={isGuessing}
                          className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 text-white font-bold py-3 px-8 rounded-lg transition-colors flex items-center gap-2 mx-auto"
                        >
                          <Send size={18} />
                          {isGuessing ? 'Submitting...' : 'Submit Guess'}
                        </button>
                      </div>
                    )}
                    
                    {syncState.isMultiplayer && (
                      <div className="text-center text-white/60 text-xs mt-4">
                        <div className="flex items-center justify-center gap-2">
                          <Users size={14} />
                          <span>Multiplayer Game</span>
                          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center">
                    <div className={`text-2xl font-bold mb-2 ${guessResult.isCorrect ? 'text-green-500' : 'text-red-500'}`}>
                      {guessResult.isCorrect ? '✓ Correct!' : '✗ Incorrect'}
                    </div>
                    <p className="text-white/80 mb-4">
                      You guessed: <span className="text-orange-500">{guessResult.userGuess.country}</span>
                    </p>
                    <p className="text-white/80">
                      Correct answer: <span className="text-green-500">{guessResult.correctLocation.country.text}</span>
                    </p>
                  </div>
                )}
              </GlassCard>
            </div>

            {guessResult && (
              <div className="lg:w-80">
                <GlassCard>
                  <h3 className="text-white font-bold text-xl mb-4">Round Results</h3>
                  
                  <div className="space-y-4">
                    <div className="text-center">
                      <div className="text-orange-500 text-3xl font-bold mb-1">
                        {guessResult.score}
                      </div>
                      <div className="text-white/80 text-sm">Points</div>
                    </div>

                    <div className="border-t border-white/20 pt-4">
                      <div className="text-white/80 text-sm mb-2">Result:</div>
                      <div className={`font-bold ${guessResult.isCorrect ? 'text-green-500' : 'text-red-500'}`}>
                        {guessResult.isCorrect ? 'Correct!' : 'Incorrect'}
                      </div>
                    </div>

                    <div className="border-t border-white/20 pt-4">
                      <div className="text-white/80 text-sm mb-2">Location:</div>
                      <div className="text-white font-bold">{guessResult.correctLocation.title}</div>
                      <div className="text-white/60 text-sm">
                        {guessResult.correctLocation.country.text}
                        {guessResult.correctLocation.state && 
                          `, ${guessResult.correctLocation.state.text}`
                        }
                      </div>
                    </div>

                    {/* Multiplayer status */}
                    {syncState.isMultiplayer && (
                      <div className="border-t border-white/20 pt-4">
                        <div className="text-white/80 text-sm mb-2">Multiplayer Status:</div>
                        
                        {!syncState.roundComplete && (
                          <div className="text-orange-500 font-bold text-sm mb-2">
                            {syncState.playersFinished}/{syncState.totalPlayers} players finished
                          </div>
                        )}

                        {syncState.roundComplete && (
                          <>
                            <div className="text-green-500 font-bold text-sm mb-2">
                              ✓ All players finished!
                            </div>
                            
                            {isReadyForNextRound ? (
                              <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-3">
                                <div className="text-blue-400 font-medium text-sm">
                                  ✓ You're ready! Waiting for others...
                                </div>
                                <div className="text-white/70 text-xs mt-1">
                                  {syncState.readyCount}/{syncState.totalPlayers} ready
                                </div>
                              </div>
                            ) : (
                              <div className="bg-orange-500/20 border border-orange-500/50 rounded-lg p-3">
                                <div className="text-orange-400 font-medium text-sm">
                                  Ready for next round?
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Action indicator */}
                        {actionDebounce.pendingActions.size > 0 && (
                          <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-2 mt-2">
                            <div className="text-yellow-400 text-xs">
                              ⏳ Processing... ({Array.from(actionDebounce.pendingActions).join(', ')})
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Next Round / Ready buttons */}
                    {!syncState.isMultiplayer && (
                      <button
                        onClick={handleNextRound}
                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 mt-6"
                      >
                        {currentRoundNumber < totalRounds ? 'Next Round' : 'Finish Game'}
                        <ArrowRight size={18} />
                      </button>
                    )}

                    {/* Ready button for multiplayer */}
                    {showReadyButton && (
                      <button
                        onClick={handleReadyForNextRound}
                        disabled={actionDebounce.pendingActions.size > 0}
                        className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 mt-6"
                      >
                        <Users size={18} />
                        {actionDebounce.pendingActions.size > 0 ? 'Processing...' : 'Ready for Next Round'}
                      </button>
                    )}

                    {/* Waiting for others display */}
                    {syncState.isMultiplayer && isReadyForNextRound && !syncState.allPlayersReady && (
                      <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-4 mt-4">
                        <div className="text-green-400 font-medium mb-2 flex items-center gap-2">
                          <Timer size={16} />
                          Waiting for other players...
                        </div>
                        <p className="text-white/70 text-sm">
                          {syncState.readyCount}/{syncState.totalPlayers} players ready
                        </p>
                        <div className="w-full bg-white/20 rounded-full h-2 mt-2">
                          <div 
                            className="bg-green-500 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(syncState.readyCount / syncState.totalPlayers) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </GlassCard>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Game;