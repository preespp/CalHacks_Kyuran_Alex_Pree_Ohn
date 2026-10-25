import { useEffect, useState } from 'react';

interface RotatingTextProps {
  words: string[];
  interval?: number;
  className?: string;
}

export function RotatingText({ words, interval = 2200, className = '' }: RotatingTextProps) {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % words.length);
        setFade(true);
      }, 260);
    }, interval);
    return () => clearInterval(timer);
  }, [words, interval]);

  return (
    <span
      className={`rotating-text-word ${className}`}
      style={{
        display: 'inline-block',
        transition: 'opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), filter 0.28s ease',
        opacity: fade ? 1 : 0,
        transform: fade ? 'translateY(0px)' : 'translateY(-6px)',
        filter: fade ? 'blur(0px)' : 'blur(4px)',
      }}
    >
      {words[index]}
    </span>
  );
}
