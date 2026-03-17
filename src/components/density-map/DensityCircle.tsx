'use client';

import { useState, useRef } from 'react';
import type { Density } from '@/types/density';
import { formatAmount, formatDissolutionTime, getCircleSize } from '@/lib/densityScanner';

interface DensityCircleProps {
  density: Density;
  x: number;
  y: number;
  zoom: number;
  showDistance: boolean;
  showExchange: boolean;
  onHover: (density: Density | null, position: { x: number; y: number } | null) => void;
  onClick: (density: Density) => void;
}

const CIRCLE_SIZES = {
  small: 50,
  medium: 70,
  large: 90,
  xlarge: 120,
};

const ExchangeLogo = ({ exchange, size }: { exchange: string; size: number }) => {
  if (exchange === 'binance') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L7.5 6.5L9.62 8.62L12 6.24L14.38 8.62L16.5 6.5L12 2ZM2 12L6.5 7.5L8.62 9.62L6.24 12L8.62 14.38L6.5 16.5L2 12ZM22 12L17.5 16.5L15.38 14.38L17.76 12L15.38 9.62L17.5 7.5L22 12ZM12 22L16.5 17.5L14.38 15.38L12 17.76L9.62 15.38L7.5 17.5L12 22ZM12 15.38L14.38 12.99L12 10.62L9.62 12.99L12 15.38Z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 4H18V8L12 14L6 8V4ZM6 16H18V20H6V16Z" />
    </svg>
  );
};

export default function DensityCircle({
  density,
  x,
  y,
  zoom,
  showDistance,
  showExchange,
  onHover,
  onClick,
}: DensityCircleProps) {
  const [isHovered, setIsHovered] = useState(false);
  const circleRef = useRef<HTMLDivElement>(null);
  
  const circleSize = getCircleSize(density.dissolutionTime);
  const baseSize = CIRCLE_SIZES[circleSize];
  const size = baseSize * zoom;
  
  const isBuy = density.type === 'buy';
  const baseColor = isBuy ? '#22c55e' : '#ef4444';
  const glowColor = isBuy ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)';
  
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (circleRef.current) {
      const rect = circleRef.current.getBoundingClientRect();
      onHover(density, { 
        x: rect.right + 10, 
        y: rect.top + rect.height / 2 
      });
    }
  };
  
  const handleMouseLeave = () => {
    setIsHovered(false);
    onHover(null, null);
  };
  
  return (
    <div
      ref={circleRef}
      className="density-circle"
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        cursor: 'pointer',
        transform: isHovered ? 'scale(1.1)' : 'scale(1)',
        transition: 'transform 0.2s ease',
        zIndex: isHovered ? 100 : circleSize === 'xlarge' ? 4 : circleSize === 'large' ? 3 : circleSize === 'medium' ? 2 : 1,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onClick(density)}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `radial-gradient(circle at 30% 30%, ${baseColor}, ${isBuy ? '#15803d' : '#b91c1c'})`,
          boxShadow: isHovered 
            ? `0 0 20px ${glowColor}, 0 0 40px ${glowColor}` 
            : `0 0 10px ${glowColor}`,
          border: `2px solid ${isBuy ? '#4ade80' : '#f87171'}`,
        }}
      />
      
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4 * zoom,
          color: 'white',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 4 * zoom,
            fontSize: Math.max(9, 10 * zoom),
            fontWeight: 600,
            marginBottom: 2 * zoom,
          }}
        >
          {showDistance && (
            <span
              style={{
                background: isBuy ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)',
                padding: `${1 * zoom}px ${3 * zoom}px`,
                borderRadius: 3 * zoom,
              }}
            >
              {density.distancePercent.toFixed(2)}%
            </span>
          )}
          <span
            style={{
              background: 'rgba(139, 92, 246, 0.8)',
              padding: `${1 * zoom}px ${3 * zoom}px`,
              borderRadius: 3 * zoom,
            }}
          >
            {formatDissolutionTime(density.dissolutionTime)}
          </span>
        </div>
        
        <div
          style={{
            fontSize: Math.max(11, 13 * zoom),
            fontWeight: 700,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {formatAmount(density.amountUSD)}
        </div>
        
        <div
          style={{
            fontSize: Math.max(8, 9 * zoom),
            fontWeight: 500,
            opacity: 0.9,
            marginTop: 1 * zoom,
          }}
        >
          {density.symbol.replace('USDT', '')}
        </div>
        
        {showExchange && (
          <div
            style={{
              marginTop: 2 * zoom,
              opacity: 0.7,
              color: '#fbbf24',
            }}
          >
            <ExchangeLogo exchange={density.exchange} size={Math.max(10, 12 * zoom)} />
          </div>
        )}
      </div>
    </div>
  );
}
