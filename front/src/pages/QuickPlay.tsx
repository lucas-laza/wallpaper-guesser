import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, ChevronDown, AlertTriangle, RotateCcw, Clock, Target } from 'lucide-react';
import BackgroundImage from '../components/BackgroundImage';
import GlassCard from '../components/GlassCard';
import LoginModal from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { startSoloGame, checkActiveGame, quitActiveGame, ActiveGameInfo } from '../services/api';

const QuickPlay = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [selectedRegion, setSelectedRegion] = useState('World');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [roundsNumber, setRoundsNumber] = useState(3);
  const [time, setTime] = useState(60);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [error, setError] = useState('');
  
  // États pour la gestion des parties actives
  const [activeGame, setActiveGame] = useState<ActiveGameInfo | null>(null);
  const [showActiveGameModal, setShowActiveGameModal] = useState(false);
  const [isQuittingActive, setIsQuittingActive] = useState(false);
  const [isCheckingActive, setIsCheckingActive] = useState(false);
  
  const regions = ['World', 'Europe', 'Asia', 'North America', 'South America', 'Africa', 'Oceania'];

  // Vérifier les parties actives au chargement
  useEffect(() => {
    if (isAuthenticated) {
      checkForActiveGame();
    }
  }, [isAuthenticated]);

  const checkForActiveGame = async () => {
    if (!isAuthenticated) return;
    
    setIsCheckingActive(true);
    try {
      const activeGameInfo = await checkActiveGame();
      if (activeGameInfo.hasActiveGame) {
        setActiveGame(activeGameInfo);
        setShowActiveGameModal(true);
      }
    } catch (error) {
      console.error('Error checking for active game:', error);
    } finally {
      setIsCheckingActive(false);
    }
  };

  const handleStartGame = async () => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      console.log('Données envoyées au backend :', { roundsNumber, time, map: selectedRegion });
      const game = await startSoloGame({
        roundsNumber,
        time,
        map: selectedRegion
      });
      console.log('Réponse reçue du backend :', game);
      
      if (game.roundsNumber < roundsNumber) {
        alert(`Seulement ${game.roundsNumber} images disponibles pour cette map. Le jeu comportera ${game.roundsNumber} manches.`);
      }
      
      navigate(`/game/${game.gameId}`);
    } catch (err: any) {
      // Vérifier si c'est un conflit de partie active
      if (err.message.includes('already have an active game')) {
        await checkForActiveGame();
      } else {
        setError(err.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResumeActiveGame = () => {
    if (activeGame?.gameId) {
      navigate(`/game/${activeGame.gameId}`);
    }
  };

  const handleQuitActiveGame = async () => {
    if (!window.confirm('Are you sure you want to quit your active game? All progress will be lost.')) {
      return;
    }

    setIsQuittingActive(true);
    try {
      await quitActiveGame();
      setActiveGame(null);
      setShowActiveGameModal(false);
      
      // Attendre un peu pour que la base de données se mette à jour
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Maintenant on peut essayer de démarrer la nouvelle partie
      await handleStartGame();
    } catch (error: any) {
      console.error('Error quitting active game:', error);
      setError(`Failed to quit active game: ${error.message}`);
    } finally {
      setIsQuittingActive(false);
    }
  };

  const handleCloseActiveGameModal = () => {
    setShowActiveGameModal(false);
    setActiveGame(null);
  };

  return (
    <>
      {/* Header dynamique QuickPlay (avant lancement du jeu) */}
      <div className="relative z-10 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <GlassCard className="flex items-center gap-3 py-2 px-4">
              <div className="flex items-center gap-2 text-white">
                <Target size={18} />
                <span className="font-medium">1/{roundsNumber}</span>
              </div>
              <div className="flex items-center gap-2 text-white">
                <Clock size={18} />
                <span className="font-medium">
                  {Math.floor(time / 60)}:{(time % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
      {/* Fin header dynamique */}
      <BackgroundImage src="https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
        <div className="min-h-screen flex items-center justify-center p-6 pt-24">
          <div className="w-full max-w-md">
            <GlassCard className="text-center">
              <h1 className="text-white text-3xl font-bold mb-8">Quick Play</h1>
              
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                  {error}
                  <button 
                    onClick={() => setError('')} 
                    className="ml-2 text-red-200 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              )}

              {isCheckingActive && (
                <div className="mb-6 p-3 bg-orange-500/20 border border-orange-500/50 rounded-lg text-orange-300 text-sm">
                  Checking for active games...
                </div>
              )}

              {/* Game Settings */}
              <div className="space-y-6 mb-8">
                {/* Region Selector */}
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-3">
                    Select Region
                  </label>
                  <div className="relative">
                    <button
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full flex items-center justify-between p-3 bg-white/10 border border-white/20 rounded-lg text-white hover:bg-white/20 transition-colors duration-200"
                    >
                      <span>{selectedRegion}</span>
                      <ChevronDown 
                        size={16} 
                        className={`transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    
                    {isDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-black/80 backdrop-blur-md border border-white/20 rounded-lg overflow-hidden z-20">
                        {regions.map((region) => (
                          <button
                            key={region}
                            onClick={() => {
                              setSelectedRegion(region);
                              setIsDropdownOpen(false);
                            }}
                            className="w-full p-3 text-left text-white hover:bg-white/20 transition-colors duration-200"
                          >
                            {region}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Rounds Number */}
                <div>
                  <label className="block text-white/80 text-sm font-medium mb-3">
                    Number of Rounds
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
                  <label className="block text-white/80 text-sm font-medium mb-3">
                    Time per Round (seconds)
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

              {/* Start Button */}
              <button
                onClick={handleStartGame}
                disabled={isLoading || isCheckingActive}
                className="w-full flex items-center justify-center gap-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white font-bold py-4 px-6 rounded-lg transition-colors duration-200 transform hover:scale-105 disabled:transform-none"
              >
                {isLoading ? (
                  <>
                    <RotateCcw size={20} className="animate-spin" />
                    Starting Game...
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    Start Game
                  </>
                )}
              </button>

              {!isAuthenticated && (
                <p className="mt-4 text-white/60 text-sm">
                  You need to be signed in to start a game
                </p>
              )}
            </GlassCard>
          </div>
        </div>
      </BackgroundImage>

      {/* Modal de partie active */}
      {showActiveGameModal && activeGame && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <GlassCard className="max-w-md w-full">
            <div className="text-center mb-6">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center">
                  <AlertTriangle size={24} className="text-yellow-500" />
                </div>
              </div>
              <h2 className="text-white text-xl font-bold mb-2">Active Game Found</h2>
              <p className="text-white/80 text-sm">
                You have an active game in progress. Resume it or quit to start a new one.
              </p>
            </div>

            <div className="bg-white/10 rounded-lg p-4 mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-white/60">Progress</div>
                  <div className="text-white font-medium">
                    Round {activeGame.currentRound}/{activeGame.totalRounds}
                  </div>
                </div>
                <div>
                  <div className="text-white/60">Map</div>
                  <div className="text-white font-medium">{activeGame.map}</div>
                </div>
              </div>
              
              {activeGame.isCompleted && (
                <div className="mt-3 p-2 bg-green-500/20 border border-green-500/50 rounded text-green-300 text-sm text-center">
                  Game completed! View your results.
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleResumeActiveGame}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Play size={16} />
                {activeGame.isCompleted ? 'View Results' : 'Resume'}
              </button>
              
              <button
                onClick={handleQuitActiveGame}
                disabled={isQuittingActive}
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isQuittingActive ? (
                  <>
                    <RotateCcw size={16} className="animate-spin" />
                    Quitting...
                  </>
                ) : (
                  'Quit & Start New'
                )}
              </button>
            </div>

            <button
              onClick={handleCloseActiveGameModal}
              className="w-full mt-3 text-white/60 hover:text-white/80 text-sm py-2 transition-colors"
            >
              Cancel
            </button>
          </GlassCard>
        </div>
      )}

      {/* Login Modal */}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
      />
    </>
  );
};

export default QuickPlay;