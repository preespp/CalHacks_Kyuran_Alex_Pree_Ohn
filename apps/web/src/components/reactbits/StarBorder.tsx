import React from 'react';

interface StarBorderProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function StarBorder({
  children,
  className = '',
  onClick,
  disabled,
  ...props
}: StarBorderProps) {
  return (
    <div className={`star-border-wrapper ${className}`}>
      <div className="star-border-glow" aria-hidden="true" />
      <button
        type="button"
        className="primary-button star-border-btn-inner"
        onClick={onClick}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    </div>
  );
}
