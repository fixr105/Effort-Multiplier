import { Plug, Check, Loader2 } from 'lucide-react';
import type { Integration } from '@/types';
import { CATEGORY_LABELS } from '@/data/integrations';
import { AppIcon } from './AppIcon';

type CardStatus = 'connected' | 'not_connected' | 'coming_soon' | 'setup_required';

interface IntegrationCardProps {
  integration: Integration;
  connected: boolean;
  onConnect: (integration: Integration) => void;
  onDisconnect: (integration: Integration) => void;
  detail?: string;
  connectHref?: string;
  connectDisabled?: boolean;
  onPreview?: () => void;
  previewDisabled?: boolean;
  status?: CardStatus;
  statusNote?: string;
}

export function IntegrationCard({
  integration,
  connected,
  onConnect,
  onDisconnect,
  detail,
  connectHref,
  connectDisabled = false,
  onPreview,
  previewDisabled = false,
  status,
  statusNote,
}: IntegrationCardProps) {
  const detailText = detail ?? (connected ? 'Connected' : 'Ready to connect');
  const badge = status ?? (connected ? 'connected' : 'not_connected');
  const badgeLabel = {
    connected: 'Connected',
    not_connected: 'Not connected',
    coming_soon: 'Coming soon',
    setup_required: 'Setup required',
  }[badge];
  const badgeClass = {
    connected: 'bg-emerald-50 text-emerald-700',
    not_connected: 'bg-gray-50 text-gray-500',
    coming_soon: 'bg-amber-50 text-amber-800',
    setup_required: 'bg-sky-50 text-sky-800',
  }[badge];
  const dotClass = {
    connected: 'bg-emerald-500',
    not_connected: 'bg-gray-300',
    coming_soon: 'bg-amber-500',
    setup_required: 'bg-sky-500',
  }[badge];
  return (
    <div className="group bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 hover:border-gray-300 hover:shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
      <div className="flex items-start gap-3.5">
        <AppIcon integration={integration} size="md" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {integration.name}
          </h3>
          <span className="inline-block mt-1 text-[11px] font-medium text-gray-400 uppercase tracking-wide">
            {CATEGORY_LABELS[integration.category]}
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium shrink-0 ${badgeClass}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
          {badgeLabel}
        </div>
      </div>

      <p className="text-sm text-gray-500 leading-relaxed">
        {integration.description}
      </p>

      <div className="flex items-center justify-between gap-3 mt-auto pt-2">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 min-w-0">
          <Plug size={12} className="shrink-0" />
          <span className="truncate">{detailText}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {connected && onPreview ? (
            <button
              onClick={onPreview}
              disabled={previewDisabled}
              aria-label={`Preview data from ${integration.name}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 transition-all duration-200 disabled:opacity-50"
            >
              Preview data
            </button>
          ) : null}
          {connected ? (
            <button
              onClick={() => onDisconnect(integration)}
              aria-label={`Disconnect ${integration.name}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-all duration-200"
            >
              Disconnect
            </button>
          ) : badge === 'coming_soon' || badge === 'setup_required' ? (
            <button
              type="button"
              disabled
              title={statusNote}
              aria-label={`${badgeLabel} for ${integration.name}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-gray-700 bg-white border border-gray-200 cursor-not-allowed"
            >
              {badgeLabel}
            </button>
          ) : connectHref ? (
            <a
              href={connectDisabled ? undefined : connectHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={connectDisabled}
              aria-label={`Connect ${integration.name}`}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 transition-all duration-200 shadow-sm ${
                connectDisabled ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              <Check size={13} />
              Connect
            </a>
          ) : (
            <button
              onClick={() => onConnect(integration)}
              disabled={connectDisabled}
              aria-label={`Connect ${integration.name}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800 transition-all duration-200 shadow-sm disabled:opacity-50"
            >
              <Check size={13} />
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function IntegrationCardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-4 animate-pulse">
      <div className="flex items-start gap-3.5">
        <div className="w-12 h-12 rounded-xl bg-gray-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-100 rounded w-2/3" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      <div className="h-3 bg-gray-100 rounded w-full" />
      <div className="h-8 bg-gray-100 rounded-lg w-24 mt-auto" />
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="animate-spin text-gray-300" size={32} />
    </div>
  );
}
