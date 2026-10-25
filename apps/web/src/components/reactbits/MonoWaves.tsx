import { useEffect, useRef } from 'react';

interface MonoWavesProps {
  className?: string;
}

export function MonoWaves({ className = '' }: MonoWavesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let step = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      step += 0.012;

      const lines = [
        { amp: 14, freq: 0.007, speed: 1.0, color: 'rgba(54, 84, 61, 0.12)', offset: 0 },
        { amp: 20, freq: 0.005, speed: 0.75, color: 'rgba(54, 84, 61, 0.08)', offset: 1.8 },
        { amp: 10, freq: 0.011, speed: 1.25, color: 'rgba(92, 128, 102, 0.09)', offset: 3.5 },
      ];

      lines.forEach(({ amp, freq, speed, color, offset }) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;

        for (let x = 0; x <= canvas.width; x += 4) {
          const y = canvas.height * 0.52 + Math.sin(x * freq + step * speed + offset) * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`mono-waves-canvas ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        borderRadius: 'inherit',
        zIndex: 0,
      }}
    />
  );
}
