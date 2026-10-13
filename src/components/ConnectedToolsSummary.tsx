import { Plug, X } from 'lucide-react';
import type { Integration } from '@/types';
import { AppIcon } from './AppIcon';

interface ConnectedToolsSummaryProps {
  connectedIntegrations: Integration[];
  onDisconnect: (integration: Integration) => void;
}

export function ConnectedToolsSummary({
  connectedIntegrations,
  onDisconnect,
}: ConnectedToolsSummaryProps) {
  if (connectedIntegrations.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center shrink-0">
          <Plug size={18} className="text-gray-300" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700">
            No tools connected yet
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Connect your first application to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">
          Connected tools
          <span className="ml-2 text-xs font-normal text-gray-400">
            {connectedIntegrations.length} {connectedIntegrations.length === 1 ? 'app' : 'apps'}
          </span>
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {connectedIntegrations.map((integration) => (
          <div
            key={integration.id}
            className="group flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full pl-2 pr-1 py-1 hover:border-gray-300 transition-all duration-200"
          >
            <AppIcon integration={integration} size="sm" />
            <span className="text-xs font-medium text-gray-700 pr-1">
              {integration.name}
            </span>
            <button
              onClick={() => onDisconnect(integration)}
              className="w-5 h-5 rounded-full flex items-center justify-center text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all duration-200 opacity-0 group-hover:opacity-100"
              aria-label={`Disconnect ${integration.name}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
