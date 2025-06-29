import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Header from './components/Header';
import Home from './pages/Home';
import QuickPlay from './pages/QuickPlay';
import PartyPlay from './pages/PartyPlay';
import PartyLobby from './pages/PartyLobby';
import Settings from './pages/Settings';
import Game from './pages/Game';

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