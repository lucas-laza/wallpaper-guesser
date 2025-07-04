import React, { useEffect, useState } from 'react';
import GlassCard from '../components/GlassCard';
import { getUserGames } from '../services/api';

interface Player {
  name: string;
}

interface PartyInfo {
  id: number;
  code: string;
  type: string;
  created_at?: string;
}

interface GameHistory {
  id: number;
  status?: string;
  gamemode?: string;
  map?: string;
  roundsNumber?: number;
  time?: number;
  players?: Player[];
  party?: PartyInfo | null;
  winner?: Player | null;
  isSolo?: boolean;
  score?: number;
}

const HistoryPage = () => {
  const [games, setGames] = useState<GameHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const data = await getUserGames();
        console.log('User games:', data);
        setGames(data);
      } catch {
        setError('Erreur lors du chargement de l\'historique');
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <GlassCard className="max-w-2xl w-full">
        <h1 className="text-white text-3xl font-bold mb-6 text-center">Historique des parties</h1>
        {loading ? (
          <div className="text-white/80 text-center">Chargement...</div>
        ) : error ? (
          <div className="text-red-400 text-center">{error}</div>
        ) : games.length === 0 ? (
          <div className="text-white/60 text-center">Aucune partie jouée pour le moment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-white/90 text-sm">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="py-2 px-3 text-left text-xs uppercase tracking-wider">Date</th>
                  <th className="py-2 px-3 text-left text-xs uppercase tracking-wider">Mode</th>
                  <th className="py-2 px-3 text-left text-xs uppercase tracking-wider">Map</th>
                  <th className="py-2 px-3 text-left text-xs uppercase tracking-wider">Score</th>
                  <th className="py-2 px-3 text-left text-xs uppercase tracking-wider">{games.some(g => g.party && g.party.type === 'private') ? 'Statut' : ''}</th>
                  <th className="py-2 px-3 text-left text-xs uppercase tracking-wider">Participants</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g, idx) => {
                  const isMulti = g.party && g.party.type === 'private';
                  const isWinner = g.winner && g.winner.name === (g.players && g.players[0]?.name);
                  return (
                    <tr
                      key={g.id}
                      className={`border-b border-white/10 hover:bg-white/10 transition ${idx % 2 === 0 ? 'even:bg-white/5' : ''}`}
                    >
                      <td className="py-3 px-3">{g.party?.created_at ? new Date(g.party.created_at).toLocaleString() : '-'}</td>
                      <td className="py-3 px-3">{g.gamemode || '-'}</td>
                      <td className="py-3 px-3">{g.map || '-'}</td>
                      <td className="py-3 px-3">{g.score ?? '-'}</td>
                      {isMulti ? (
                        <td className="py-3 px-3">
                          {g.status === 'completed' ? (
                            g.winner ? (
                              isWinner ? (
                                <span className="bg-green-500/20 text-green-400 font-bold px-2 py-1 rounded">Victoire</span>
                              ) : (
                                <span className="bg-red-500/20 text-red-400 font-bold px-2 py-1 rounded">Défaite</span>
                              )
                            ) : (
                              <span className="bg-yellow-500/20 text-yellow-400 font-bold px-2 py-1 rounded">Terminé</span>
                            )
                          ) : (
                            <span className="bg-yellow-500/20 text-yellow-400 font-bold px-2 py-1 rounded">{g.status || '-'}</span>
                          )}
                        </td>
                      ) : null}
                      <td className="py-3 px-3">
                        {g.players
                          ? g.players.length > 3
                            ? `${g.players.slice(0, 3).map((p: Player) => p.name).join(', ')} +${g.players.length - 3}`
                            : g.players.map((p: Player) => p.name).join(', ')
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default HistoryPage; 