import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, ChevronDown } from 'lucide-react';
import BackgroundImage from '../components/BackgroundImage';
import GlassCard from '../components/GlassCard';
import LoginModal from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { startSoloGame } from '../services/api';

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
  
  const regions = ['World', 'Europe', 'Asia', 'North America', 'South America', 'Africa', 'Oceania'];

  const handleStartGame = async () => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const game = await startSoloGame({
        roundsNumber,
        time,
      });
      
      // Redirect to game page with game ID
      navigate(`/game/${game.gameId}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <BackgroundImage src="https://images.pexels.com/photos/417074/pexels-photo-417074.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
        <div className="min-h-screen flex items-center justify-center p-6 pt-24">
          <div className="w-full max-w-md">
            <GlassCard className="text-center">
              <h1 className="text-white text-3xl font-bold mb-8">Quick Play</h1>
              
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                  {error}
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
                  <p className="text-white/50 text-xs mt-2">
                    Region filtering will be available soon
                  </p>
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
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-500/50 text-white font-bold py-4 px-6 rounded-lg transition-colors duration-200 transform hover:scale-105 disabled:transform-none"
              >
                <Play size={20} />
                {isLoading ? 'Starting Game...' : 'Start Game'}
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

      {/* Login Modal */}
      <LoginModal 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
      />
    </>
  );
};

export default QuickPlay;