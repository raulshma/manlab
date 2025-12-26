'use client';
import {
  ProgressBar as AriaProgressBar,
  type ProgressBarProps as AriaProgressBarProps
} from 'react-aria-components';
import {Label} from '@/components/ui/Form';
import './ProgressBar.css';

export interface ProgressBarProps extends AriaProgressBarProps {
  label?: string;
}

export function ProgressBar({ label, ...props }: ProgressBarProps) {
  return (
    (
      <AriaProgressBar {...props}>
        {({ percentage, valueText, isIndeterminate }) => (
          <>
            <Label>{label}</Label>
            <span className="value">{valueText}</span>
            <div className="track inset">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any*/}
              <div className="fill" style={{ '--percent': (isIndeterminate ? 100 : percentage) + '%' } as any} />
            </div>
          </>
        )}
      </AriaProgressBar>
    )
  );
}
