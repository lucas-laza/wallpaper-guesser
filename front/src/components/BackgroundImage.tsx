import React from 'react';

interface BackgroundImageProps {
  src: string;
  alt?: string;
  children?: React.ReactNode;
  overlay?: boolean;
}

const BackgroundImage: React.FC<BackgroundImageProps> = ({ 
  src, 
  alt = "Background", 
  children, 
  overlay = true 
}) => {
  return (
    <div className="relative min-h-screen w-full">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${src})` }}
        role="img"
        aria-label={alt}
      />
      
      {/* Overlay */}
      {overlay && (
        <div className="absolute inset-0 bg-black/40" />
      )}
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
};

export default BackgroundImage;