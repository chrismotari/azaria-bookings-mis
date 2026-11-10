import { isAxiosError } from 'axios';

import { api } from '../api/client';
import { reportTenantProblem } from '../api/tenant';

/** With responseType blob an error body is a Blob too: turn a JSON one back into data, so its message shows. */
async function readErrorBody(error: unknown): Promise<never> {
  if (isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await error.response.data.text());
      reportTenantProblem(error.response.data);
    } catch {
      // Not JSON: keep the generic message.
    }
  }
  throw error;
}

/** Types the browser displays itself, by extension: these open in a new tab instead of downloading. */
const PREVIEWABLE: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function previewType(filename: string): string | undefined {
  return PREVIEWABLE[filename.split('.').pop()?.toLowerCase() ?? ''];
}

// Long enough for the new tab to load the file; the tab keeps what it has loaded after that.
const KEEP_PREVIEW_URL_MS = 60_000;

/**
 * Web only: fetches an API file with the auth header and shows it. Preview first: a file the browser can display
 * (PDF, images) opens in a new tab; anything else, or everything if the browser blocks the tab, is downloaded.
 */
export async function openFile(path: string, filename: string) {
  const type = previewType(filename);
  // Opened now, while the click still counts as the user's, so the browser does not block it as a pop-up.
  const tab = type ? window.open('', '_blank') : null;
  let data: Blob;
  try {
    ({ data } = await api.get<Blob>(path, { responseType: 'blob' }).catch(readErrorBody));
  } catch (error) {
    tab?.close();
    throw error;
  }
  if (tab && type) {
    // The type set explicitly, so the browser's viewer shows it whatever the server labelled it.
    const url = URL.createObjectURL(new Blob([data], { type }));
    tab.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), KEEP_PREVIEW_URL_MS);
    return;
  }
  save(data, filename);
}

function save(data: Blob, filename: string) {
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A boarding pass, under its original name. */
export function openBoardingPass(id: string, filename: string) {
  return openFile(`/boarding-passes/${id}/download`, filename);
}
