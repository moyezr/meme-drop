"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  dashboardResponseError,
  mergeDashboardApiKey,
  type DashboardOverview,
  type IssuedDashboardApiKey,
  type RevokedDashboardApiKey,
} from "./dashboard-data";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function requestId(): string {
  return `web_${crypto.randomUUID().replaceAll("-", "")}`;
}

function requestHeaders(): HeadersInit {
  return { "x-request-id": requestId() };
}

function readableDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : dateFormatter.format(date);
}

export function DashboardClient() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const pendingIssuance = useRef<{ name: string; idempotencyKey: string } | null>(null);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/overview", {
        cache: "no-store",
        headers: requestHeaders(),
        signal,
      });
      if (response.status === 401) {
        window.location.assign("/sign-in");
        return;
      }
      if (!response.ok) {
        throw await dashboardResponseError(response);
      }
      setOverview((await response.json()) as DashboardOverview);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "The dashboard could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview]);

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
          ...requestHeaders(),
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
        headers: requestHeaders(),
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

      <section className="dashboardSummary" aria-label="Account overview">
        <article className="dashboardMetric">
          <span>Available credits</span>
          <strong>{overview.user.credits.toLocaleString()}</strong>
          <small>One credit per durable returned meme</small>
        </article>
        <article className="dashboardMetric">
          <span>Active API keys</span>
          <strong>{activeKeyCount}</strong>
          <small>{5 - activeKeyCount} remaining before the active-key limit</small>
        </article>
        <article className="dashboardMetric">
          <span>Developer account</span>
          <strong className="dashboardAccountValue">
            {overview.user.email ?? overview.user.id}
          </strong>
          <small>Created {readableDate(overview.user.created_at)}</small>
        </article>
      </section>

      <section className="dashboardPanel" id="api-keys" aria-labelledby="api-keys-title">
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
                        <dd>{readableDate(apiKey.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Last used</dt>
                        <dd>{readableDate(apiKey.last_used_at)}</dd>
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
