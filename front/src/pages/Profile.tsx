import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import GlassCard from '../components/GlassCard';
import { useNavigate } from 'react-router-dom';

const Profile = () => {
  const { user, isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/'); // ou '/login' selon ta logique
    }
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black p-6 pt-24">
        <GlassCard className="max-w-lg w-full p-8 text-center text-white">Chargement...</GlassCard>
      </div>
    );
  }
  if (!user) return null;

  // Stats mockées (à remplacer par des vraies données si besoin)
  const stats = {
    gamesPlayed: 42,
    gamesWon: 18,
    bestScore: 9500,
    totalPlayTime: '3h 27m',
    accuracy: '78%',
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black p-6 pt-24">
      <GlassCard className="max-w-lg w-full p-8">
        <h1 className="text-3xl font-bold text-white mb-6">Mon Profil</h1>
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white/80 mb-2">Informations personnelles</h2>
          <div className="space-y-1 text-white/90">
            <div><span className="font-medium">Nom :</span> {user?.name}</div>
            <div><span className="font-medium">Email :</span> {user?.email}</div>
            {/* Ajoute ici d'autres infos si dispo, ex: date d'inscription */}
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white/80 mb-2">Statistiques générales</h2>
          <div className="grid grid-cols-2 gap-4 text-white/90">
            <div>
              <div className="text-xs text-white/60">Parties jouées</div>
              <div className="text-lg font-bold">{stats.gamesPlayed}</div>
            </div>
            <div>
              <div className="text-xs text-white/60">Parties gagnées</div>
              <div className="text-lg font-bold">{stats.gamesWon}</div>
            </div>
            <div>
              <div className="text-xs text-white/60">Meilleur score</div>
              <div className="text-lg font-bold">{stats.bestScore}</div>
            </div>
            <div>
              <div className="text-xs text-white/60">Temps de jeu total</div>
              <div className="text-lg font-bold">{stats.totalPlayTime}</div>
            </div>
            <div>
              <div className="text-xs text-white/60">Précision</div>
              <div className="text-lg font-bold">{stats.accuracy}</div>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
};

export default Profile; 