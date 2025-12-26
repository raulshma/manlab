/**
 * ConfirmationModal component using React Aria for accessibility.
 * Provides a reusable confirmation dialog with proper focus management.
 */

import {
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
  Heading,
  Button,
} from 'react-aria-components';
import { type ReactNode, useState } from 'react';

interface ConfirmationModalProps {
  /** The trigger element that opens the modal */
  trigger: ReactNode;
  /** Title of the confirmation dialog */
  title: string;
  /** Message/description in the dialog */
  message: string;
  /** Text for the confirm button */
  confirmText?: string;
  /** Text for the cancel button */
  cancelText?: string;
  /** Whether the action is destructive (shows red confirm button) */
  isDestructive?: boolean;
  /** Whether the confirm action is in progress */
  isLoading?: boolean;
  /** Callback when user confirms */
  onConfirm: () => void | Promise<void>;
}

/**
 * ConfirmationModal provides an accessible modal dialog for confirming actions.
 */
export function ConfirmationModal({
  trigger,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDestructive = false,
  isLoading = false,
  onConfirm,
}: ConfirmationModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm();
      setIsOpen(false);
    } finally {
      setIsConfirming(false);
    }
  };

  const loading = isLoading || isConfirming;

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      {trigger}
      <ModalOverlay
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm
                   data-entering:animate-[fadeIn_200ms] data-exiting:animate-[fadeOut_150ms]"
      >
        <Modal
          className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl
                     p-6 m-4 outline-none
                     data-entering:animate-[zoomIn_200ms] data-exiting:animate-[zoomOut_150ms]"
        >
          <Dialog className="outline-none">
            {({ close }) => (
              <>
                <Heading
                  slot="title"
                  className="text-lg font-semibold text-white mb-2"
                >
                  {title}
                </Heading>
                
                <p className="text-slate-300 text-sm mb-6">
                  {message}
                </p>
                
                <div className="flex justify-end gap-3">
                  <Button
                    onPress={close}
                    isDisabled={loading}
                    className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50
                             hover:bg-slate-700 rounded-lg transition-colors cursor-pointer
                             focus:outline-none focus:ring-2 focus:ring-slate-500
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cancelText}
                  </Button>
                  <Button
                    onPress={handleConfirm}
                    isDisabled={loading}
                    className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors cursor-pointer
                              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800
                              disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2
                              ${isDestructive
                                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                              }`}
                  >
                    {loading && (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    {confirmText}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
