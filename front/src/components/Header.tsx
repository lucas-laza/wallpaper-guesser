import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import LoginModal from './LoginModal';
import SettingsModal from './SettingsModal';

const Header = () => {
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { currentTheme } = useTheme();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (path: string) => location.pathname === path;

  // Fermer le menu si clic ailleurs
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isUserMenuOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/60 via-black/30 to-transparent backdrop-blur-sm">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-1 text-2xl font-bold font-anonymous">
              <span className="text-white">Wallpaper</span>
              <span style={{ color: currentTheme.accent }}>Guesser</span>
            </Link>

            {/* Navigation */}
            <nav className="hidden md:flex items-center space-x-8 font-montserrat">
              <Link
                to="/"
                className="flex items-center relative transition-colors duration-200 text-white hover:text-white/80"
              >
                <div 
                  className="w-1.5 h-1.5 rounded-full mr-2"
                  style={{ 
                    backgroundColor: isActive('/') ? currentTheme.accent : `${currentTheme.accent}66`
                  }}
                ></div>
                Home
                {isActive('/') && (
                  <div 
                    className="absolute -bottom-1 left-0 right-0 h-0.5 transform origin-left animate-nav-underline"
                    style={{ backgroundColor: currentTheme.accent }}
                  ></div>
                )}
              </Link>
              <Link
                to="/quick-play"
                className="flex items-center relative transition-colors duration-200 text-white hover:text-white/80"
              >
                <div 
                  className="w-1.5 h-1.5 rounded-full mr-2"
                  style={{ 
                    backgroundColor: isActive('/quick-play') ? currentTheme.accent : `${currentTheme.accent}66`
                  }}
                ></div>
                Quick Play
                {isActive('/quick-play') && (
                  <div 
                    className="absolute -bottom-1 left-0 right-0 h-0.5 transform origin-left animate-nav-underline"
                    style={{ backgroundColor: currentTheme.accent }}
                  ></div>
                )}
              </Link>
              <Link
                to="/party-play"
                className="flex items-center relative transition-colors duration-200 text-white hover:text-white/80"
              >
                <div 
                  className="w-1.5 h-1.5 rounded-full mr-2"
                  style={{ 
                    backgroundColor: isActive('/party-play') ? currentTheme.accent : `${currentTheme.accent}66`
                  }}
                ></div>
                Party Play
                {isActive('/party-play') && (
                  <div 
                    className="absolute -bottom-1 left-0 right-0 h-0.5 transform origin-left animate-nav-underline"
                    style={{ backgroundColor: currentTheme.accent }}
                  ></div>
                )}
              </Link>
            </nav>

            {/* User Actions */}
            <div className="flex items-center space-x-3 font-montserrat">
              {isAuthenticated ? (
                <>
                  {/* User Info + Dropdown */}
                  <div className="hidden sm:flex items-center space-x-2 text-white relative" ref={userMenuRef}>
                    <button
                      className="flex items-center gap-2 px-4 h-10 rounded-full border border-white/30 text-white hover:bg-white/10 hover:border-white/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none"
                      onClick={() => setIsUserMenuOpen((v) => !v)}
                      tabIndex={0}
                      aria-haspopup="true"
                      aria-expanded={isUserMenuOpen}
                    >
                      <User size={16} />
                      <span className="text-sm font-medium">{user?.name}</span>
                    </button>
                    {isUserMenuOpen && (
                      <div
                        className="absolute left-0 mt-[16rem] min-w-[10rem] w-48 bg-black/90 border border-white/20 rounded-lg shadow-lg z-50 py-2 animate-fade-in"
                        style={{ minWidth: 'max-content', marginLeft: 0 }}
                      >
                        <Link
                          to="/profile"
                          className="block px-4 py-2 text-white hover:bg-white/10 transition-colors text-sm w-full text-left font-semibold border-b border-white/10"
                          onClick={() => setIsUserMenuOpen(false)}
                          tabIndex={0}
                        >
                          Profil
                        </Link>
                        <Link
                          to="/stats"
                          className="block px-4 py-2 text-white hover:bg-white/10 transition-colors text-sm w-full text-left"
                          onClick={() => setIsUserMenuOpen(false)}
                          tabIndex={0}
                        >
                          Statistiques
                        </Link>
                        <Link
                          to="/history"
                          className="block px-4 py-2 text-white hover:bg-white/10 transition-colors text-sm w-full text-left"
                          onClick={() => setIsUserMenuOpen(false)}
                          tabIndex={0}
                        >
                          Historique
                        </Link>
                        <button
                          className="w-full text-left px-4 py-2 text-white hover:bg-white/10 transition-colors text-sm"
                          onClick={() => {
                            setIsSettingsModalOpen(true);
                            setIsUserMenuOpen(false);
                          }}
                          tabIndex={0}
                        >
                          Paramètres
                        </button>
                        <button
                          className="w-full text-left px-4 py-2 text-red-300 hover:bg-red-500/20 transition-colors text-sm"
                          onClick={() => {
                            logout();
                            setIsUserMenuOpen(false);
                          }}
                          tabIndex={0}
                        >
                          Déconnexion
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* Login Button */
                <button
                  onClick={() => setIsLoginModalOpen(true)}
                  className="px-4 py-2 text-white font-medium rounded-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{ backgroundColor: currentTheme.accent }}
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Login Modal */}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
      />
      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </>
  );
};

export default Header;