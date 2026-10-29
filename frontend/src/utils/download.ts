import { api } from '../api/client';

/** Web only: fetches a boarding pass with the auth header and saves it under its original name. */
export async function downloadBoardingPass(id: number, filename: string) {
  const { data } = await api.get<Blob>(`/boarding-passes/${id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
