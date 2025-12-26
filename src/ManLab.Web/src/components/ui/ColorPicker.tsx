'use client';
import {
  Button,
  ColorPicker as AriaColorPicker,
  ColorPickerProps as AriaColorPickerProps
} from 'react-aria-components';
import {DialogTrigger} from '@/components/ui/Dialog';
import {ColorSwatch} from '@/components/ui/ColorSwatch';
import {ColorSlider} from '@/components/ui/ColorSlider';
import {ColorArea} from '@/components/ui/ColorArea';
import {ColorField} from '@/components/ui/ColorField';
import {Popover} from '@/components/ui/Popover';

import './ColorPicker.css';

export interface ColorPickerProps extends Omit<AriaColorPickerProps, 'children'> {
  label?: string;
  children?: React.ReactNode;
}

export function ColorPicker({ label, children, ...props }: ColorPickerProps) {
  return (
    (
      <AriaColorPicker {...props}>
        <DialogTrigger>
          <Button className="color-picker">
            <ColorSwatch />
            <span>{label}</span>
          </Button>
          <Popover hideArrow placement="bottom start" className="color-picker-dialog">
            {children || (
              <>
                <ColorArea
                  colorSpace="hsb"
                  xChannel="saturation"
                  yChannel="brightness"
                />
                <ColorSlider colorSpace="hsb" channel="hue" />
                <ColorField label="Hex" />
              </>
            )}
          </Popover>
        </DialogTrigger>
      </AriaColorPicker>
    )
  );
}
