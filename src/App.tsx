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
import { isZohoCardId, zohoProductByCardId } from '@/data/zohoProducts';
import type { ZohoCatalogProduct } from '@/zohoApi';
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
  const next = { ...state };
  let changed = false;
  for (const id of Object.keys(next)) {
    if (isZohoCardId(id)) {
      delete next[id];
      changed = true;
    }
  }
  return changed ? next : state;
}

function zohoCard(product: ZohoCatalogProduct): Integration {
  return {
    id: product.cardId,
    name: product.name,
    description: product.description,
    category: product.category as Integration['category'],
    color: '#e42527',
    initials: product.initials,
    icon: product.icon,
  };
}

function App() {
  const [connections, setConnections] = useState<ConnectionState>({});
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [connectTarget, setConnectTarget] = useState<Integration | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState<'all' | 'zoho'>('zoho');
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
    if (isZohoCardId(integration.id)) return;
    setConnections((prev) => ({ ...prev, [integration.id]: true }));
    setConnectTarget(null);
  }, []);

  const handleConfirmDisconnect = useCallback(
    async (integration: Integration) => {
      const product = zohoProductByCardId(integration.id);
      if (product) {
        await disconnectZohoConnection(product.id);
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

  const zohoIntegrations = useMemo(
    () => zoho.products.map(zohoCard),
    [zoho.products],
  );

  const visibleIntegrations = library === 'zoho' ? zohoIntegrations : [...zohoIntegrations, ...INTEGRATIONS];

  const filteredIntegrations = useMemo(() => {
    return visibleIntegrations.filter((integration) => {
      const matchesFilter =
        activeFilter === 'all' || integration.category === activeFilter;
      const matchesSearch =
        search === '' ||
        integration.name.toLowerCase().includes(search.toLowerCase()) ||
        integration.description.toLowerCase().includes(search.toLowerCase());
      return matchesFilter && matchesSearch;
    });
  }, [visibleIntegrations, search, activeFilter]);

  const displayConnections = useMemo(() => {
    const next = { ...connections };
    for (const product of zoho.products) {
      if (product.connected) next[product.cardId] = true;
      else delete next[product.cardId];
    }
    return next;
  }, [connections, zoho.products]);

  const connectedIntegrations = useMemo(
    () => [...zohoIntegrations, ...INTEGRATIONS].filter((integration) => displayConnections[integration.id]),
    [displayConnections, zohoIntegrations],
  );

  const connectedCount = connectedIntegrations.length;

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900">
      <Header />

      <main className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8">
        <IntroSection
          totalIntegrations={zohoIntegrations.length + INTEGRATIONS.length}
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
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => setLibrary('zoho')}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium ${
                  library === 'zoho' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                Zoho products
              </button>
              <button
                onClick={() => setLibrary('all')}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium ${
                  library === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 border border-gray-200'
                }`}
              >
                All tools
              </button>
            </div>
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
                href={`/api/integrations/zoho/${zoho.reconnectProduct ?? 'crm'}/connect`}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800"
              >
                Reconnect
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
            title={zoho.previewTitle}
            apiDomain={zoho.apiDomain}
            sections={zoho.sections}
            organizations={zoho.organizations}
            needsOrganization={zoho.needsOrganization}
            loading={zoho.leadsLoading}
            error={zoho.leadsError}
            reconnectHref={`/api/integrations/zoho/${zoho.previewProductId ?? 'crm'}/connect`}
            onChooseOrganization={(organizationId) => void zoho.chooseOrganization(organizationId)}
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
              const product = zoho.products.find((item) => item.cardId === integration.id);
              const live = product?.availability === 'available';
              const blocked = product && product.availability !== 'available';
              return (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  connected={!!displayConnections[integration.id]}
                  detail={
                    product
                      ? zoho.checking
                        ? 'Checking Zoho connection...'
                        : product.connected
                          ? 'Live Zoho connection'
                          : product.availability === 'available'
                            ? 'Signs in with Zoho'
                            : product.note
                      : undefined
                  }
                  connectHref={live && !product.connected ? `/api/integrations/zoho/${product.id}/connect` : undefined}
                  connectDisabled={Boolean(product && (zoho.checking || blocked))}
                  onPreview={product?.connected ? () => void zoho.preview(product.id, product.name) : undefined}
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
        integration={connectTarget && isZohoCardId(connectTarget.id) ? null : connectTarget}
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
