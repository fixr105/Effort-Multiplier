import { Link2, CheckCircle2, Settings2 } from 'lucide-react';
import type { Integration } from '@/types';

interface IntroSectionProps {
  totalIntegrations: number;
  connectedCount: number;
}

export function IntroSection({ totalIntegrations, connectedCount }: IntroSectionProps) {
  const allConnected = connectedCount === totalIntegrations;

  return (
    <section className="pt-10 pb-6">
      <div className="flex flex-col gap-6">
        {/* Heading */}
        <div className="flex flex-col gap-3 max-w-2xl">
          <div className="flex items-center gap-2 text-xs font-medium text-blue-600">
            <Link2 size={14} />
            <span>Integrations</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 tracking-tight">
            Connect your business tools
          </h1>
          <p className="text-sm sm:text-base text-gray-500 leading-relaxed">
            Connect the apps you already use. Your AI Executive Assistant will use
            the data you authorize to help you understand and run your business.
          </p>
        </div>

        {/* Status summary */}
        <div className="flex flex-wrap gap-3">
          <StatusCard
            icon={<CheckCircle2 size={16} />}
            label="Connected"
            value={connectedCount.toString()}
            accent={connectedCount > 0 ? 'emerald' : 'gray'}
          />
          <StatusCard
            icon={<Link2 size={16} />}
            label="Available"
            value={`${totalIntegrations} integrations`}
            accent="blue"
          />
          <StatusCard
            icon={<Settings2 size={16} />}
            label="Connection status"
            value={allConnected && connectedCount > 0 ? 'All connected' : connectedCount > 0 ? 'Partially configured' : 'Not configured'}
            accent={connectedCount > 0 ? 'emerald' : 'gray'}
          />
        </div>
      </div>
    </section>
  );
}

function StatusCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: 'emerald' | 'blue' | 'gray';
}) {
  const accentMap = {
    emerald: 'text-emerald-600 bg-emerald-50',
    blue: 'text-blue-600 bg-blue-50',
    gray: 'text-gray-400 bg-gray-50',
  };

  return (
    <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 min-w-[160px]">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accentMap[accent]}`}>
        {icon}
      </div>
      <div className="flex flex-col">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
          {label}
        </span>
        <span className="text-sm font-semibold text-gray-900">{value}</span>
      </div>
    </div>
  );
}
