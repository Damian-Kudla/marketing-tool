import React from 'react';
import { DotLottiePlayer } from '@dotlottie/react-player';
import '@dotlottie/react-player/dist/index.css';

interface ComicExplosionProps {
  x: number;
  y: number;
  onComplete?: () => void;
}

export const ComicExplosion: React.FC<ComicExplosionProps> = ({ x, y, onComplete }) => {
  return (
    <div 
      className="fixed pointer-events-none z-[2000] flex items-center justify-center"
      style={{ 
        left: x, 
        top: y,
        transform: 'translate(-50%, -50%)',
        width: '400px', // Increased size for better visibility
        height: '400px'
      }}
    >
      <DotLottiePlayer
        src="/animations/explosion.lottie"
        autoplay
        loop={false}
        onEvent={(event) => {
          if (event === 'complete') {
            onComplete?.();
          }
        }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
