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

/** Web only: fetches a boarding pass with the auth header and saves it under its original name. */
export async function downloadBoardingPass(id: string, filename: string) {
  const { data } = await api
    .get<Blob>(`/boarding-passes/${id}/download`, { responseType: 'blob' })
    .catch(readErrorBody);
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
