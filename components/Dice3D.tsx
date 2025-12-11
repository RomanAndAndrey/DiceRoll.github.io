
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

interface DiceProps {
  value: number | undefined;
  rolling: boolean;
  color?: 'primary' | 'secondary';
}

const DOT_POSITIONS: Record<number, number[][]> = {
  1: [[50, 50]],
  2: [[20, 20], [80, 80]],
  3: [[20, 20], [50, 50], [80, 80]],
  4: [[20, 20], [20, 80], [80, 20], [80, 80]],
  5: [[20, 20], [20, 80], [50, 50], [80, 20], [80, 80]],
  6: [[20, 20], [20, 50], [20, 80], [80, 20], [80, 50], [80, 80]],
};

// Map values to 3D rotation angles to show that face
// [x, y] in degrees
const ROTATION_MAP: Record<number, [number, number]> = {
  1: [0, 0],      // Front
  2: [0, -90],    // Right
  3: [0, -180],   // Back
  4: [0, 90],     // Left
  5: [-90, 0],    // Top
  6: [90, 0],     // Bottom
};

interface FaceProps {
  index: number;
  transform: string;
  colorClass: string;
  dotClass: string;
}

const DiceFace: React.FC<FaceProps> = ({ index, transform, colorClass, dotClass }) => (
  <div
    className={`absolute w-full h-full border-2 rounded-xl flex items-center justify-center backface-visible ${colorClass}`}
    style={{ 
      transform,
      backfaceVisibility: 'hidden',
      WebkitBackfaceVisibility: 'hidden', // Safari support
      boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5)'
    }}
  >
    {DOT_POSITIONS[index]?.map((pos, i) => (
      <div
        key={i}
        className={`absolute w-3.5 h-3.5 rounded-full shadow-sm ${dotClass}`}
        style={{
          left: `${pos[0]}%`,
          top: `${pos[1]}%`,
          transform: 'translate(-50%, -50%)',
          boxShadow: '0 0 4px currentColor'
        }}
      />
    ))}
  </div>
);

export const Dice3D: React.FC<DiceProps> = ({ value = 1, rolling, color = 'primary' }) => {
  const isPrimary = color === 'primary';
  
  // Theme Styles
  const faceBg = isPrimary ? 'bg-indigo-600/90' : 'bg-rose-600/90';
  const borderColor = isPrimary ? 'border-indigo-400' : 'border-rose-400';
  const glowColor = isPrimary ? 'rgba(99, 102, 241, 0.6)' : 'rgba(244, 63, 94, 0.6)';
  const dotColor = 'bg-white';
  
  const colorClass = `${faceBg} ${borderColor}`;

  // 3D Cube Construction
  // Translating Z by 3rem (half of w-24/h-24 which is 6rem/96px)
  const halfSize = '3rem'; 
  
  const faces = [
    { idx: 1, trans: `translateZ(${halfSize})` },                 // Front
    { idx: 2, trans: `rotateY(90deg) translateZ(${halfSize})` },  // Right
    { idx: 3, trans: `rotateY(180deg) translateZ(${halfSize})` }, // Back
    { idx: 4, trans: `rotateY(-90deg) translateZ(${halfSize})` }, // Left
    { idx: 5, trans: `rotateX(90deg) translateZ(${halfSize})` },  // Top
    { idx: 6, trans: `rotateX(-90deg) translateZ(${halfSize})` }, // Bottom
  ];

  // Animation Logic
  const targetRotation = useMemo(() => ROTATION_MAP[value] || [0,0], [value]);
  
  // If undefined/initial, standard idle animation or static
  const isIdle = !rolling && value === undefined;

  return (
    <div className="relative w-24 h-24 perspective-1000 group cursor-default">
      {/* Glow/Shadow underlying layer */}
      <motion.div 
        className="absolute inset-0 rounded-full blur-xl"
        animate={{
          opacity: rolling ? [0.4, 0.8, 0.4] : 0.2,
          scale: rolling ? [1, 1.5, 1] : 1,
          background: glowColor
        }}
        transition={{ duration: 1, repeat: Infinity }}
      />

      <motion.div
        className="w-full h-full relative preserve-3d"
        style={{ transformStyle: 'preserve-3d' }}
        animate={rolling ? {
          rotateX: [0, 360, 720, 1080 + Math.random() * 360],
          rotateY: [0, 360, 720, 720 + Math.random() * 360],
          rotateZ: [0, 45, -45, 0], // Add some chaotic wobble
          scale: [1, 0.85, 1.1, 1],
        } : {
          rotateX: targetRotation[0],
          rotateY: targetRotation[1],
          rotateZ: 0,
          scale: 1
        }}
        transition={rolling ? {
          duration: 0.8,
          ease: "linear",
          repeat: Infinity,
        } : {
          type: "spring",
          stiffness: 60,
          damping: 12,
          mass: 1.2
        }}
      >
        {faces.map((face) => (
          <DiceFace 
            key={face.idx}
            index={face.idx} 
            transform={face.trans} 
            colorClass={colorClass}
            dotClass={dotColor}
          />
        ))}
      </motion.div>

      {/* Particle Effects (Simple Sparks) */}
      {rolling && (
        <>
          <motion.div 
             className={`absolute -top-4 -right-4 w-2 h-2 rounded-full ${isPrimary ? 'bg-indigo-300' : 'bg-rose-300'}`}
             animate={{ x: [0, 40], y: [0, -40], opacity: [1, 0] }}
             transition={{ duration: 0.6, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div 
             className={`absolute -bottom-4 -left-4 w-2 h-2 rounded-full ${isPrimary ? 'bg-indigo-300' : 'bg-rose-300'}`}
             animate={{ x: [0, -40], y: [0, 40], opacity: [1, 0] }}
             transition={{ duration: 0.6, repeat: Infinity, delay: 0.3, ease: 'easeOut' }}
          />
        </>
      )}
    </div>
  );
};
