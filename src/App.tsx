import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Integration, ConnectionState } from '@/types';
import { INTEGRATIONS } from '@/data/integrations';
import { Header } from '@/components/Header';
import { IntroSection } from '@/components/IntroSection';
import { ConnectedToolsSummary } from '@/components/ConnectedToolsSummary';
import { SearchBar } from '@/components/SearchBar';
import { CategoryFilters } from '@/components/CategoryFilters';
import { IntegrationCard, IntegrationCardSkeleton } from '@/components/IntegrationCard';
import { ConnectModal } from '@/components/ConnectModal';
import { DisconnectDialog } from '@/components/DisconnectDialog';
import { SecurityInfo } from '@/components/SecurityInfo';
import { NoResults } from '@/components/NoResults';
import { ZohoLeadsPreview } from '@/components/ZohoLeadsPreview';
import { ZOHO_CONNECT_PATH, ZOHO_INTEGRATION_ID } from '@/zohoApi';
import { useZohoConnection } from '@/useZohoConnection';

const STORAGE_KEY = 'em_connection_state';

function loadConnectionState(): ConnectionState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as ConnectionState;
  } catch {
    /* ignore */
  }
  return {};
}

function withoutZoho(state: ConnectionState): ConnectionState {
  if (!state[ZOHO_INTEGRATION_ID]) return state;
  const next = { ...state };
  delete next[ZOHO_INTEGRATION_ID];
  return next;
}

function App() {
  const [connections, setConnections] = useState<ConnectionState>({});
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [connectTarget, setConnectTarget] = useState<Integration | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const zoho = useZohoConnection();
  const disconnectZohoConnection = zoho.disconnect;

  useEffect(() => {
    const demoConnections = withoutZoho(loadConnectionState());
    setConnections(demoConnections);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(demoConnections));
    } catch {
      /* ignore */
    }
    setHydrated(true);
    const timer = setTimeout(() => setLoading(false), 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutZoho(connections)));
    } catch {
      /* ignore */
    }
  }, [connections, hydrated]);

  const handleConfirmConnect = useCallback((integration: Integration) => {
    if (integration.id === ZOHO_INTEGRATION_ID) return;
    setConnections((prev) => ({ ...prev, [integration.id]: true }));
    setConnectTarget(null);
  }, []);

  const handleConfirmDisconnect = useCallback(
    async (integration: Integration) => {
      if (integration.id === ZOHO_INTEGRATION_ID) {
        await disconnectZohoConnection();
        setDisconnectTarget(null);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
      setConnections((prev) => {
        const next = { ...prev };
        delete next[integration.id];
        return next;
      });
      setDisconnectTarget(null);
    },
    [disconnectZohoConnection],
  );

  const filteredIntegrations = useMemo(() => {
    return INTEGRATIONS.filter((integration) => {
      const matchesFilter =
        activeFilter === 'all' || integration.category === activeFilter;
      const matchesSearch =
        search === '' ||
        integration.name.toLowerCase().includes(search.toLowerCase()) ||
        integration.description.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [search, activeFilter]);

  const displayConnections = useMemo(() => {
    const next = { ...connections };
    delete next[ZOHO_INTEGRATION_ID];
    if (zoho.connected) next[ZOHO_INTEGRATION_ID] = true;
    return next;
  }, [connections, zoho.connected]);

  const connectedIntegrations = useMemo(
    () => INTEGRATIONS.filter((integration) => displayConnections[integration.id]),
    [displayConnections],
  );

  const connectedCount = connectedIntegrations.length;

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900">
      <Header />

      <main className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8">
        <IntroSection
          totalIntegrations={INTEGRATIONS.length}
          connectedCount={connectedCount}
        />

        <div className="mb-6">
          <ConnectedToolsSummary
            connectedIntegrations={connectedIntegrations}
            onDisconnect={setDisconnectTarget}
          />
        </div>

        <div className="flex flex-col gap-4 mb-6">
          <SearchBar value={search} onChange={setSearch} />
          <div className="chip-scroll overflow-x-auto sm:overflow-visible -mx-5 px-5 sm:mx-0 sm:px-0">
            <CategoryFilters
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
            />
          </div>
        </div>

        {zoho.banner ? (
          <div
            className={`mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              zoho.bannerTone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <p className="text-sm">{zoho.banner}</p>
            {zoho.showReconnect ? (
              <a
                href={ZOHO_CONNECT_PATH}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800"
              >
                Reconnect Zoho CRM
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-gray-400">
            {loading
              ? 'Loading integrations...'
              : `${filteredIntegrations.length} ${filteredIntegrations.length === 1 ? 'integration' : 'integrations'}${activeFilter !== 'all' || search ? ' found' : ' available'}`}
          </p>
        </div>

        {zoho.previewOpen ? (
          <ZohoLeadsPreview
            apiDomain={zoho.apiDomain}
            leads={zoho.leads}
            loading={zoho.leadsLoading}
            error={zoho.leadsError}
            onClose={zoho.closePreview}
          />
        ) : null}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <IntegrationCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredIntegrations.length === 0 ? (
          <NoResults query={search} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredIntegrations.map((integration) => {
              const isZoho = integration.id === ZOHO_INTEGRATION_ID;
              return (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  connected={!!displayConnections[integration.id]}
                  detail={
                    isZoho
                      ? zoho.checking
                        ? 'Checking Zoho connection...'
                        : zoho.connected
                          ? 'Live Zoho CRM connection'
                          : 'Signs in with Zoho'
                      : undefined
                  }
                  connectHref={isZoho ? ZOHO_CONNECT_PATH : undefined}
                  connectDisabled={isZoho && zoho.checking}
                  onPreview={isZoho && zoho.connected ? () => void zoho.preview() : undefined}
                  previewDisabled={zoho.leadsLoading}
                  onConnect={setConnectTarget}
                  onDisconnect={setDisconnectTarget}
                />
              );
            })}
          </div>
        )}

        <SecurityInfo />
      </main>

      <ConnectModal
        integration={connectTarget?.id === ZOHO_INTEGRATION_ID ? null : connectTarget}
        onClose={() => setConnectTarget(null)}
        onConfirm={handleConfirmConnect}
      />
      <DisconnectDialog
        integration={disconnectTarget}
        onClose={() => setDisconnectTarget(null)}
        onConfirm={handleConfirmDisconnect}
      />

      <footer className="border-t border-gray-100 py-6">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-gray-400">
          <span>Effort Multiplier &middot; A 5x Club product</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Other integrations are demo connections
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
