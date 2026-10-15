import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Integration, ConnectionState } from '@/types';
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
import { googleProductIdFromCard, type GoogleCatalogProduct } from '@/googleApi';
import { microsoftProductIdFromCard, type MicrosoftCatalogProduct } from '@/microsoftApi';
import { useZohoConnection } from '@/useZohoConnection';
import { useGoogleConnection } from '@/useGoogleConnection';
import { useMicrosoftConnection } from '@/useMicrosoftConnection';

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

function microsoftCard(product: MicrosoftCatalogProduct): Integration {
  return {
    id: product.cardId,
    name: product.name,
    description: product.description,
    category: product.category,
    color: '#0078d4',
    initials: product.initials,
    icon: product.icon,
  };
}

function googleCard(product: GoogleCatalogProduct): Integration {
  return {
    id: product.cardId,
    name: product.name,
    description: product.description,
    category: product.category,
    color: '#4285f4',
    initials: product.initials,
    icon: product.icon,
  };
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'available'>('all');
  const [connectTarget, setConnectTarget] = useState<Integration | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const zoho = useZohoConnection();
  const google = useGoogleConnection();
  const microsoft = useMicrosoftConnection();
  const disconnectZohoConnection = zoho.disconnect;
  const disconnectGoogleConnection = google.disconnect;
  const disconnectMicrosoftConnection = microsoft.disconnect;

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
    if (isZohoCardId(integration.id) || googleProductIdFromCard(integration.id) || microsoftProductIdFromCard(integration.id)) return;
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
      const googleProductId = googleProductIdFromCard(integration.id);
      if (googleProductId) {
        await disconnectGoogleConnection(googleProductId);
        setDisconnectTarget(null);
        return;
      }
      const microsoftProductId = microsoftProductIdFromCard(integration.id);
      if (microsoftProductId) {
        await disconnectMicrosoftConnection(microsoftProductId);
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
    [disconnectZohoConnection, disconnectGoogleConnection, disconnectMicrosoftConnection],
  );

  const zohoIntegrations = useMemo(
    () => zoho.products.map(zohoCard),
    [zoho.products],
  );
  const googleIntegrations = useMemo(
    () => google.products.map(googleCard),
    [google.products],
  );
  const microsoftIntegrations = useMemo(
    () => microsoft.products.map(microsoftCard),
    [microsoft.products],
  );

  const visibleIntegrations = useMemo(
    () => [...zohoIntegrations, ...googleIntegrations, ...microsoftIntegrations],
    [zohoIntegrations, googleIntegrations, microsoftIntegrations],
  );

  const displayConnections = useMemo(() => {
    const next = { ...connections };
    for (const product of zoho.products) {
      if (product.connected) next[product.cardId] = true;
      else delete next[product.cardId];
    }
    for (const product of google.products) {
      if (product.connected) next[product.cardId] = true;
      else delete next[product.cardId];
    }
    for (const product of microsoft.products) {
      if (product.connected) next[product.cardId] = true;
      else delete next[product.cardId];
    }
    return next;
  }, [connections, zoho.products, google.products, microsoft.products]);

  const filteredIntegrations = useMemo(() => {
    return visibleIntegrations.filter((integration) => {
      const product = zoho.products.find((item) => item.cardId === integration.id);
      const googleProduct = google.products.find((item) => item.cardId === integration.id);
      const microsoftProduct = microsoft.products.find((item) => item.cardId === integration.id);
      const matchesCategory =
        activeFilter === 'all' || integration.category === activeFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'connected' && !!displayConnections[integration.id]) ||
        (statusFilter === 'available' && (
          (product?.availability === 'available' && !product.connected)
          || (googleProduct?.connectable === true && !googleProduct.connected)
          || (microsoftProduct?.connectable === true && !microsoftProduct.connected)
        ));
      const matchesSearch =
        search === '' ||
        integration.name.toLowerCase().includes(search.toLowerCase()) ||
        integration.description.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [visibleIntegrations, search, activeFilter, statusFilter, zoho.products, google.products, microsoft.products, displayConnections]);

  const connectedIntegrations = useMemo(
    () => [...zohoIntegrations, ...googleIntegrations, ...microsoftIntegrations].filter((integration) => displayConnections[integration.id]),
    [displayConnections, zohoIntegrations, googleIntegrations, microsoftIntegrations],
  );

  const connectedCount = connectedIntegrations.length;

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900">
      <Header />

      <main className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8">
        <IntroSection
          totalIntegrations={zohoIntegrations.length + googleIntegrations.length + microsoftIntegrations.length}
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
            <div className="flex flex-wrap gap-2 mb-3">
              {(
                [
                  ['all', 'All'],
                  ['connected', 'Connected'],
                  ['available', 'Available'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setStatusFilter(id)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium border ${
                    statusFilter === id
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              ))}
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

        {google.banner ? (
          <div
            className={`mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              google.bannerTone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <p className="text-sm">{google.banner}</p>
            {google.showReconnect && google.reconnectProduct ? (
              <a
                href={`/api/integrations/google/${google.reconnectProduct}/connect`}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start px-3.5 py-2 rounded-lg text-xs font-medium text-white bg-gray-900 hover:bg-gray-800"
              >
                Reconnect
              </a>
            ) : null}
          </div>
        ) : null}

        {microsoft.banner ? (
          <div
            className={`mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
              microsoft.bannerTone === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <p className="text-sm">{microsoft.banner}</p>
            {microsoft.showReconnect && microsoft.reconnectProduct ? (
              <a
                href={`/api/integrations/microsoft/${microsoft.reconnectProduct}/connect`}
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
              : `${filteredIntegrations.length} ${filteredIntegrations.length === 1 ? 'integration' : 'integrations'}${activeFilter !== 'all' || statusFilter !== 'all' || search ? ' found' : ' available'}`}
          </p>
        </div>

        {google.previewOpen ? (
          <ZohoLeadsPreview
            title={google.previewTitle}
            apiDomain="Google"
            sections={google.sections}
            organizations={[]}
            needsOrganization={false}
            loading={google.loading}
            error={google.error}
            reconnectHref={`/api/integrations/google/${google.previewProductId ?? 'gmail'}/connect`}
            onChooseOrganization={() => undefined}
            onClose={google.closePreview}
          />
        ) : null}

        {microsoft.previewOpen ? (
          <ZohoLeadsPreview
            title={microsoft.previewTitle}
            apiDomain="Microsoft"
            sections={microsoft.sections}
            organizations={[]}
            needsOrganization={false}
            loading={microsoft.loading}
            error={microsoft.error}
            reconnectHref={`/api/integrations/microsoft/${microsoft.previewProductId ?? 'outlook-mail'}/connect`}
            onChooseOrganization={() => undefined}
            onClose={microsoft.closePreview}
          />
        ) : null}

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
              const googleProduct = google.products.find((item) => item.cardId === integration.id);
              const microsoftProduct = microsoft.products.find((item) => item.cardId === integration.id);
              const status = product
                ? product.connected
                  ? 'connected'
                  : 'not_connected'
                : googleProduct
                  ? googleProduct.connected ? 'connected' : 'not_connected'
                  : microsoftProduct
                    ? microsoftProduct.connected ? 'connected' : 'not_connected'
                    : undefined;
              return (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  connected={!!displayConnections[integration.id]}
                  status={status}
                  statusNote={product?.note}
                  detail={
                    googleProduct
                      ? google.checking
                        ? 'Checking Google connection...'
                        : googleProduct.connected
                          ? googleProduct.connectable
                            ? 'Live Google connection'
                            : 'Stored Google connection. New connections are unavailable.'
                          : 'Read-only Google connection'
                      : microsoftProduct
                        ? microsoft.checking
                          ? 'Checking Microsoft connection...'
                          : microsoftProduct.connected
                            ? microsoftProduct.connectable
                              ? 'Live Microsoft connection'
                              : 'Stored Microsoft connection. New connections are unavailable.'
                            : 'Read-only Microsoft connection'
                      : product
                        ? zoho.checking
                          ? 'Checking Zoho connection...'
                          : product.connected
                            ? 'Live Zoho connection'
                            : product.note
                        : undefined
                  }
                  connectHref={
                    googleProduct && status === 'not_connected' && googleProduct.connectable
                      ? `/api/integrations/google/${googleProduct.id}/connect`
                      : microsoftProduct && status === 'not_connected' && microsoftProduct.connectable
                        ? `/api/integrations/microsoft/${microsoftProduct.id}/connect`
                        : status === 'not_connected' && product?.availability === 'available'
                          ? `/api/integrations/zoho/${product.id}/connect`
                          : undefined
                  }
                  connectDisabled={Boolean((product && zoho.checking) || (googleProduct && google.checking) || (microsoftProduct && microsoft.checking))}
                  onPreview={
                    googleProduct?.connected
                      ? () => void google.preview(googleProduct.id, googleProduct.name)
                      : microsoftProduct?.connected
                        ? () => void microsoft.preview(microsoftProduct.id, microsoftProduct.name)
                        : product?.connected
                          ? () => void zoho.preview(product.id, product.name)
                          : undefined
                  }
                  previewDisabled={zoho.leadsLoading || google.loading || microsoft.loading}
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
        integration={connectTarget && (isZohoCardId(connectTarget.id) || googleProductIdFromCard(connectTarget.id) || microsoftProductIdFromCard(connectTarget.id)) ? null : connectTarget}
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
        </div>
      </footer>
    </div>
  );
}

export default App;
