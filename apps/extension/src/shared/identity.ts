const INSTALL_ID_STORAGE_KEY = "memedrop_install_id";
export const INSTALL_ID_HEADER = "X-MemeDrop-Install-Id";

export async function getInstallId(): Promise<string> {
  const stored = await chrome.storage.local.get([INSTALL_ID_STORAGE_KEY]);
  const existing = stored[INSTALL_ID_STORAGE_KEY];
  if (typeof existing === "string" && isUuid(existing)) {
    return existing;
  }

  const installId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_ID_STORAGE_KEY]: installId });
  return installId;
}

export async function withInstallIdHeaders(
  headers?: HeadersInit
): Promise<Headers> {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(INSTALL_ID_HEADER, await getInstallId());
  return nextHeaders;
}

export async function rotateInstallId(): Promise<string> {
  const installId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_ID_STORAGE_KEY]: installId });
  return installId;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
