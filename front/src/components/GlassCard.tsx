import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
}

const GlassCard: React.FC<GlassCardProps> = ({ children, className = '' }) => {
  return (
    <div className={`backdrop-blur-md bg-black/20 border border-white/20 rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
};

export default GlassCard;