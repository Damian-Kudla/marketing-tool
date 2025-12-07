import React, { useEffect, useState } from 'react';

interface ComicExplosionProps {
  x: number;
  y: number;
  onComplete: () => void;
}

export function ComicExplosion({ x, y, onComplete }: ComicExplosionProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 800); // Animation duration
    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!visible) return null;

  return (
    <div
      className="fixed pointer-events-none z-[9999]"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="relative flex items-center justify-center">
        {/* Outer jagged shape (Orange/Red) */}
        <div className="absolute animate-explosion-scale">
          <svg width="200" height="200" viewBox="0 0 100 100" className="drop-shadow-lg">
            <path
              d="M50 0 L60 35 L95 30 L70 60 L90 90 L55 75 L40 100 L30 65 L0 70 L25 40 L5 10 L40 25 Z"
              fill="#FF4500"
              stroke="#8B0000"
              strokeWidth="2"
            />
          </svg>
        </div>

        {/* Inner jagged shape (Yellow) */}
        <div className="absolute animate-explosion-scale delay-75">
          <svg width="140" height="140" viewBox="0 0 100 100">
            <path
              d="M50 10 L58 38 L90 35 L68 60 L85 85 L55 72 L40 90 L32 62 L10 65 L30 42 L15 15 L42 28 Z"
              fill="#FFD700"
              stroke="#FFA500"
              strokeWidth="2"
            />
          </svg>
        </div>

        {/* Particles */}
        {[...Array(8)].map((_, i) => (
           <div 
             key={i}
             className="absolute w-2 h-2 bg-yellow-400 rounded-full animate-particle"
             style={{
               transform: `rotate(${i * 45}deg) translate(60px)`,
               opacity: 0
             }}
           />
        ))}
      </div>
      
      <style>{`
        @keyframes explosion-scale {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.2); opacity: 1; }
          80% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes explosion-text {
          0% { transform: scale(0) rotate(-10deg); opacity: 0; }
          60% { transform: scale(1.5) rotate(5deg); opacity: 1; }
          100% { transform: scale(2) rotate(0deg); opacity: 0; }
        }
        @keyframes particle {
          0% { transform: rotate(var(--r)) translate(0); opacity: 1; }
          100% { transform: rotate(var(--r)) translate(100px); opacity: 0; }
        }
        .animate-explosion-scale {
          animation: explosion-scale 0.6s ease-out forwards;
        }
        .animate-explosion-text {
          animation: explosion-text 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
        .animate-particle {
          animation: particle 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
