import { useState } from 'react';
import { ShieldCheck, Zap, X, ArrowRight, Loader2 } from 'lucide-react';
import type { Integration } from '@/types';
import { CATEGORY_LABELS } from '@/data/integrations';
import { AppIcon } from './AppIcon';

interface ConnectModalProps {
  integration: Integration | null;
  onClose: () => void;
  onConfirm: (integration: Integration) => void;
}

export function ConnectModal({ integration, onClose, onConfirm }: ConnectModalProps) {
  const [connecting, setConnecting] = useState(false);

  if (!integration) return null;

  const handleSimulate = () => {
    setConnecting(true);
    setTimeout(() => {
      onConfirm(integration);
      setConnecting(false);
    }, 900);
  };

  const handleClose = () => {
    if (!connecting) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
            <Zap size={11} />
            Demo
          </div>
          <button
            onClick={handleClose}
            disabled={connecting}
            className="text-gray-400 hover:text-gray-600 transition-colors p-0.5 disabled:opacity-30"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex flex-col gap-4">
          <div className="flex items-center gap-3.5">
            <AppIcon integration={integration} size="lg" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Connect {integration.name}
              </h2>
              <span className="text-xs text-gray-400">
                {CATEGORY_LABELS[integration.category]}
              </span>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex gap-3">
            <ShieldCheck size={18} className="text-blue-500 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2 text-sm text-gray-600 leading-relaxed">
              <p>
                In the live product, you will be redirected to{' '}
                <span className="font-medium text-gray-900">{integration.name}</span>{' '}
                to sign in and authorize access to your business data.
              </p>
              <p className="text-xs text-gray-400">
                This demo simulates that flow. No real account is connected and no
                data is accessed.
              </p>
            </div>
          </div>

          <div className="text-xs text-gray-400 flex items-center gap-1.5">
            <div className="w-1 h-1 rounded-full bg-gray-300" />
            Read access and permission to take actions will be handled separately in
            the real implementation.
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={connecting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-30"
          >
            Cancel
          </button>
          <button
            onClick={handleSimulate}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 transition-all duration-200 shadow-sm disabled:opacity-70 min-w-[180px] justify-center"
          >
            {connecting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                Simulate connection
                <ArrowRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
