'use client';

import { Toaster as HotToaster } from 'react-hot-toast';

export interface ToasterProps {
  position?:
    'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
}

/**
 * Mount this once in each portal's root layout.
 *
 * `react-hot-toast` only owns timing and stacking here — every toast renders our
 * `ToastCard`, so the width override keeps its wrapper from fighting the card's
 * own surface.
 */
export function Toaster({ position = 'bottom-right' }: ToasterProps) {
  return (
    <HotToaster
      position={position}
      gutter={10}
      toastOptions={{
        className: 'w-auto',
        style: { width: 'auto', maxWidth: '22rem' },
      }}
    />
  );
}
