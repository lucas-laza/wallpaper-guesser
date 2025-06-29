import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Clock, Target, ArrowRight, Home, Settings, X, Send } from 'lucide-react';
import GlassCard from '../components/GlassCard';
import CountryAutocomplete from '../components/CountryAutocomplete';
import { Round, GuessResult, getRound, submitGuess, finishGame } from '../services/api';

const Game = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  
  const [currentRound, setCurrentRound] = useState<Round | null>(null);
  const [currentRoundNumber, setCurrentRoundNumber] = useState(1);
  const [totalRounds] = useState(3); // TODO: Get from game settings
  const [timeLeft, setTimeLeft] = useState(60);
  const [isGuessing, setIsGuessing] = useState(false);
  const [guessResult, setGuessResult] = useState<GuessResult | null>(null);
  const [totalScore, setTotalScore] = useState(0);
  const [isGameFinished, setIsGameFinished] = useState(false);
  const [error, setError] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string>('');

  useEffect(() => {
    if (gameId) {
      loadRound(currentRoundNumber);
    }
  }, [gameId, currentRoundNumber]);

  useEffect(() => {
    if (timeLeft > 0 && !guessResult && !isGameFinished) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0 && !guessResult) {
      // Time's up - auto submit with empty guess
      handleGuessSubmit('');
    }
  }, [timeLeft, guessResult, isGameFinished]);

  const loadRound = async (roundNumber: number) => {
    try {
      setError('');
      const round = await getRound(parseInt(gameId!), roundNumber);
      setCurrentRound(round);
      setTimeLeft(60); // Reset timer
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
    if (!gameId || !currentRound || isGuessing) return;

    setIsGuessing(true);
    try {
      const result = await submitGuess(parseInt(gameId), currentRound.relative_id, {
        country: country || selectedCountry,
      });
      
      setGuessResult(result);
      setTotalScore(totalScore + result.score);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGuessing(false);
    }
  };

  const handleNextRound = () => {
    if (currentRoundNumber < totalRounds) {
      setCurrentRoundNumber(currentRoundNumber + 1);
    } else {
      finishGameHandler();
    }
  };

  const finishGameHandler = async () => {
    try {
      await finishGame(parseInt(gameId!));
      setIsGameFinished(true);
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

  const handleQuitGame = () => {
    if (window.confirm('Are you sure you want to quit the game?')) {
      navigate('/');
    }
  };

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
      {/* Game Image Background */}
      <div className="absolute inset-0">
        <img
          src={`http://localhost:3300/${currentRound.wallpaper.image}`}
          alt={currentRound.wallpaper.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
      </div>

      {/* Header - Minimalist */}
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
              className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/20 border border-red-500/50 text-red-300 hover:bg-red-500/30 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom UI */}
      <div className="absolute bottom-0 left-0 right-0 p-6 z-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-6">
            
            {/* Main Guess Interface */}
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

            {/* Results Panel */}
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

                    <button
                      onClick={handleNextRound}
                      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 mt-6"
                    >
                      {currentRoundNumber < totalRounds ? 'Next Round' : 'Finish Game'}
                      <ArrowRight size={20} />
                    </button>
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