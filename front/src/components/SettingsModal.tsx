import React, { useState } from 'react';
import GlassCard from './GlassCard';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [theme, setTheme] = useState('system');
  const [notifications, setNotifications] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <GlassCard className="w-full max-w-lg p-6 relative">
        <button
          className="absolute top-3 right-3 text-white/70 hover:text-white text-xl"
          onClick={onClose}
          aria-label="Fermer"
        >
          ×
        </button>
        <h2 className="text-2xl font-bold text-white mb-4 text-center">Paramètres du compte</h2>
        <form className="space-y-4">
          <div>
            <label className="block text-white/80 mb-1">Adresse e-mail</label>
            <input
              type="email"
              className="w-full rounded bg-white/10 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Nouvel e-mail"
            />
          </div>
          <div>
            <label className="block text-white/80 mb-1">Pseudo</label>
            <input
              type="text"
              className="w-full rounded bg-white/10 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nouveau pseudo"
            />
          </div>
          <div>
            <label className="block text-white/80 mb-1">Mot de passe actuel</label>
            <input
              type="password"
              className="w-full rounded bg-white/10 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Mot de passe actuel"
            />
          </div>
          <div className="flex space-x-2">
            <div className="flex-1">
              <label className="block text-white/80 mb-1">Nouveau mot de passe</label>
              <input
                type="password"
                className="w-full rounded bg-white/10 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Nouveau mot de passe"
              />
            </div>
            <div className="flex-1">
              <label className="block text-white/80 mb-1">Confirmer</label>
              <input
                type="password"
                className="w-full rounded bg-white/10 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirmer"
              />
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <label className="text-white/80">Thème</label>
            <select
              className="rounded bg-white/10 text-white px-2 py-1"
              value={theme}
              onChange={e => setTheme(e.target.value)}
            >
              <option value="system">Système</option>
              <option value="light">Clair</option>
              <option value="dark">Sombre</option>
            </select>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={notifications}
              onChange={e => setNotifications(e.target.checked)}
              id="notif"
            />
            <label htmlFor="notif" className="text-white/80">Recevoir les notifications</label>
          </div>
          <div className="border-t border-white/10 pt-4 mt-4">
            <label className="block text-red-400 mb-1 font-semibold">Supprimer mon compte</label>
            <input
              type="text"
              className="w-full rounded bg-white/10 text-white px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-red-400"
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder="Tapez SUPPRIMER pour confirmer"
            />
            <button
              type="button"
              className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded transition"
              disabled={deleteConfirm !== 'SUPPRIMER'}
              // onClick={handleDeleteAccount}
            >
              Supprimer définitivement
            </button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
};

export default SettingsModal; 