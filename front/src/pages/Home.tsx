import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import BackgroundImage from '../components/BackgroundImage';
import GlassCard from '../components/GlassCard';

const Home = () => {
  const regions = ['World', 'Europe', 'Asia'];

  return (
    <BackgroundImage src="https://images.pexels.com/photos/1563356/pexels-photo-1563356.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop">
      <div className="min-h-screen flex flex-col justify-end p-6">
        <div className="flex flex-col lg:flex-row gap-6 max-w-7xl mx-auto w-full">
          
          {/* Info Box - Bottom Left */}
          <div className="lg:flex-1">
            <GlassCard className="max-w-md">
              <h3 className="text-orange-500 font-semibold text-sm uppercase tracking-wide mb-2">
                About this wallpaper:
              </h3>
              <h2 className="text-white text-xl font-bold mb-3">
                Tataouine, Tunisia | credit: Windows Spotlight
              </h2>
              <p className="text-white/80 text-sm leading-relaxed">
                This game is inspired by the Windows Spotlight wallpapers. All wallpapers are 
                provided via the MSN API. We do not own any of the images; they are used solely 
                for educational and entertainment purposes.
              </p>
            </GlassCard>
          </div>

          {/* Mode Selector - Bottom Right */}
          <div className="lg:w-80">
            <GlassCard>
              <h3 className="text-white font-bold text-lg mb-4">Quick play</h3>
              <div className="space-y-2">
                {regions.map((region) => (
                  <Link
                    key={region}
                    to="/quick-play"
                    className="flex items-center justify-between p-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors duration-200 group"
                  >
                    <span className="text-white font-medium">{region}</span>
                    <ChevronRight 
                      size={16} 
                      className="text-white/60 group-hover:text-white transition-colors duration-200" 
                    />
                  </Link>
                ))}
              </div>
              <Link
                to="/quick-play"
                className="block mt-4 text-center text-orange-500 hover:text-orange-400 font-medium transition-colors duration-200"
              >
                See all maps
              </Link>
            </GlassCard>
          </div>
        </div>
      </div>
    </BackgroundImage>
  );
};

export default Home;