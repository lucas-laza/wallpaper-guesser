import React, { useState } from 'react';
import { Volume2, Map, RotateCcw } from 'lucide-react';
import BackgroundImage from '../components/BackgroundImage';
import GlassCard from '../components/GlassCard';
import Toggle from '../components/Toggle';

const Settings = () => {
  const [settings, setSettings] = useState({
    backgroundMusic: true,
    showLocationAfterGuess: false,
    autoStartNextRound: true,
  });

  const updateSetting = (key: keyof typeof settings, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <BackgroundImage src="https://images.pexels.com/photos/1624496/pexels-photo-1624496.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
      <div className="min-h-screen flex items-center justify-center p-6 pt-24">
        <div className="w-full max-w-lg">
          <GlassCard>
            <h1 className="text-white text-3xl font-bold text-center mb-8">Settings</h1>
            
            <div className="space-y-6">
              {/* Audio Settings */}
              <div>
                <h2 className="text-white/80 text-sm font-semibold uppercase tracking-wide mb-4 flex items-center gap-2">
                  <Volume2 size={16} />
                  Audio
                </h2>
                <div className="space-y-2">
                  <Toggle
                    enabled={settings.backgroundMusic}
                    onChange={(value) => updateSetting('backgroundMusic', value)}
                    label="Enable background music"
                  />
                </div>
              </div>

              {/* Gameplay Settings */}
              <div>
                <h2 className="text-white/80 text-sm font-semibold uppercase tracking-wide mb-4 flex items-center gap-2">
                  <Map size={16} />
                  Gameplay
                </h2>
                <div className="space-y-2">
                  <Toggle
                    enabled={settings.showLocationAfterGuess}
                    onChange={(value) => updateSetting('showLocationAfterGuess', value)}
                    label="Show correct location after guess"
                  />
                  <Toggle
                    enabled={settings.autoStartNextRound}
                    onChange={(value) => updateSetting('autoStartNextRound', value)}
                    label="Auto-start next round"
                  />
                </div>
              </div>

              {/* Reset Settings */}
              <div className="pt-4 border-t border-white/20">
                <button
                  onClick={() => setSettings({
                    backgroundMusic: true,
                    showLocationAfterGuess: false,
                    autoStartNextRound: true,
                  })}
                  className="flex items-center justify-center gap-2 w-full p-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg text-white transition-colors duration-200"
                >
                  <RotateCcw size={16} />
                  Reset to defaults
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </BackgroundImage>
  );
};

export default Settings;