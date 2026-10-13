import { useCallback, useEffect, useRef, useState } from 'react';
import {
  disconnectZoho,
  fetchZohoLeads,
  consumeZohoReturn,
  fetchZohoStatus,
  zohoReturnMessage,
  ZohoClientError,
  type ZohoLead,
} from '@/zohoApi';

export function useZohoConnection() {
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [apiDomain, setApiDomain] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<'success' | 'error'>('success');
  const [showReconnect, setShowReconnect] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [leads, setLeads] = useState<ZohoLead[] | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    const returned = consumeZohoReturn();

    let cancelled = false;
    void fetchZohoStatus()
      .then((status) => {
        if (cancelled) return;
        setChecking(false);
        setConnected(status.connected);
        setApiDomain(status.apiDomain);
        if (returned.type === 'connected' && status.connected) {
          setBanner('Zoho CRM is connected.');
          setBannerTone('success');
          setShowReconnect(false);
        } else if (returned.type === 'connected') {
          setBanner('Zoho did not confirm the connection. It was not marked connected.');
          setBannerTone('error');
          setShowReconnect(true);
        } else if (returned.type === 'error' && returned.reason === 'access_denied' && status.connected) {
          setBanner('Zoho authorization was cancelled. The existing connection was left in place.');
          setBannerTone('error');
          setShowReconnect(false);
        } else if (returned.type === 'error') {
          setBanner(zohoReturnMessage(returned.reason));
          setBannerTone('error');
          setShowReconnect(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setChecking(false);
        setConnected(false);
        if (returned.type === 'none') return;
        setBanner('The Zoho server did not respond, so the account was not marked connected.');
        setBannerTone('error');
        setShowReconnect(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => {
      void fetchZohoStatus()
        .then((status) => {
          setChecking(false);
          setApiDomain(status.apiDomain);
          if (status.connected && !connectedRef.current) {
            setBanner('Zoho CRM is connected.');
            setBannerTone('success');
            setShowReconnect(false);
          }
          setConnected(status.connected);
        })
        .catch(() => undefined);
    };

    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  const preview = useCallback(async () => {
    setPreviewOpen(true);
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const result = await fetchZohoLeads();
      setLeads(result.leads);
      if (result.apiDomain) setApiDomain(result.apiDomain);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Zoho could not complete the request.';
      setLeadsError(message);
      if (error instanceof ZohoClientError && error.code === 'reconnect_required') {
        setConnected(false);
        setShowReconnect(true);
      }
      if (error instanceof ZohoClientError && error.code === 'missing_scope') {
        setShowReconnect(true);
      }
    } finally {
      setLeadsLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const result = await disconnectZoho();
    setConnected(false);
    setApiDomain(null);
    setPreviewOpen(false);
    setLeads(null);
    setShowReconnect(false);
    setBannerTone('success');
    setBanner(
      result.revoked
        ? 'Zoho CRM was disconnected.'
        : 'Zoho CRM was disconnected in Effort Multiplier. Zoho did not confirm token revocation. Remove the app in your Zoho account if it still appears there.',
    );
  }, []);

  return {
    checking,
    connected,
    apiDomain,
    banner,
    bannerTone,
    showReconnect,
    previewOpen,
    leads,
    leadsLoading,
    leadsError,
    preview,
    disconnect,
    closePreview: () => setPreviewOpen(false),
  };
}
