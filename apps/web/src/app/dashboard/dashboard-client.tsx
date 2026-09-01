"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  dashboardRequestHeaders,
  dashboardResponseError,
  mergeDashboardApiKey,
  readableDashboardDate,
  type IssuedDashboardApiKey,
  type RevokedDashboardApiKey,
} from "./dashboard-data";
import { useDashboardOverview } from "./use-dashboard-overview";

export function ApiKeysClient() {
  const { overview, setOverview, loading, error, setError, loadOverview } = useDashboardOverview();
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const pendingIssuance = useRef<{ name: string; idempotencyKey: string } | null>(null);

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = keyName.trim();
    if (!normalizedName || creating) return;

    const issuance =
      pendingIssuance.current?.name === normalizedName
        ? pendingIssuance.current
        : {
            name: normalizedName,
            idempotencyKey: `dashboard_${crypto.randomUUID()}`,
          };
    pendingIssuance.current = issuance;
    setCreating(true);
    setError(null);
    setCopyStatus(null);
    try {
      const response = await fetch("/api/dashboard/api-keys", {
        method: "POST",
        cache: "no-store",
        headers: {
          ...dashboardRequestHeaders(),
          "Content-Type": "application/json",
          "Idempotency-Key": issuance.idempotencyKey,
        },
        body: JSON.stringify({ name: normalizedName }),
      });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        return;
      }
      if (!response.ok) {
        throw await dashboardResponseError(response);
      }
      const issued = (await response.json()) as IssuedDashboardApiKey;
      setOverview((current) =>
        current
          ? { ...current, api_keys: mergeDashboardApiKey(current.api_keys, issued.api_key) }
          : current,
      );
      setIssuedCredential(issued.credential);
      setKeyName("");
      pendingIssuance.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The API key could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function revokeApiKey(keyId: string, keyNameToRevoke: string) {
    if (
      revokingKeyId ||
      !window.confirm(
        `Revoke “${keyNameToRevoke}”? Agents using this key will immediately lose access.`,
      )
    ) {
      return;
    }
    setRevokingKeyId(keyId);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/api-keys/${keyId}/revoke`, {
        method: "POST",
        cache: "no-store",
        headers: dashboardRequestHeaders(),
      });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        return;
      }
      if (!response.ok) {
        throw await dashboardResponseError(response);
      }
      const revoked = (await response.json()) as RevokedDashboardApiKey;
      setOverview((current) =>
        current
          ? { ...current, api_keys: mergeDashboardApiKey(current.api_keys, revoked.api_key) }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The API key could not be revoked.");
    } finally {
      setRevokingKeyId(null);
    }
  }

  async function copyCredential() {
    if (!issuedCredential) return;
    try {
      await navigator.clipboard.writeText(issuedCredential);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed — select the credential manually");
    }
  }

  if (loading && !overview) {
    return (
      <section className="dashboardLoading" aria-live="polite">
        Loading your account…
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="dashboardErrorState" role="alert">
        <h2>Account data is unavailable</h2>
        <p>{error ?? "The dashboard could not be loaded."}</p>
        <button className="secondaryButton" type="button" onClick={() => void loadOverview()}>
          Try again
        </button>
      </section>
    );
  }

  const activeKeyCount = overview.api_keys.filter((apiKey) => !apiKey.revoked_at).length;

  return (
    <>
      {error ? (
        <div className="dashboardAlert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="dashboardPanel dashboardPanelFirst" aria-labelledby="api-keys-title">
        <div className="dashboardPanelHeader">
          <div>
            <p className="eyebrow">Credentials</p>
            <h2 id="api-keys-title">API keys</h2>
            <p>Create a named key for each agent or environment. A secret is shown only once.</p>
          </div>
          <span className="statusPill">{activeKeyCount} of 5 active</span>
        </div>

        {issuedCredential ? (
          <div className="credentialReveal" role="status" aria-live="polite">
            <div>
              <strong>Copy this credential now</strong>
              <p>It will not be shown again after you leave or dismiss this message.</p>
            </div>
            <code>{issuedCredential}</code>
            <div className="credentialActions">
              <button className="primaryButton" type="button" onClick={() => void copyCredential()}>
                Copy credential
              </button>
              <button
                className="secondaryButton"
                type="button"
                onClick={() => {
                  setIssuedCredential(null);
                  setCopyStatus(null);
                }}
              >
                I’ve saved it
              </button>
              {copyStatus ? <span aria-live="polite">{copyStatus}</span> : null}
            </div>
          </div>
        ) : null}

        <form className="apiKeyForm" onSubmit={createApiKey}>
          <label htmlFor="api-key-name">Key name</label>
          <div>
            <input
              id="api-key-name"
              name="name"
              value={keyName}
              maxLength={120}
              placeholder="Production agent"
              autoComplete="off"
              disabled={creating || activeKeyCount >= 5}
              onChange={(event) => {
                setKeyName(event.target.value);
                pendingIssuance.current = null;
              }}
              required
            />
            <button
              className="primaryButton"
              type="submit"
              disabled={creating || activeKeyCount >= 5 || !keyName.trim()}
            >
              {creating ? "Creating…" : "Create API key"}
            </button>
          </div>
          {activeKeyCount >= 5 ? (
            <small>Revoke an active key before creating another.</small>
          ) : (
            <small>Use a name that identifies the agent or deployment.</small>
          )}
        </form>

        <div className="apiKeyList" aria-live="polite">
          {overview.api_keys.length === 0 ? (
            <div className="dashboardEmptyState">
              <h3>No API keys yet</h3>
              <p>Create your first key, save it securely, then follow the quickstart.</p>
              <a href="/docs">Read the agent quickstart</a>
            </div>
          ) : (
            overview.api_keys
              .slice()
              .reverse()
              .map((apiKey) => {
                const revoked = Boolean(apiKey.revoked_at);
                return (
                  <article className="apiKeyRow" key={apiKey.id}>
                    <div className="apiKeyIdentity">
                      <strong>{apiKey.name}</strong>
                      <code>{apiKey.id}</code>
                    </div>
                    <dl>
                      <div>
                        <dt>Created</dt>
                        <dd>{readableDashboardDate(apiKey.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Last used</dt>
                        <dd>{readableDashboardDate(apiKey.last_used_at)}</dd>
                      </div>
                    </dl>
                    <div className="apiKeyAction">
                      {revoked ? (
                        <span className="statusPill">Revoked</span>
                      ) : (
                        <button
                          className="dangerButton"
                          type="button"
                          disabled={revokingKeyId === apiKey.id}
                          onClick={() => void revokeApiKey(apiKey.id, apiKey.name)}
                        >
                          {revokingKeyId === apiKey.id ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
          )}
        </div>
      </section>
    </>
  );
}
