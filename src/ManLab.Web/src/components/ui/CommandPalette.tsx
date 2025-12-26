'use client';
import {
  Autocomplete as AriaAutocomplete,
  AutocompleteProps as AriaAutocompleteProps,
  MenuProps as AriaMenuProps,
  useFilter,
  Dialog
} from 'react-aria-components';
import {Menu} from '@/components/ui/Menu';
import {SearchField} from '@/components/ui/SearchField';
import { Modal } from '@/components/ui/Modal';
import { useEffect } from 'react';
import './CommandPalette.css';

export interface CommandPaletteProps<T extends object> extends Omit<AriaAutocompleteProps, 'children'>, AriaMenuProps<T> {
  isOpen: boolean,
  onOpenChange: (isOpen?: boolean) => void
}

export function CommandPalette<T extends object>(props: CommandPaletteProps<T>) {
  const {isOpen, onOpenChange} = props;
  const {contains} = useFilter({sensitivity: 'base'});

  useEffect(() => {
    const isMacUA = /mac(os|intosh)/i.test(navigator.userAgent);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'j' && (isMacUA ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onOpenChange]);

  return (
    <Modal isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
      <Dialog className="command-palette-dialog">
        <AriaAutocomplete filter={contains} {...props}>
          <SearchField
            autoFocus
            aria-label="Search commands"
            placeholder="Search commands" />
          <Menu
            {...props}
            renderEmptyState={() => 'No results found.'} />
        </AriaAutocomplete>
      </Dialog>
    </Modal>
  );
}
