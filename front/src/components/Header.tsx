import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Settings, User, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import LoginModal from './LoginModal';

const Header = () => {
  const location = useLocation();
  const { user, isAuthenticated, logout } = useAuth();
  const { currentTheme } = useTheme();
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const isActive = (path: string) => location.pathname === path;

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
                  {/* User Info */}
                  <div className="hidden sm:flex items-center space-x-2 text-white">
                    <User size={16} />
                    <span className="text-sm font-medium">{user?.name}</span>
                  </div>
                  
                  {/* Logout Button */}
                  <button
                    onClick={logout}
                    className="flex items-center justify-center w-10 h-10 rounded-full border border-white/30 text-white hover:bg-white/10 hover:border-white/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                    title="Logout"
                  >
                    <LogOut size={16} />
                  </button>
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

              {/* Settings Button */}
              <button
                className="flex items-center justify-center w-10 h-10 rounded-full border border-white/30 text-white hover:bg-white/10 hover:border-white/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                onClick={() => {/* Handle settings */}}
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Login Modal */}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
      />
    </>
  );
};

export default Header;