import { useCallback, useEffect, useState } from 'react';
import {
  consumeMicrosoftReturn,
  disconnectMicrosoft,
  fetchMicrosoftCatalog,
  fetchMicrosoftPreview,
  microsoftReturnMessage,
  MicrosoftClientError,
  type MicrosoftCatalogProduct,
  type MicrosoftPreviewSection,
} from '@/microsoftApi';

export function useMicrosoftConnection() {
  const [checking, setChecking] = useState(true);
  const [products, setProducts] = useState<MicrosoftCatalogProduct[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<'success' | 'error'>('success');
  const [showReconnect, setShowReconnect] = useState(false);
  const [reconnectProduct, setReconnectProduct] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('Microsoft');
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [sections, setSections] = useState<MicrosoftPreviewSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const catalog = await fetchMicrosoftCatalog();
    setProducts(catalog);
    setChecking(false);
    return catalog;
  }, []);

  useEffect(() => {
    const returned = consumeMicrosoftReturn();
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
          setBanner('Microsoft did not confirm the connection. It was not marked connected.');
          setBannerTone('error');
          setShowReconnect(true);
          setReconnectProduct(returned.product);
        } else {
          setBanner(microsoftReturnMessage(returned.reason));
          setBannerTone('error');
          setShowReconnect(returned.reason !== 'access_denied');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProducts([]);
        setChecking(false);
        if (returned.type === 'none') return;
        setBanner('The Microsoft server did not respond, so the account was not marked connected.');
        setBannerTone('error');
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const refreshOnFocus = () => {
      void load().catch(() => {
        setProducts([]);
      });
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [load]);

  const preview = useCallback(async (productId: string, name: string) => {
    setPreviewOpen(true);
    setPreviewTitle(name);
    setPreviewProductId(productId);
    setLoading(true);
    setError(null);
    setSections([]);
    try {
      setSections(await fetchMicrosoftPreview(productId));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Microsoft could not complete the request.';
      setError(message);
      if (caught instanceof MicrosoftClientError && caught.code === 'reconnect_required') {
        setShowReconnect(true);
        setReconnectProduct(productId);
        setProducts((current) => current.map((item) => (
          item.id === productId ? { ...item, connected: false } : item
        )));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async (productId: string) => {
    const product = products.find((item) => item.id === productId);
    const result = await disconnectMicrosoft(productId);
    setProducts((current) => current.flatMap((item) => {
      if (item.id !== productId) return [item];
      if (!item.connectable) return [];
      return [{ ...item, connected: false, email: null }];
    }));
    setPreviewOpen(false);
    const name = product?.name ?? 'Microsoft';
    setBannerTone('success');
    setBanner(
      result.sharedGrant
        ? `${name} was disconnected in Effort Multiplier. Other Microsoft products that share this authorization were left in place.`
        : `${name} was disconnected in Effort Multiplier. The stored Microsoft tokens were removed. The permission in the Microsoft account remains until it is removed there.`,
    );
    return result;
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
    loading,
    error,
    preview,
    disconnect,
    closePreview: () => setPreviewOpen(false),
  };
}
