'use client';
import {
  ColorWheel as AriaColorWheel,
  type ColorWheelProps as AriaColorWheelProps,
  ColorWheelTrack
} from 'react-aria-components';

import {ColorThumb} from '@/components/ui/ColorThumb';

import './ColorWheel.css';
export type ColorWheelProps = Omit<AriaColorWheelProps, 'outerRadius' | 'innerRadius'>

export function ColorWheel(props: ColorWheelProps) {
  return (
    (
      <AriaColorWheel {...props} outerRadius={100} innerRadius={74}>
        <ColorWheelTrack />
        <ColorThumb />
      </AriaColorWheel>
    )
  );
}
