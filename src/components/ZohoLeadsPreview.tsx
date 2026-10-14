import { X } from 'lucide-react';
import type { ZohoOrganization, ZohoPreviewSection } from '@/zohoApi';

interface ZohoLeadsPreviewProps {
  title: string;
  apiDomain: string | null;
  sections: ZohoPreviewSection[];
  organizations: ZohoOrganization[];
  needsOrganization: boolean;
  loading: boolean;
  error: string | null;
  reconnectHref: string;
  onChooseOrganization: (organizationId: string) => void;
  onClose: () => void;
}

export function ZohoLeadsPreview({
  title,
  apiDomain,
  sections,
  organizations,
  needsOrganization,
  loading,
  error,
  reconnectHref,
  onChooseOrganization,
  onClose,
}: ZohoLeadsPreviewProps) {
  const empty = sections.every((section) => section.records.length === 0);
  return (
    <section className="mb-6 bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-400 mt-1">
            {apiDomain
              ? `Live records from ${apiDomain}`
              : 'Live records from the Zoho API domain for this account'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
          aria-label="Close Zoho preview"
        >
          <X size={16} />
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading Zoho records...</p>
      ) : error ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-rose-700">{error}</p>
          <a
            href={reconnectHref}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800"
          >
            Reconnect
          </a>
        </div>
      ) : needsOrganization ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">Choose the Zoho organization to preview.</p>
          <div className="flex flex-wrap gap-2">
            {organizations.map((organization) => (
              <button
                key={organization.id}
                onClick={() => onChooseOrganization(organization.id)}
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-gray-800 bg-white border border-gray-200 hover:bg-gray-50"
              >
                {organization.name}
              </button>
            ))}
          </div>
        </div>
      ) : empty ? (
        <p className="text-sm text-gray-500">
          Zoho returned no records for this account. The connection is active.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">{section.title}</h3>
              {section.records.length === 0 ? (
                <p className="text-sm text-gray-500">No records returned.</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                  {section.records.map((record) => (
                    <li key={record.id} className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900 truncate">{record.title}</p>
                      {record.detail ? (
                        <p className="text-xs text-gray-500 truncate">{record.detail}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
