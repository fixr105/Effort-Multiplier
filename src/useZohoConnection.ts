import { useCallback, useEffect, useState } from 'react';
import { ZOHO_PRODUCTS } from '@/data/zohoProducts';
import {
  consumeZohoReturn,
  disconnectZoho,
  fetchZohoCatalog,
  fetchZohoPreview,
  selectZohoOrganization,
  zohoReturnMessage,
  ZohoClientError,
  type ZohoCatalogProduct,
  type ZohoOrganization,
  type ZohoPreviewSection,
} from '@/zohoApi';

function fallbackCatalog(): ZohoCatalogProduct[] {
  return ZOHO_PRODUCTS.map((product) => ({
    id: product.id,
    cardId: product.cardId,
    name: product.name,
    description: product.description,
    category: product.category,
    initials: product.initials,
    icon: product.icon,
    availability: product.availability,
    docsUrl: product.docsUrl,
    note: product.note,
    connected: false,
    apiDomain: null,
    organizationId: null,
  }));
}

export function useZohoConnection() {
  const [checking, setChecking] = useState(true);
  const [products, setProducts] = useState<ZohoCatalogProduct[]>(fallbackCatalog);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<'success' | 'error'>('success');
  const [showReconnect, setShowReconnect] = useState(false);
  const [reconnectProduct, setReconnectProduct] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('Zoho');
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [sections, setSections] = useState<ZohoPreviewSection[]>([]);
  const [organizations, setOrganizations] = useState<ZohoOrganization[]>([]);
  const [needsOrganization, setNeedsOrganization] = useState(false);
  const [apiDomain, setApiDomain] = useState<string | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const catalog = await fetchZohoCatalog();
    setProducts(catalog);
    setChecking(false);
    return catalog;
  }, []);

  useEffect(() => {
    const returned = consumeZohoReturn();
    let cancelled = false;
    void load()
      .then((catalog) => {
        if (cancelled || returned.type === 'none') return;
        const product = returned.type === 'connected'
          ? catalog.find((item) => item.id === returned.product)
          : null;
        if (returned.type === 'connected' && product?.connected) {
          setBanner(`${product.name} is connected.`);
          setBannerTone('success');
          setShowReconnect(false);
        } else if (returned.type === 'connected') {
          setBanner('Zoho did not confirm the connection. It was not marked connected.');
          setBannerTone('error');
          setShowReconnect(true);
          setReconnectProduct(returned.product);
        } else if (returned.type === 'error') {
          setBanner(zohoReturnMessage(returned.reason));
          setBannerTone('error');
          setShowReconnect(returned.reason !== 'access_denied');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setChecking(false);
        if (returned.type === 'none') return;
        setBanner('The Zoho server did not respond, so the account was not marked connected.');
        setBannerTone('error');
        setShowReconnect(true);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const refreshOnFocus = () => {
      void load().catch(() => undefined);
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [load]);

  const preview = useCallback(async (productId: string, name: string) => {
    setPreviewOpen(true);
    setPreviewTitle(name);
    setPreviewProductId(productId);
    setLeadsLoading(true);
    setLeadsError(null);
    setSections([]);
    setOrganizations([]);
    setNeedsOrganization(false);
    try {
      const result = await fetchZohoPreview(productId);
      setSections(result.sections);
      setOrganizations(result.organizations);
      setNeedsOrganization(result.needsOrganization);
      setApiDomain(result.apiDomain);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Zoho could not complete the request.';
      setLeadsError(message);
      if (error instanceof ZohoClientError && (error.code === 'reconnect_required' || error.code === 'missing_scope')) {
        setShowReconnect(true);
        setReconnectProduct(productId);
        if (error.code === 'reconnect_required') {
          setProducts((current) => current.map((item) => (
            item.id === productId ? { ...item, connected: false } : item
          )));
        }
      }
    } finally {
      setLeadsLoading(false);
    }
  }, []);

  const chooseOrganization = useCallback(async (organizationId: string) => {
    if (!previewProductId) return;
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      await selectZohoOrganization(previewProductId, organizationId);
      const result = await fetchZohoPreview(previewProductId);
      setSections(result.sections);
      setOrganizations(result.organizations);
      setNeedsOrganization(result.needsOrganization);
      setApiDomain(result.apiDomain);
    } catch (error) {
      setLeadsError(error instanceof Error ? error.message : 'Zoho could not complete the request.');
    } finally {
      setLeadsLoading(false);
    }
  }, [previewProductId]);

  const disconnect = useCallback(async (productId: string) => {
    const product = products.find((item) => item.id === productId);
    const result = await disconnectZoho(productId);
    setProducts((current) => current.map((item) => (
      item.id === productId ? { ...item, connected: false, organizationId: null } : item
    )));
    setPreviewOpen(false);
    setShowReconnect(false);
    setBannerTone('success');
    const name = product?.name ?? 'Zoho';
    setBanner(
      result.revoked
        ? `${name} was disconnected.`
        : `${name} was disconnected in Effort Multiplier. Zoho did not confirm token revocation. Remove the app in your Zoho account if it still appears there.`,
    );
  }, [products]);

  return {
    checking,
    products,
    banner,
    bannerTone,
    showReconnect,
    reconnectProduct,
    previewOpen,
    previewTitle,
    previewProductId,
    sections,
    organizations,
    needsOrganization,
    apiDomain,
    leadsLoading,
    leadsError,
    preview,
    chooseOrganization,
    disconnect,
    closePreview: () => setPreviewOpen(false),
  };
}
