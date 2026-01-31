/**
 * useConfirm Hook
 * Provides imperative confirmation dialog functionality using AlertDialog
 * Replaces browser's native confirm() and alert() with custom styled dialogs
 */

import { useCallback, useRef, useState } from "react";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface AlertOptions {
  title: string;
  description?: string;
  confirmText?: string;
}

interface ConfirmState extends ConfirmOptions {
  isOpen: boolean;
}

interface AlertState extends AlertOptions {
  isOpen: boolean;
}

export function useConfirm() {
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    title: "",
  });

  const [alertState, setAlertState] = useState<AlertState>({
    isOpen: false,
    title: "",
  });

  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);
  const alertResolveRef = useRef<(() => void) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        confirmResolveRef.current = resolve;
        setConfirmState({
          ...options,
          isOpen: true,
        });
      });
    },
    []
  );

  const alert = useCallback(
    (options: AlertOptions): Promise<void> => {
      return new Promise((resolve) => {
        alertResolveRef.current = resolve;
        setAlertState({
          ...options,
          isOpen: true,
        });
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    if (confirmResolveRef.current) {
      confirmResolveRef.current(true);
      confirmResolveRef.current = null;
    }
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleCancel = useCallback(() => {
    if (confirmResolveRef.current) {
      confirmResolveRef.current(false);
      confirmResolveRef.current = null;
    }
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleAlertConfirm = useCallback(() => {
    if (alertResolveRef.current) {
      alertResolveRef.current();
      alertResolveRef.current = null;
    }
    setAlertState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  return {
    confirm,
    alert,
    confirmState,
    alertState,
    handleConfirm,
    handleCancel,
    handleAlertConfirm,
  };
}
