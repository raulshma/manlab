'use client';
import {
  DateRangePicker as AriaDateRangePicker,
  DateRangePickerProps as AriaDateRangePickerProps,
  DateValue,
  Group,
  ValidationResult
} from 'react-aria-components';
import {DateInput, DateSegment} from '@/components/ui/DateField';
import {Description, FieldButton} from '@/components/ui/Form';
import {Popover} from '@/components/ui/Popover';
import {Label, FieldError} from '@/components/ui/Form';
import {RangeCalendar} from '@/components/ui/RangeCalendar';
import {ChevronDown} from 'lucide-react';
import './DateRangePicker.css';

export interface DateRangePickerProps<T extends DateValue>
  extends AriaDateRangePickerProps<T> {
  label?: string;
  description?: string;
  errorMessage?: string | ((validation: ValidationResult) => string);
}

export function DateRangePicker<T extends DateValue>(
  { label, description, errorMessage, ...props }: DateRangePickerProps<T>
) {
  return (
    <AriaDateRangePicker {...props}>
      <Label>{label}</Label>
      <Group className="react-aria-Group inset">
        <div className="date-fields">
          <DateInput slot="start">
            {(segment) => <DateSegment segment={segment} />}
          </DateInput>
          <span aria-hidden="true">–</span>
          <DateInput slot="end">
            {(segment) => <DateSegment segment={segment} />}
          </DateInput>
        </div>
        <FieldButton><ChevronDown /></FieldButton>
      </Group>
      {description && <Description>{description}</Description>}
      <FieldError>{errorMessage}</FieldError>
      <Popover hideArrow>
        <RangeCalendar />
      </Popover>
    </AriaDateRangePicker>
  );
}
