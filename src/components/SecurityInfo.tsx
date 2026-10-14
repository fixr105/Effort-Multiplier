import { ShieldCheck, Lock, Zap } from 'lucide-react';

export function SecurityInfo() {
  return (
    <section className="mt-12 pb-12">
      <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-2xl p-6 sm:p-8">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Your data. Your permission.
          </h2>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed max-w-2xl">
          Each integration requests only the read permission it needs. A connection
          belongs to this browser session. Effort Multiplier does not have founder
          accounts yet, so this is not multi-founder isolation. You can disconnect
          a product at any time.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 mt-6">
          <FeatureBadge
            icon={<Lock size={14} />}
            title="Read access first"
            description="Data access starts as read-only. Your assistant observes before it acts."
          />
          <FeatureBadge
            icon={<Zap size={14} />}
            title="Actions are separate"
            description="Permission to take actions will be granted explicitly, step by step."
          />
        </div>
      </div>
    </section>
  );
}

function FeatureBadge({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 flex-1 bg-white border border-gray-100 rounded-xl p-4">
      <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
