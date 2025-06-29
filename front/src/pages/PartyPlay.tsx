// PartyPlay.tsx - Mise à jour avec redirection par code

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Loader2 } from 'lucide-react';
import BackgroundImage from '../components/BackgroundImage';
import GlassCard from '../components/GlassCard';
import LoginModal from '../components/LoginModal';
import { useAuth } from '../contexts/AuthContext';
import { createParty, joinParty } from '../services/api';

const PartyPlay = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<'join' | 'create'>('join');
  const [roomCode, setRoomCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleJoinRoom = async () => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }

    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const party = await joinParty(roomCode.trim());
      setSuccess(`Successfully joined party: ${party.code}`);
      
      // Redirect to party lobby with CODE instead of ID
      setTimeout(() => {
        navigate(`/party/${party.code}`);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to join party');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateRoom = async () => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');

    try {
      const party = await createParty();
      setSuccess(`Party created! Code: ${party.code}`);
      
      // Redirect to party lobby with CODE instead of ID
      setTimeout(() => {
        navigate(`/party/${party.code}`);
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to create party');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (activeTab === 'join') {
        handleJoinRoom();
      } else {
        handleCreateRoom();
      }
    }
  };

  return (
    <>
      <BackgroundImage src="https://images.pexels.com/photos/1435752/pexels-photo-1435752.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
        <div className="min-h-screen flex items-center justify-center p-6 pt-24">
          <div className="w-full max-w-md">
            <GlassCard>
              <h1 className="text-white text-3xl font-bold text-center mb-8">Party Play</h1>
              
              {/* Error Message */}
              {error && (
                <div className="mb-6 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
                  {error}
                </div>
              )}

              {/* Success Message */}
              {success && (
                <div className="mb-6 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-300 text-sm">
                  {success}
                </div>
              )}
              
              {/* Tabs */}
              <div className="flex mb-6 bg-white/10 rounded-lg p-1">
                <button
                  onClick={() => {
                    setActiveTab('join');
                    setError('');
                    setSuccess('');
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-colors duration-200 ${
                    activeTab === 'join' 
                      ? 'bg-orange-500 text-white' 
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  <Users size={16} />
                  Join Room
                </button>
                <button
                  onClick={() => {
                    setActiveTab('create');
                    setError('');
                    setSuccess('');
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-colors duration-200 ${
                    activeTab === 'create' 
                      ? 'bg-orange-500 text-white' 
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  <Plus size={16} />
                  Create Room
                </button>
              </div>

              {/* Join Room Tab */}
              {activeTab === 'join' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-white/80 text-sm font-medium mb-2">
                      Room Code
                    </label>
                    <input
                      type="text"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      onKeyPress={handleKeyPress}
                      placeholder="Enter 6-character code"
                      className="w-full p-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-orange-500 transition-colors duration-200"
                      maxLength={6}
                      disabled={isLoading}
                    />
                    <p className="text-white/50 text-xs mt-1">
                      Example: ABC123
                    </p>
                  </div>
                  <button
                    onClick={handleJoinRoom}
                    disabled={!roomCode.trim() || isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-white/20 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-all duration-200"
                  >
                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Users size={18} />}
                    {isLoading ? 'Joining...' : 'Join Room'}
                  </button>
                </div>
              )}

              {/* Create Room Tab */}
              {activeTab === 'create' && (
                <div className="space-y-4">
                  <div className="bg-white/5 p-4 rounded-lg border border-white/10">
                    <h4 className="text-white font-medium mb-2">Create a Private Party</h4>
                    <p className="text-white/70 text-sm">
                      Create a private room where you can invite friends to play together. 
                      You'll be the room admin and can configure the game settings.
                    </p>
                  </div>
                  
                  <button
                    onClick={handleCreateRoom}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:bg-white/20 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-all duration-200"
                  >
                    {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                    {isLoading ? 'Creating...' : 'Create Party'}
                  </button>
                </div>
              )}

              {/* Authentication Notice */}
              {!isAuthenticated && (
                <div className="mt-6 p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg text-blue-300 text-sm">
                  <p className="font-medium mb-1">Sign in required</p>
                  <p>You need to be signed in to create or join a party.</p>
                </div>
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

export default PartyPlay;