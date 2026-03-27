import Image from 'next/image';
import clsx from 'clsx';

interface BrandLogoProps {
  mode?: 'full' | 'icon';
  className?: string;
  priority?: boolean;
  muted?: boolean;
}

export function BrandLogo({ mode = 'full', className, priority, muted = false }: BrandLogoProps) {
  if (mode === 'icon') {
    return (
      <Image
        src="/brand/logo-icon.png"
        alt="Valiant"
        width={54}
        height={54}
        priority={priority}
        className={clsx('h-auto w-full', muted && 'opacity-65 saturate-75', className)}
      />
    );
  }

  return (
    <Image
      src="/brand/logo-full.webp"
      alt="Valiant Prospector"
      width={520}
      height={170}
      priority={priority}
      className={clsx('h-auto w-full', muted && 'opacity-65 saturate-75', className)}
    />
  );
}
