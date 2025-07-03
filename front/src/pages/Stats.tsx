import React, { useEffect, useState } from 'react';
import GlassCard from '../components/GlassCard';
import { getUserGames } from '../services/api';

interface Stats {
  totalGames: number;
  totalWins: number;
  totalPoints: number;
  averagePoints: number;
}

const StatsPage = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const games = await getUserGames();
        console.log('User games:', games);
        const totalGames = games.length;
        const totalWins = games.filter((g: any) => g.status === 'completed' && g.isWinner).length;
        const totalPoints = games.reduce((sum: number, g: any) => sum + (g.score || 0), 0);
        const averagePoints = totalGames > 0 ? Math.round(totalPoints / totalGames) : 0;
        setStats({ totalGames, totalWins, totalPoints, averagePoints });
      } catch (err: any) {
        setError('Erreur lors du chargement des statistiques');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <GlassCard className="max-w-md w-full text-center">
        <h1 className="text-white text-3xl font-bold mb-6">Mes statistiques</h1>
        {loading ? (
          <div className="text-white/80">Chargement...</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : stats ? (
          <div className="space-y-4">
            <div>
              <span className="text-white/80">Parties jouées :</span>
              <span className="text-white font-bold ml-2">{stats.totalGames}</span>
            </div>
            <div>
              <span className="text-white/80">Victoires :</span>
              <span className="text-green-400 font-bold ml-2">{stats.totalWins}</span>
            </div>
            <div>
              <span className="text-white/80">Score total :</span>
              <span className="text-orange-400 font-bold ml-2">{stats.totalPoints}</span>
            </div>
            <div>
              <span className="text-white/80">Score moyen :</span>
              <span className="text-blue-400 font-bold ml-2">{stats.averagePoints}</span>
            </div>
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
};

export default StatsPage; 