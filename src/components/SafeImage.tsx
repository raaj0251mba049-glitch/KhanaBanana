import { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

interface SafeImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}

export function SafeImage({ src, alt, className = '', fallbackTitle }: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#F3EFE6] via-[#E8E2D4] to-[#DCE4DF] text-[#1B4D3E] p-4 text-center ${className}`}
        role="img"
        aria-label={alt}
      >
        <UtensilsCrossed className="w-7 h-7 opacity-70 mb-1.5" />
        {fallbackTitle && (
          <span className="text-xs font-medium text-[#1A2421]/80 line-clamp-2">{fallbackTitle}</span>
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
