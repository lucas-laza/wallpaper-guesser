import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/Header';
import GlassCard from './components/GlassCard';
import Home from './pages/Home';
import QuickPlay from './pages/QuickPlay';
import PartyPlay from './pages/PartyPlay';
import PartyLobby from './pages/PartyLobby';
import Settings from './pages/Settings';
import Game from './pages/Game';
import { checkActiveGame, ActiveGameInfo } from './services/api';
import { Play, X } from 'lucide-react';

// Composant pour détecter les parties actives globalement
const ActiveGameChecker = () => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeGame, setActiveGame] = useState<ActiveGameInfo | null>(null);
  const [showModal, setShowModal] = useState(false);

  const shouldCheckActiveGame = () => {
    // Ne pas vérifier sur les routes de jeu, d'auth ou certaines pages
    const skipRoutes = ['/game/', '/login', '/register', '/'];
    return isAuthenticated && !skipRoutes.some(route => location.pathname.startsWith(route));
  };

  useEffect(() => {
    if (shouldCheckActiveGame()) {
      checkForActiveGame();
    }
  }, [isAuthenticated, location.pathname]);

  const checkForActiveGame = async () => {
    try {
      const activeGameInfo = await checkActiveGame();
      if (activeGameInfo.hasActiveGame) {
        setActiveGame(activeGameInfo);
        setShowModal(true);
      }
    } catch (error) {
      console.error('Error checking for active game:', error);
    }
  };

  const handleResumeGame = () => {
    if (activeGame?.gameId) {
      navigate(`/game/${activeGame.gameId}`);
      setShowModal(false);
    }
  };

  const handleDismiss = () => {
    setShowModal(false);
    setActiveGame(null);
  };

  if (!showModal || !activeGame) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <GlassCard className="max-w-md w-full">
        <div className="text-center mb-6">
          <h2 className="text-white text-xl font-bold mb-2">Active Game Found</h2>
          <p className="text-white/80 text-sm">
            You have an unfinished game. Would you like to continue?
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
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleResumeGame}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Play size={16} />
            Continue Game
          </button>
          
          <button
            onClick={handleDismiss}
            className="flex-1 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <X size={16} />
            Later
          </button>
        </div>
      </GlassCard>
    </div>
  );
};

// Composant pour gérer l'affichage conditionnel du header
const AppContent = () => {
  const location = useLocation();
  
  // Ne pas afficher le header sur les pages de jeu et lobby de partie
  const hideHeader = location.pathname.startsWith('/game/') || location.pathname.startsWith('/party/');

  return (
    <div className="min-h-screen relative">
      {!hideHeader && <Header />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/quick-play" element={<QuickPlay />} />
        <Route path="/party-play" element={<PartyPlay />} />
        <Route path="/party/:partyCode" element={<PartyLobby />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/game/:gameId" element={<Game />} />
      </Routes>
      <ActiveGameChecker />
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <AppContent />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;