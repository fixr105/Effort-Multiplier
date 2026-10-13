import { useEffect, useState } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import type { Integration } from '@/types';
import { AppIcon } from './AppIcon';

interface DisconnectDialogProps {
  integration: Integration | null;
  onClose: () => void;
  onConfirm: (integration: Integration) => void | Promise<void>;
}

export function DisconnectDialog({
  integration,
  onClose,
  onConfirm,
}: DisconnectDialogProps) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisconnecting(false);
    setError(null);
  }, [integration?.id]);

  if (!integration) return null;

  const handleConfirm = () => {
    setDisconnecting(true);
    setError(null);
    void Promise.resolve(onConfirm(integration))
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Disconnect failed.');
      })
      .finally(() => {
        setDisconnecting(false);
      });
  };

  const handleClose = () => {
    if (!disconnecting) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col overflow-hidden animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2 text-rose-600">
            <AlertTriangle size={18} />
            <span className="text-sm font-semibold">Disconnect app</span>
          </div>
          <button
            onClick={handleClose}
            disabled={disconnecting}
            className="text-gray-400 hover:text-gray-600 transition-colors p-0.5 disabled:opacity-30"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl p-3">
            <AppIcon integration={integration} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {integration.name}
              </p>
              <p className="text-xs text-emerald-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Currently connected
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-600 leading-relaxed">
            Are you sure you want to disconnect{' '}
            <span className="font-medium text-gray-900">{integration.name}</span>?
            Your AI Executive Assistant will no longer have access to data from this
            app.
          </p>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={disconnecting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-30"
          >
            Keep connected
          </button>
          <button
            onClick={handleConfirm}
            disabled={disconnecting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-500 transition-all duration-200 shadow-sm disabled:opacity-70 min-w-[140px] justify-center"
          >
            {disconnecting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Disconnecting...
              </>
            ) : (
              'Disconnect'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
