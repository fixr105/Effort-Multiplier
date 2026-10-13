import { X } from 'lucide-react';
import { ZOHO_CONNECT_PATH, type ZohoLead } from '@/zohoApi';

interface ZohoLeadsPreviewProps {
  apiDomain: string | null;
  leads: ZohoLead[] | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export function ZohoLeadsPreview({
  apiDomain,
  leads,
  loading,
  error,
  onClose,
}: ZohoLeadsPreviewProps) {
  return (
    <section className="mb-6 bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Zoho CRM leads</h2>
          <p className="text-xs text-gray-400 mt-1">
            {apiDomain
              ? `Live records from ${apiDomain}`
              : 'Live records from the Zoho API domain for this account'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
          aria-label="Close lead preview"
        >
          <X size={16} />
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading leads...</p>
      ) : error ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-rose-700">{error}</p>
          <a
            href={ZOHO_CONNECT_PATH}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800"
          >
            Reconnect Zoho CRM
          </a>
        </div>
      ) : leads && leads.length === 0 ? (
        <p className="text-sm text-gray-500">
          No leads were returned for this Zoho account. The connection is active.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
          {leads?.map((lead) => {
            const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unnamed lead';
            return (
              <li key={lead.id} className="px-4 py-3 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {[lead.email, lead.company].filter(Boolean).join(' · ') || 'No email or company'}
                  </p>
                </div>
                {lead.status ? (
                  <span className="text-[11px] font-medium text-gray-500 sm:shrink-0">{lead.status}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
