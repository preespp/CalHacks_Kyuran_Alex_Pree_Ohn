import React, { useRef, useState } from 'react';

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  spotlightColor?: string;
  tilt?: boolean;
}

export function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(54, 84, 61, 0.12)',
  tilt = true,
  ...props
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [transform, setTransform] = useState<string>('perspective(1000px) rotateX(0deg) rotateY(0deg)');

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setCoords({ x, y });

    if (tilt) {
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -3.5;
      const rotateY = ((x - centerX) / centerX) * 3.5;
      setTransform(
        `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-3px) scale3d(1.012, 1.012, 1.012)`
      );
    }
  };

  const handleMouseLeave = () => {
    setCoords(null);
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0) scale3d(1, 1, 1)');
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`spotlight-card-wrapper ${className}`}
      style={{
        position: 'relative',
        transform,
        transition: coords ? 'transform 0.08s ease-out' : 'transform 0.35s ease-out',
        willChange: 'transform',
        borderRadius: '24px',
      }}
      {...props}
    >
      {coords && (
        <div
          className="spotlight-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            borderRadius: 'inherit',
            background: `radial-gradient(380px circle at ${coords.x}px ${coords.y}px, ${spotlightColor}, transparent 75%)`,
            zIndex: 4,
            transition: 'opacity 0.2s ease',
          }}
        />
      )}
      {children}
    </div>
  );
}
